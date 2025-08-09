const axios = require('axios');

/**
 * OAuth callback for Slack app installs.
 * Exchanges ?code= for a bot token and stores per-workspace install in Netlify Blobs via HTTP API.
 */
exports.handler = async (event) => {
  try {
    // ---- Read query & env ----
    const params = event.queryStringParameters || {};
    const code = params.code;
    if (!code) {
      return html(400, `<h1>Missing code</h1><p>Install via Slack first.</p>`);
    }

    const siteID        = process.env.NETLIFY_SITE_ID;
    const token         = process.env.NETLIFY_API_TOKEN; // Personal Access Token
    const client_id     = process.env.SLACK_CLIENT_ID;
    const client_secret = process.env.SLACK_CLIENT_SECRET;
    const app_base_url  = process.env.APP_BASE_URL;

    if (!siteID || !token || !client_id || !client_secret || !app_base_url) {
      console.error('Missing env', { hasSiteID: !!siteID, hasToken: !!token, hasCID: !!client_id, hasCS: !!client_secret, hasBase: !!app_base_url });
      return html(500, `<h1>Server not configured</h1><p>Missing env var(s). Check NETLIFY_SITE_ID, NETLIFY_API_TOKEN, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, APP_BASE_URL.</p>`);
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
      console.error('Missing team_id/bot_token in Slack response', data);
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

    // ---- Ensure store exists, then write item via Netlify Blobs HTTP API ----
    const base = `https://api.netlify.com/api/v1/blobs/sites/${siteID}/stores/kindness-installs`;
    const headers = { Authorization: `Bearer ${token}` };

    // Create the store if it doesn't exist (safe to call repeatedly)
    try {
      await axios.put(base, null, { headers });
    } catch (e) {
      // 409 Conflict means it already exists; ignore that. Anything else, log it.
      const status = e.response?.status;
      if (status && status !== 409) {
        console.error('Error creating store:', status, e.response?.data || e.message);
        return html(500, `<h1>Error creating store</h1><pre>${escapeHtml(JSON.stringify(e.response?.data || e.message, null, 2))}</pre>`);
      }
    }

    // Write the item
    const key = `team:${team_id}`;
    const itemUrl = `${base}/items/${encodeURIComponent(key)}`;
    try {
      await axios.put(itemUrl, JSON.stringify(installRecord), {
        headers: { ...headers, 'Content-Type': 'application/json' },
        maxBodyLength: Infinity
      });
    } catch (e) {
      console.error('Error writing blob item:', e.response?.status, e.response?.data || e.message);
      return html(500, `<h1>Error writing install record</h1><pre>${escapeHtml(JSON.stringify(e.response?.data || e.message, null, 2))}</pre>`);
    }

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
    const status = err.response?.status;
    const body   = err.response?.data || err.message || String(err);
    console.error('OAuth handler error status:', status);
    console.error('OAuth handler error body:', body);
    return html(status || 500, `<h1>Error</h1><pre>${escapeHtml(typeof body === 'string' ? body : JSON.stringify(body, null, 2))}</pre>`);
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
