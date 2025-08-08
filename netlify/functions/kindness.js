const axios = require('axios');
const crypto = require('crypto');

// --- Slack signature verification helper ---
function isSlackSignatureValid({ signingSecret, body, timestamp, signature }) {
  if (!timestamp || !signature) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) return false;

  const basestring = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(basestring).digest('hex');
  const mySig = `v0=${hmac}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(mySig, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  // Verify Slack signature
  const timestamp = event.headers['x-slack-request-timestamp'];
  const signature = event.headers['x-slack-signature'];
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!isSlackSignatureValid({ signingSecret, body: event.body, timestamp, signature })) {
    console.error('❌ Invalid Slack signature');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  const params = new URLSearchParams(event.body);
  const trigger_id = params.get('trigger_id');

  const modal = {
    trigger_id,
    view: {
      type: 'modal',
      callback_id: 'kindness_modal',
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
    }
  };

  try {
    await axios.post('https://slack.com/api/views.open', modal, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' }
    });
    return { statusCode: 200, body: '' };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Error opening modal' };
  }
};
