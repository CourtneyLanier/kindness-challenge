const axios = require('axios');

/**
 * OAuth callback for Slack app installs.
 * Exchanges ?code= for a bot token and stores per-workspace install in Netlify Blobs (via HTTP API).
 */
exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const code = params.code;
    if (!code) {
      return html(400, `<h1>Missing code</h1><p>Install via Slack first.</p>`);
    }

    // ---- Required env vars ----
    const siteID = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_API_TOKEN; // Personal Access Token
    const client_id     = process.env.SLACK_CLIENT_ID;
    const client_secret = process.env.SLACK_CLIENT_SECRET;
    const app_base_url  = process.env.APP_BASE_URL;

    if (!siteID || !token || !client_id || !client_secret || !app_base_url) {
      return html(
        500,
        `<h1>Server not configured</h1>
         <p>Missing one or more env vars: NETLIFY_SITE_ID, NETLIFY_API_TOKEN, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, APP_BASE_URL.</p>`
      );
    }

    const redirect_uri = `${app_base_url}/.netlify/functions/oauth`;

    // ---- Exchange code for tokens ----
    const form = new URLSearchParams({ code, client_id, client_secret, redirect_uri });
    const tokenRes = await axios.post(
      'https://slack.com/api/oauth.v2.access',
      form.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const data = tokenRes.data;
    if (!data.ok) {
      console.error('Slack OAuth error:', data);
      return html(500, `<h1>Slack OAuth failed</h1><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`);
    }

    // ---- Pull out install info ----
    const team_id   = data.team?.id;
    const team_name = data.team?.name;
    const bot_token = data.access_token; // workspace-specific bot token
    const bot_user  = data.bot_user_id;

    if (!team_id || !bot_token) {
      return html(500, `<h1>Missing data from Slack</h1><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`);
    }

    const installRecord = {
      team_id,
      team_name,
      bot_token,
      bot_user,
      installed_at: Date.now(),
      // per-workspace config; set later via /kindness-config
      channel_id: null,
      goal: 100,
      start: null, // unix timestamp (seconds)
      end: null    // unix timestamp (seconds)
    };

    // ---- Store install using Netlify Blobs HTTP API (no SDK) ----
    const key = `team:${team_id}`;
    const url = `https://api.netlify.com/api/v1/blobs/sites/${siteID}/stores/kindness-installs/items/${encodeURIComponent(key)}`;

    // PUT bytes to the item
    await axios.put(
      url,
      Buffer.from(JSON.stringify(installRecord)),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        maxBodyLength: Infinity
      }
    );

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
    console.error('OAuth handler error:', err.response?.data || err.message || err);
    return html(500, `<h1>Error</h1><pre>${escapeHtml(err.message || String(err))}</pre>`);
  }
};

function html(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
