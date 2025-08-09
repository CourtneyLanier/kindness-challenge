import axios from "axios";
import crypto from "crypto";
import { getStore } from "@netlify/blobs";

/* ---------- Blobs helpers (defer store creation) ---------- */
function getBlobsStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_API_TOKEN;
  if (!siteID || !token) {
    throw new Error(`Missing Blobs env. siteID present? ${!!siteID} token present? ${!!token}`);
  }
  return getStore("kindness-installs", { siteID, token });
}

async function fetchInstall(team_id) {
  try {
    const store = getBlobsStore();
    const raw = await store.get(`team:${team_id}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("fetchInstall error:", e.message || e);
    return null;
  }
}

async function saveInstall(team_id, record) {
  const store = getBlobsStore();
  await store.set(`team:${team_id}`, JSON.stringify(record));
}

/* ---------- Slack signature ---------- */
function isSlackSignatureValid({ signingSecret, body, timestamp, signature }) {
  if (!timestamp || !signature) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) return false;
  const basestring = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac("sha256", signingSecret).update(basestring).digest("hex");
  const mySig = `v0=${hmac}`;
  try { return crypto.timingSafeEqual(Buffer.from(mySig, "utf8"), Buffer.from(signature, "utf8")); }
  catch { return false; }
}

/* ---------- Count posts since oldest ---------- */
async function countActs({ botToken, channel_id, oldest }) {
  let total = 0;
  let cursor = "";
  do {
    const resp = await axios.get("https://slack.com/api/conversations.history", {
      headers: { Authorization: `Bearer ${botToken}` },
      params: { channel: channel_id, oldest, limit: 200, cursor }
    });
    if (!resp.data.ok) throw new Error(`conversations.history error: ${resp.data.error}`);
    const msgs = resp.data.messages || [];
    // Heuristic: count our posts (they start with "Act #" or include candle bar)
    total += msgs.filter(m => typeof m.text === "string" && (m.text.startsWith("Act #") || m.text.includes("🕯️"))).length;
    cursor = resp.data.response_metadata?.next_cursor || "";
  } while (cursor);
  return total;
}

/* ---------- Main handler ---------- */
export default async (req) => {
  const bodyText = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!isSlackSignatureValid({ signingSecret, body: bodyText, timestamp, signature })) {
    return json(401, { error: "Invalid signature" });
  }

  const payload = JSON.parse(new URLSearchParams(bodyText).get("payload") || "{}");
  const clear = () => json(200, { response_action: "clear" });

  // ---- Save config (bind to channel where /kindness-config ran) ----
  if (payload.type === "view_submission" && payload.view.callback_id === "kindness_config_modal") {
    const meta       = JSON.parse(payload.view.private_metadata || "{}");
    const team_id    = meta.team_id || payload.team?.id;
    const channel_id = meta.channel_id;

    if (!channel_id || !channel_id.startsWith("C")) {
      return json(200, { response_action: "errors", errors: { start_block: "Run /kindness-config in the target channel." } });
    }

    const v = payload.view.state.values;
    const startStr = v.start_block?.start?.value?.trim() || "";
    const endStr   = v.end_block?.end?.value?.trim() || "";
    const goalStr  = v.goal_block?.goal?.value?.trim() || "";

    const errors = {};
    const goal = parseInt(goalStr, 10);
    if (!goal || goal < 1) errors["goal_block"] = "Enter a positive number";

    const toTs = (s) => s ? Math.floor(new Date(`${s}T00:00:00Z`).getTime() / 1000) : null;
    const start = toTs(startStr);
    const end   = toTs(endStr);
    if (!start) errors["start_block"] = "Use YYYY-MM-DD";
    if (!end)   errors["end_block"] = "Use YYYY-MM-DD";
    if (start && end && end < start) errors["end_block"] = "End must be after Start";

    if (Object.keys(errors).length) return json(200, { response_action: "errors", errors });

    const install = await fetchInstall(team_id);
    const record = { ...(install || {}), team_id, channel_id, goal, start, end };
    await saveInstall(team_id, record);
    return clear();
  }
  // ---- Reset season (from /kindness-reset modal) ----
  if (payload.type === "view_submission" && payload.view.callback_id === "kindness_reset_modal") {
    const meta    = JSON.parse(payload.view.private_metadata || "{}");
    const team_id = meta.team_id || payload.team?.id;

    const v = payload.view.state.values;
    const startStr = v.start_block?.start?.value?.trim() || "";
    const endStr   = v.end_block?.end?.value?.trim() || "";
    const goalStr  = v.goal_block?.goal?.value?.trim() || "";

    const errors = {};
    const goal = parseInt(goalStr, 10);
    if (!goal || goal < 1) errors["goal_block"] = "Enter a positive number";
    const toTs = (s) => s ? Math.floor(new Date(`${s}T00:00:00Z`).getTime() / 1000) : null;
    const start = toTs(startStr);
    const end   = toTs(endStr);
    if (!start) errors["start_block"] = "Use YYYY-MM-DD";
    if (!end)   errors["end_block"] = "Use YYYY-MM-DD";
    if (start && end && end < start) errors["end_block"] = "End must be after Start";
    if (Object.keys(errors).length) return json(200, { response_action: "errors", errors });

    const install = await fetchInstall(team_id);
    if (!install) return json(200, { response_action: "clear" }); // nothing installed yet

    // keep existing channel; just update dates/goal
    const updated = { ...install, goal, start, end };
    await saveInstall(team_id, updated);
    return json(200, { response_action: "clear" });
  }

  // ---- Kindness submission ----
  if (payload.type === "view_submission" && payload.view.callback_id === "kindness_modal") {
    const meta       = JSON.parse(payload.view.private_metadata || "{}");
    const team_id    = meta.team_id || payload.team?.id;

    const v = payload.view.state.values;
    const description = v.description_block?.description?.value || "";
    const prayer      = v.prayer_block?.prayer?.value || "";
    const anon        = v.anon_block?.anon_choice?.selected_option?.value || "no";
    const username    = payload.user?.name || "Someone";

    const install   = await fetchInstall(team_id);
    const botToken  = install?.bot_token || process.env.SLACK_BOT_TOKEN;
    const team_name = install?.team_name || payload.team?.domain || "teammate";
    const goal      = Number.isInteger(install?.goal) ? install.goal : 100;
    const start     = install?.start ?? 0;
    const channel_id = install?.channel_id || process.env.CHANNEL_ID;
    if (!channel_id) return clear();

    let baseText = anon === "yes"
      ? `${username} shared: _"${description}"_`
      : `A ${team_name} teammate shared: _"${description}"_`;
    if (prayer) baseText += `\n🙏 Prayer request: _"${prayer}"_`;

    const now = Math.floor(Date.now() / 1000);
    if (start && now < start) {
      await axios.post("https://slack.com/api/chat.postMessage",
        { channel: channel_id, text: baseText },
        { headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" } }
      );
      return clear();
    }

    const count = await countActs({ botToken, channel_id, oldest: start || 0 });
    const nextAct = count + 1;
    const remaining = Math.max(0, goal - nextAct);
    const lit = Math.min(nextAct, goal);
    const unlit = Math.max(goal - lit, 0);
    const candleBar = "🔥".repeat(lit) + "🕯️".repeat(unlit);

    const text = `Act #${nextAct}: ${baseText}\nOnly ${remaining} more to go!\n${candleBar}`;

    await axios.post("https://slack.com/api/chat.postMessage",
      { channel: channel_id, text },
      { headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" } }
    );

    return clear();
  }

  return clear();
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
