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

      // Build the message text
      let text = anon === 'yes'
        ? `A 3 Strand teammate shared: _"${description}"_`
        : `${username} shared: _"${description}"_`;

      if (prayer) {
        text += `\n🙏 Prayer request: _"${prayer}"_`;
      }

      // Log what we're about to post
      console.log(`▶️ Posting message to channel ${process.env.CHANNEL_ID}:`, text);

      // Post to Slack, capture and log the response
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
