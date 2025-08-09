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

// Blobs helper (read install)
async function fetchInstall(team_id) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_API_TOKEN;
  const key    = `team:${team_id}`;
  const url    = `https://api.netlify.com/api/v1/blobs/sites/${siteID}/stores/kindness-installs/items/${encodeURIComponent(key)}`;
  try {
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` }, responseType: 'text' });
    return res.data ? JSON.parse(res.data) : null;
  } catch (e) {
    if (e.response && e.response.status === 404) return null;
    console.error('fetchInstall error', e.response?.data || e.message);
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

  const install = await fetchInstall(team_id);
  const botToken = install?.bot_token || process.env.SLACK_BOT_TOKEN;

  const goal  = install?.goal ?? 100;
  const start = install?.start ? new Date(install.start * 1000).toISOString().slice(0,10) : '';
  const end   = install?.end   ? new Date(install.end   * 1000).toISOString().slice(0,10) : '';
  const channel = install?.channel_id || '';

  const view = {
    type: 'modal',
    callback_id: 'kindness_config_modal',
    title: { type: 'plain_text', text: 'Kindness Config' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    private_metadata: JSON.stringify({ team_id }),
    blocks: [
      { type: 'input', block_id: 'start_block',
        label: { type: 'plain_text', text: 'Start date (YYYY-MM-DD)' },
        element: { type: 'plain_text_input', action_id: 'start', initial_value: start, placeholder: { type: 'plain_text', text: '2025-09-16' } }
      },
      { type: 'input', block_id: 'end_block',
        label: { type: 'plain_text', text: 'End date (YYYY-MM-DD)' },
        element: { type: 'plain_text_input', action_id: 'end', initial_value: end, placeholder: { type: 'plain_text', text: '2025-12-25' } }
      },
      { type: 'input', block_id: 'goal_block',
        label: { type: 'plain_text', text: 'Goal (number of acts)' },
        element: { type: 'plain_text_input', action_id: 'goal', initial_value: String(goal) }
      },
      { type: 'input', block_id: 'channel_block',
        label: { type: 'plain_text', text: 'Channel (name like #kindness-campaign or channel ID Cxxxx)' },
        element: { type: 'plain_text_input', action_id: 'channel', initial_value: channel }
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
