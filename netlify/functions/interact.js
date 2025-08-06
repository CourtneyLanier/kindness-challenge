const axios = require('axios');

exports.handler = async (event) => {
  // Parse the Slack payload
  const params = new URLSearchParams(event.body);
	const payload = JSON.parse(params.get('payload'));

  if (payload.type === 'view_submission' && payload.view.callback_id === 'kindness_modal') {
    const values = payload.view.state.values;
	const description = values.description_block.description.value;
	const prayer = values.prayer_block?.prayer?.value || '';
	const anon = values.anon_block.anon_choice.selected_option.value;
	const username = payload.user.name;

	let text = anon === 'yes'
	  ? `A 3 Strand teammate shared: _"${description}"_`
	  : `${username} shared: _"${description}"_`;

	if (prayer) {
	  text += `\n🙏 Prayer request: _"${prayer}"_`;
	}
    // Post to Slack channel
    await axios.post('https://slack.com/api/chat.postMessage', {
      channel: process.env.CHANNEL_ID,
      text
    }, {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  }

  // Respond to Slack to clear the modal
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_action: 'clear' })
  };
};
