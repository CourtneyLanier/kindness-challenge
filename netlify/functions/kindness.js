const axios = require('axios');

exports.handler = async (event) => {
  const params = new URLSearchParams(event.body);
  const trigger_id = params.get('trigger_id');

  const modal = {
    trigger_id,
    view: {
      type: 'modal',
      callback_id: 'kindness_modal',
      title: {
        type: 'plain_text',
        text: 'Kindness Challenge'
      },
      submit: {
        type: 'plain_text',
        text: 'Submit'
      },
      close: {
        type: 'plain_text',
        text: 'Cancel'
      },
      blocks: [
        {
          type: 'input',
          block_id: 'description_block',
          label: {
            type: 'plain_text',
            text: 'What act of kindness did you do?'
          },
          element: {
            type: 'plain_text_input',
            action_id: 'description',
            multiline: true
          }
        },
        {
		  type: 'input',
		  block_id: 'prayer_block',
		  optional: true,
		  label: {
			type: 'plain_text',
			text: 'How can we pray for this situation?'
		  },
		  element: {
			type: 'plain_text_input',
			action_id: 'prayer',
			multiline: true
		  }
		},
        {
          type: 'input',
          block_id: 'anon_block',
          label: {
            type: 'plain_text',
            text: 'Do you want your name included?'
          },
          element: {
            type: 'static_select',
            action_id: 'anon_choice',
            options: [
              {
                text: { type: 'plain_text', text: 'Yes' },
                value: 'yes'
              },
              {
                text: { type: 'plain_text', text: 'No' },
                value: 'no'
              }
            ]
          }
        }
      ]
    }
  };

  try {
    const response = await axios.post('https://slack.com/api/views.open', modal, {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    return {
      statusCode: 200,
      body: ''
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: 'Error opening modal'
    };
  }
};
