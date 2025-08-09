// netlify/functions/kindness.js
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

// Blobs helper
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
  const team_id = params.get('team_id');
  const channel_id = params.get('channel_id'); // channel where slash command was used

  const install = await fetchInstall(team_id);
  const botToken = install?.bot_token || process.env.SLACK_BOT_TOKEN;

  const view = {
    type: 'modal',
    callback_id: 'kindness_modal',
    private_metadata: JSON.stringify({ team_id, channel_id }),
    title: { type: 'plain_text', text: 'Kindness Challenge' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'description_block',
        label: { type: 'plain_text', text: 'What act of kindness did you do?' },
        element: { type: 'plain_text_input', action_id: 'description', multiline: true }
      },
      {
        type: 'input',
        block_id: 'prayer_block',
        optional: true,
        label: { type: 'plain_text', text: 'How can we pray for this situation?' },
        element: { type: 'plain_text_input', action_id: 'prayer', multiline: true }
      },
      {
        type: 'input',
        block_id: 'anon_block',
        label: { type: 'plain_text', text: 'Do you want your name included?' },
        element: {
          type: 'static_select',
          action_id: 'anon_choice',
          options: [
            { text: { type: 'plain_text', text: 'Yes' }, value: 'yes' },
            { text: { type: 'plain_text', text: 'No' }, value: 'no' }
          ]
        }
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
    return { statusCode: 500, body: 'Error opening modal' };
  }
};
