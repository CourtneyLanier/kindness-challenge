// netlify/functions/config.js
const axios = require('axios');
const crypto = require('crypto');

function isSlackSignatureValid({ signingSecret, body, timestamp, signature }) {
  if (!timestamp || !signature) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) return false;
  const basestring = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(basestring).digest('hex');
  const mySig = `v0=${hmac}`;
  try { return crypto.timingSafeEqual(Buffer.from(mySig, 'utf8'), Buffer.from(signature, 'utf8')); }
  catch { return false; }
}

// Blobs (SDK) — read existing install to prefill
async function fetchInstall(team_id) {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('kindness-installs', {
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_API_TOKEN
    });
    const raw = await store.get(`team:${team_id}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('fetchInstall error:', e.message || e);
    return null;
  }
}

exports.handler = async (event) => {
  const timestamp = event.headers['x-slack-request-timestamp'];
  const signature = event.headers['x-slack-signature'];
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!isSlackSignatureValid({ signingSecret, body: event.body, timestamp, signature })) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  const params = new URLSearchParams(event.body);
  const trigger_id = params.get('trigger_id');
  const team_id    = params.get('team_id');
  const channel_id = params.get('channel_id'); // where /kindness-config was used

  if (!channel_id || !channel_id.startsWith('C')) {
    return { statusCode: 200, body: 'Please run /kindness-config inside the channel you want to use.' };
  }

  const install  = await fetchInstall(team_id);
  const botToken = install?.bot_token || process.env.SLACK_BOT_TOKEN;

  const goal  = install?.goal ?? 100;
  const start = install?.start ? new Date(install.start * 1000).toISOString().slice(0,10) : '';
  const end   = install?.end   ? new Date(install.end   * 1000).toISOString().slice(0,10) : '';

  const view = {
    type: 'modal',
    callback_id: 'kindness_config_modal',
    title: { type: 'plain_text', text: 'Kindness Config' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    private_metadata: JSON.stringify({ team_id, channel_id }),
    blocks: [
      { type: 'input', block_id: 'start_block',
        label: { type: 'plain_text', text: 'Start date (YYYY-MM-DD)' },
        element: { type: 'plain_text_input', action_id: 'start', initial_value: start }
      },
      { type: 'input', block_id: 'end_block',
        label: { type: 'plain_text', text: 'End date (YYYY-MM-DD)' },
        element: { type: 'plain_text_input', action_id: 'end', initial_value: end }
      },
      { type: 'input', block_id: 'goal_block',
        label: { type: 'plain_text', text: 'Goal (number of acts)' },
        element: { type: 'plain_text_input', action_id: 'goal', initial_value: String(goal) }
      }
    ]
  };

  try {
    await axios.post('https://slack.com/api/views.open', { trigger_id, view }, {
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' }
    });
    return { statusCode: 200, body: '' };
  } catch (err) {
    console.error('views.open error', err.response?.data || err.message);
    return { statusCode: 500, body: 'Error opening config modal' };
  }
};
