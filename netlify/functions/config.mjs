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
  const store = getStore("kindness-installs", { siteID, token });
  const raw = await store.get(`team:${team_id}`);
  return raw ? JSON.parse(raw) : null;
}

export default async (req) => {
  const bodyText = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!isSlackSignatureValid({ signingSecret, body: bodyText, timestamp, signature })) {
    return new Response("Invalid signature", { status: 401 });
  }

  const params = new URLSearchParams(bodyText);
  const trigger_id = params.get("trigger_id");
  const team_id    = params.get("team_id");
  const channel_id = params.get("channel_id"); // where /kindness-config was used

  if (!channel_id || !channel_id.startsWith("C")) {
    return new Response("Please run /kindness-config inside the channel you want to use.", { status: 200 });
  }

  const install  = await fetchInstall(team_id);
  const botToken = install?.bot_token || process.env.SLACK_BOT_TOKEN;

  const goal  = install?.goal ?? 100;
  const start = install?.start ? new Date(install.start * 1000).toISOString().slice(0,10) : "";
  const end   = install?.end   ? new Date(install.end   * 1000).toISOString().slice(0,10) : "";

  const view = {
    type: "modal",
    callback_id: "kindness_config_modal",
    title: { type: "plain_text", text: "Kindness Config" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    private_metadata: JSON.stringify({ team_id, channel_id }),
    blocks: [
      { type: "input", block_id: "start_block",
        label: { type: "plain_text", text: "Start date (YYYY-MM-DD)" },
        element: { type: "plain_text_input", action_id: "start", initial_value: start }
      },
      { type: "input", block_id: "end_block",
        label: { type: "plain_text", text: "End date (YYYY-MM-DD)" },
        element: { type: "plain_text_input", action_id: "end", initial_value: end }
      },
      { type: "input", block_id: "goal_block",
        label: { type: "plain_text", text: "Goal (number of acts)" },
        element: { type: "plain_text_input", action_id: "goal", initial_value: String(goal) }
      }
    ]
  };

  try {
    await axios.post("https://slack.com/api/views.open", { trigger_id, view }, {
      headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" }
    });
    return new Response("", { status: 200 });
  } catch (err) {
    console.error("views.open error", err.response?.data || err.message);
    return new Response("Error opening config modal", { status: 500 });
  }
};
