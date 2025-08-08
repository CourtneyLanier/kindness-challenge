const axios = require('axios');

/**
 * OAuth callback for Slack app installs.
 * Exchanges ?code= for a bot token and stores per-workspace install in Netlify Blobs.
 */
exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const code = params.code;
    if (!code) {
      return html(400, `<h1>Missing code</h1><p>Install via Slack first.</p>`);
    }

    const redirect_uri = `${process.env.APP_BASE_URL}/.netlify/functions/oauth`;
    const client_id = process.env.SLACK_CLIENT_ID;
    const client_secret = process.env.SLACK_CLIENT_SECRET;

    // Exchange code for tokens
    const form = new URLSearchParams({
      code,
      client_id,
      client_secret,
      redirect_uri
    });

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

    // Pull out what we need
    const team_id   = data.team?.id;
    const team_name = data.team?.name;
    const bot_token = data.access_token;     // workspace-specific bot token
    const bot_user  = data.bot_user_id;

    // Store install in Netlify Blobs (per team)
    // We use a dynamic import so this CommonJS file can load the ESM blobs client.
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('kindness-installs');

    const installRecord = {
      team_id,
      team_name,
      bot_token,
      bot_user,
      installed_at: Date.now(),
      // per-workspace config; they’ll set these later via /kindness-config
      channel_id: null,
      goal: 100,
      start: null,    // unix timestamp (seconds) when they choose
      end: null       // unix timestamp (seconds) when they choose
    };

    await store.set(`team:${team_id}`, JSON.stringify(installRecord));

    return html(
      200,
      `
        <h1>Installed to ${escapeHtml(team_name)}</h1>
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
    console.error('OAuth handler error:', err);
    return html(500, `<h1>Error</h1><pre>${escapeHtml(err.message)}</pre>`);
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
