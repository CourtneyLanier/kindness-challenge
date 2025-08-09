// netlify/functions/oauth.mjs
import axios from "axios";
import { getStore } from "@netlify/blobs";

/**
 * Modern Netlify Function (ESM) + official Blobs SDK.
 * Stores a per-workspace install record after Slack OAuth.
 */
export default async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    if (!code) {
      return html(400, `<h1>Missing code</h1><p>Install via Slack first.</p>`);
    }

    // Required env vars
    const app_base_url  = process.env.APP_BASE_URL;
    const client_id     = process.env.SLACK_CLIENT_ID;
    const client_secret = process.env.SLACK_CLIENT_SECRET;
    const siteID        = process.env.NETLIFY_SITE_ID;
    const token         = process.env.NETLIFY_API_TOKEN;

    if (!app_base_url || !client_id || !client_secret || !siteID || !token) {
      return html(
        500,
        `<h1>Server not configured</h1>
         <p>Missing one or more env vars: APP_BASE_URL, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, NETLIFY_SITE_ID, NETLIFY_API_TOKEN.</p>`
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
      return html(500, `<h1>Slack OAuth failed</h1><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`);
    }

    // Pull out install info
    const team_id   = data.team?.id;
    const team_name = data.team?.name;
    const bot_token = data.access_token;
    const bot_user  = data.bot_user_id;

    if (!team_id || !bot_token) {
      return html(500, `<h1>Missing data from Slack</h1><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`);
    }

    // Use official SDK with explicit siteID/token
    const store = getStore("kindness-installs", { siteID, token });
    const key = `team:${team_id}`;
    const installRecord = {
      team_id,
      team_name,
      bot_token,
      bot_user,
      installed_at: Date.now(),
      channel_id: null,
      goal: 100,
      start: null,
      end: null
    };

    await store.set(key, JSON.stringify(installRecord));

    return html(
      200,
      `
        <h1>Installed to ${escapeHtml(team_name || team_id)}</h1>
        <p>Your Kindness Challenge bot is now connected.</p>
        <ol>
          <li>Create or choose a channel (e.g., <code>#kindness-campaign</code>) and invite the bot.</li>
          <li>Run <code>/kindness</code> to test logging an act.</li>
          <li>Run <code>/kindness-config</code> (coming next) to set your Start/End dates & goal.</li>
        </ol>
        <p>You can close this window.</p>
      `
    );
  } catch (err) {
    console.error("OAuth handler error:", err.response?.data || err.message || err);
    return html(500, `<h1>Error</h1><pre>${escapeHtml(err.message || String(err))}</pre>`);
  }
};

function html(status, body) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}
