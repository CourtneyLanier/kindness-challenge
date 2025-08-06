const axios = require('axios');

// Log the channel ID at cold start
console.log('▶️ CHANNEL_ID from env:', process.env.CHANNEL_ID);

exports.handler = async (event) => {
  console.log('▶️ interact invoked with body:', event.body);
  console.log('▶️ headers:', JSON.stringify(event.headers));

  // Utility to clear the Slack modal
  const respondClear = () => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_action: 'clear' })
  });

  try {
    // Parse the urlencoded body to get the Slack payload
    const params = new URLSearchParams(event.body);
    const payload = JSON.parse(params.get('payload'));

    // Only handle our modal submissions
    if (payload.type === 'view_submission' && payload.view.callback_id === 'kindness_modal') {
      const values = payload.view.state.values;
      const description = values.description_block.description.value;
      const prayer = values.prayer_block?.prayer?.value || '';
      const anon = values.anon_block.anon_choice.selected_option.value;
      const username = payload.user.name;

      // Build the base message text (without prefix/count)
      let baseText = anon === 'yes'
        ? `A 3 Strand teammate shared: _"${description}"_`
        : `${username} shared: _"${description}"_`;
      if (prayer) {
        baseText += `\n🙏 Prayer request: _"${prayer}"_`;
      }

      // Fetch current count from our count function
      const host = event.headers.host; // e.g. kindness-challenge.netlify.app
      let count = 0;
      try {
        const countRes = await axios.get(`https://${host}/.netlify/functions/count`);
        count = countRes.data.count || 0;
        console.log('▶️ fetched count:', count);
      } catch (err) {
        console.error('❌ error fetching count:', err);
      }

      // Compute next act number, remaining, and candle bar
      const nextAct = count + 1;
      const remaining = Math.max(0, 100 - nextAct);
      const candleBar = '🔥'.repeat(nextAct) + '🕯️'.repeat(remaining);

      // Final text with progress
      const text = 
        `Act #${nextAct}: ${baseText}` +
        `\nOnly ${remaining} more to go!` +
        `\n${candleBar}`;

      console.log(`▶️ Posting message to channel ${process.env.CHANNEL_ID}:`, text);

      // Post to Slack
      try {
        const slackRes = await axios.post(
          'https://slack.com/api/chat.postMessage',
          { channel: process.env.CHANNEL_ID, text },
          {
            headers: {
              Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log('▶️ Slack API response:', slackRes.data);
        if (!slackRes.data.ok) {
          console.error('❌ Slack returned an error:', slackRes.data.error);
        }
      } catch (postErr) {
        console.error('❌ Error posting to Slack:', postErr.response?.data || postErr);
      }
    }
  } catch (err) {
    console.error('❌ Error handling submission:', err);
  }

  // Always clear the modal so Slack doesn’t show an error
  return respondClear();
};
