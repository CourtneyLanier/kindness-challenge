import axios from "axios";
import crypto from "crypto";
import { getStore } from "@netlify/blobs";

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

async function fetchInstall(team_id) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_API_TOKEN;
  const store  = getStore("kindness-installs", { siteID, token });
  const raw    = await store.get(`team:${team_id}`);
  return raw ? JSON.parse(raw) : null;
}

export default async (req) => {
  const bodyText = await req.text();
  console.log("🟦 /kindness hit", {
    ts: req.headers.get("x-slack-request-timestamp"),
    hasSig: !!req.headers.get("x-slack-signature"),
    len: bodyText.length
  });

  // Verify Slack signature
  const okSig = isSlackSignatureValid({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    body: bodyText,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
  });
  if (!okSig) return new Response("Invalid signature", { status: 401 });

  const params     = new URLSearchParams(bodyText);
  const team_id    = params.get("team_id");
  const trigger_id = params.get("trigger_id");
  const channel_id = params.get("channel_id"); // channel where the slash command was used

  // Use the per-workspace bot token (fallback to env if present)
  const install  = await fetchInstall(team_id);
  const botToken = install?.bot_token || process.env.SLACK_BOT_TOKEN;

  // Build the submit modal
  const view = {
    type: "modal",
    callback_id: "kindness_modal",
    private_metadata: JSON.stringify({ team_id, channel_id }),
    title:  { type: "plain_text", text: "Kindness Challenge" },
    submit: { type: "plain_text", text: "Submit" },
    close:  { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "description_block",
        label: { type: "plain_text", text: "What act of kindness did you do?" },
        element: { type: "plain_text_input", action_id: "description", multiline: true }
      },
      {
        type: "input",
        block_id: "prayer_block",
        optional: true,
        label: { type: "plain_text", text: "How can we pray for this situation?" },
        element: { type: "plain_text_input", action_id: "prayer", multiline: true }
      },
      {
        type: "input",
        block_id: "anon_block",
        label: { type: "plain_text", text: "Include your name?" },
        element: {
          type: "static_select",
          action_id: "anon_choice",
          options: [
            { text: { type: "plain_text", text: "Yes" }, value: "yes" },
            { text: { type: "plain_text", text: "No (post anonymously)" }, value: "no" }
          ]
        }
      }
    ]
  };

  try {
    const r = await axios.post(
      "https://slack.com/api/views.open",
      { trigger_id, view },
      { headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" } }
    );
    console.log("views.open →", r.data);
  } catch (e) {
    console.error("views.open error", e.response?.data || e.message);
  }

  // Always return 200 quickly to Slack
  return new Response("", { status: 200 });
};
