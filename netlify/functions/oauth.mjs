import axios from "axios";
import { getStore } from "@netlify/blobs";

function html(status, body) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    if (!code) {
      return html(400, `<h1>Missing code</h1><p>Install via Slack first.</p>`);
    }

    // Required env vars
    const app_base_url  = process.env.APP_BASE_URL || "https://kindness.ceebsync.com";
    const client_id     = process.env.SLACK_CLIENT_ID;
    const client_secret = process.env.SLACK_CLIENT_SECRET;
    const siteID        = process.env.NETLIFY_SITE_ID;
    const token         = process.env.NETLIFY_API_TOKEN;

    if (!client_id || !client_secret || !siteID || !token) {
      return html(
        500,
        `<h1>Server not configured</h1>
         <p>Missing one or more env vars: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, NETLIFY_SITE_ID, NETLIFY_API_TOKEN.</p>`
      );
    }

    const redirect_uri = `${app_base_url}/.netlify/functions/oauth`;

    // Exchange code for tokens
    const form = new URLSearchParams({ code, client_id, client_secret, redirect_uri });
    const tokenRes = await axios.post(
      "https://slack.com/api/oauth.v2.access",
      form.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const data = tokenRes.data;
    if (!data.ok) {
      console.error("Slack OAuth error:", data);
      return html(
        500,
        `<h1>Slack OAuth failed</h1><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`
      );
    }

    // Pull out install info
    const team_id   = data.team?.id;
    const team_name = data.team?.name;
    const bot_token = data.access_token;
    const bot_user  = data.bot_user_id;

    if (!team_id || !bot_token) {
      return html(
        500,
        `<h1>Missing data from Slack</h1><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`
      );
    }

    // Store per-workspace install via Netlify Blobs SDK (explicit siteID/token)
    const store = getStore("kindness-installs", { siteID, token });
    const installRecord = {
      team_id,
      team_name,
      bot_token,
      bot_user,
      installed_at: Date.now(),
      channel_id: null,
      goal: 100,
      start: null,
      end: null,
    };
    await store.set(`team:${team_id}`, JSON.stringify(installRecord));

    // Success page with clear next steps
    return html(
      200,
      `
      <!doctype html>
      <meta charset="utf-8">
      <title>Rhoda installed</title>
      <style>
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height:1.45; margin:0; background:#f7f8fa; }
        .wrap { max-width:720px; margin:40px auto; background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:28px; }
        h1 { margin:0 0 8px; font-size:26px; }
        ol { padding-left:20px; }
        code { background:#f3f4f6; padding:2px 6px; border-radius:6px; }
        .muted { color:#6b7280; }
        a { color:#2563eb; text-decoration:none; }
        a:hover { text-decoration:underline; }
      </style>
      <div class="wrap">
        <h1>Installed to ${escapeHtml(team_name || team_id)}</h1>
        <p class="muted">Rhoda (Kindness Challenge) is connected to your workspace.</p>

        <h3>Next steps (takes ~60 seconds):</h3>
        <ol>
          <li>Create or choose a Slack channel (e.g., <code>#kindness-campaign</code>) and add the app (Channel → <em>Add apps</em> → <strong>Rhoda</strong>).</li>
          <li>In that channel, run <code>/kindness-config</code> to set your <strong>Start Date</strong>, <strong>End Date</strong>, and <strong>Goal</strong>. This also binds Rhoda to that channel.</li>
          <li>Teammates use <code>/kindness</code> to submit acts (optional anonymity + prayer request).</li>
          <li>Rhoda will update the channel so everyone can celebrate the act of kindness and your progress as a team.</li>
		  <li>When you want a new season, run <code>/kindness-reset</code> to set fresh dates/goal.</li>
        </ol>

        <p>Landing page: <a href="${app_base_url}">${app_base_url}</a></p>
        <p class="muted">You can close this window.</p>
      </div>
      `
    );
  } catch (err) {
    console.error("OAuth handler error:", err);
    return html(500, `<h1>Error</h1><pre>${escapeHtml(err.message || String(err))}</pre>`);
  }
};
