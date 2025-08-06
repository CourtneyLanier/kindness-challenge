const axios = require('axios');

exports.handler = async (event) => {
  // Always respond with JSON so Slack doesn’t error
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

      // Build the text
      let text = anon === 'yes'
        ? `A 3 Strand teammate shared: _"${description}"_`
        : `${username} shared: _"${description}"_`;

      if (prayer) {
        text += `\n🙏 Prayer request: _"${prayer}"_`;
      }

      // Post to Slack, but if it fails we still close the modal
      try {
        await axios.post('https://slack.com/api/chat.postMessage',
          { channel: process.env.CHANNEL_ID, text },
          { headers: {
              Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (postErr) {
        console.error('Error posting to Slack:', postErr.response?.data || postErr);
      }
    }
  } catch (err) {
    console.error('Error handling submission:', err);
    // We could return errors to Slack here, but we'll just clear the modal
  }

  // Always clear the modal so Slack shows no error
  return respondClear();
};
