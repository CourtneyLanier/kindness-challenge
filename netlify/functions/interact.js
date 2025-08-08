const axios = require('axios');
const crypto = require('crypto');

console.log('▶️ CHANNEL_ID from env:', process.env.CHANNEL_ID);

// --- Slack signature verification helper ---
function isSlackSignatureValid({ signingSecret, body, timestamp, signature }) {
  if (!timestamp || !signature) return false;

  // prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) {
    return false;
  }

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

  // Utility to clear the Slack modal
  const respondClear = () => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_action: 'clear' })
  });

  try {
    const params = new URLSearchParams(event.body);
    const payload = JSON.parse(params.get('payload'));

    if (payload.type === 'view_submission' && payload.view.callback_id === 'kindness_modal') {
      const values = payload.view.state.values;
      const description = values.description_block.description.value;
      const prayer = values.prayer_block?.prayer?.value || '';
      const anon = values.anon_block.anon_choice.selected_option.value;
      const username = payload.user.name;

      // Build base text + prayer
      let baseText;
      if (anon === 'yes') {
        baseText = `${username} shared: _"${description}"_`;
      } else {
        baseText = `A 3 Strand teammate shared: _"${description}"_`;
      }
      if (prayer) {
        baseText += `\n🙏 Prayer request: _"${prayer}"_`;
      }

      // Count (pre-start gate optional; uncomment if you want to hide progress before your start date)
      // const start = parseInt(process.env.CHALLENGE_START || '0', 10);
      // const now = Math.floor(Date.now()/1000);
      // if (start && now < start) {
      //   await axios.post('https://slack.com/api/chat.postMessage',
      //     { channel: process.env.CHANNEL_ID, text: baseText },
      //     { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' } }
      //   );
      //   return respondClear();
      // }

      // Fetch current count from our count function
      let count = 0;
      try {
        const host = event.headers.host; // e.g. kindness-challenge.netlify.app
        const countRes = await axios.get(`https://${host}/.netlify/functions/count`);
        count = countRes.data.count || 0;
      } catch (err) {
        console.error('❌ error fetching count:', err?.response?.data || err.message);
      }

      const nextAct = count + 1;
      const remaining = Math.max(0, 100 - nextAct);
      const candleBar = '🔥'.repeat(nextAct) + '🕯️'.repeat(remaining);

      const text = `Act #${nextAct}: ${baseText}\nOnly ${remaining} more to go!\n${candleBar}`;

      try {
        const slackRes = await axios.post(
          'https://slack.com/api/chat.postMessage',
          { channel: process.env.CHANNEL_ID, text },
          { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        if (!slackRes.data.ok) console.error('❌ Slack returned an error:', slackRes.data.error);
      } catch (postErr) {
        console.error('❌ Error posting to Slack:', postErr.response?.data || postErr.message);
      }
    }
  } catch (err) {
    console.error('❌ Error handling submission:', err);
  }

  return respondClear();
};
