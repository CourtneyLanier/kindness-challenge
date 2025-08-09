// netlify/functions/interact.js
const axios = require('axios');
const crypto = require('crypto');

// --- Blobs SDK helpers ---
async function getStoreClient() {
  const { getStore } = await import('@netlify/blobs');
  return getStore('kindness-installs', {
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_API_TOKEN
  });
}
async function fetchInstall(team_id) {
  try {
    const store = await getStoreClient();
    const raw = await store.get(`team:${team_id}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('fetchInstall error:', e.message || e);
    return null;
  }
}
async function saveInstall(team_id, record) {
  const store = await getStoreClient();
  await store.set(`team:${team_id}`, JSON.stringify(record));
}

// --- Slack signature verification ---
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

// --- Count messages posted by this app's bot since `oldest` ---
async function countActs({ botToken, channel_id, oldest, bot_user }) {
  let total = 0;
  let cursor = '';
  do {
    const resp = await axios.get('https://slack.com/api/conversations.history', {
      headers: { Authorization: `Bearer ${botToken}` },
      params: { channel: channel_id, oldest, limit: 200, cursor }
    });
    if (!resp.data.ok) throw new Error(`conversations.history error: ${resp.data.error}`);
    const msgs = resp.data.messages || [];
    total += msgs.filter(m => m.bot_id && bot_user && m.bot_id === bot_user).length;
    cursor = resp.data.response_metadata?.next_cursor || '';
  } while (cursor);
  return total;
}

exports.handler = async (event) => {
  const timestamp = event.headers['x-slack-request-timestamp'];
  const signature = event.headers['x-slack-signature'];
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!isSlackSignatureValid({ signingSecret, body: event.body, timestamp, signature })) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  const params = new URLSearchParams(event.body);
  const payload = JSON.parse(params.get('payload') || '{}');

  const clear = () => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_action: 'clear' })
  });

  // ===== Save config (bind to channel where command ran) =====
  if (payload.type === 'view_submission' && payload.view.callback_id === 'kindness_config_modal') {
    const meta       = JSON.parse(payload.view.private_metadata || '{}');
    const team_id    = meta.team_id || payload.team?.id;
    const channel_id = meta.channel_id;

    if (!channel_id || !channel_id.startsWith('C')) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response_action: 'errors',
          errors: { start_block: 'Run /kindness-config inside the channel you want to use.' }
        })
      };
    }

    const values   = payload.view.state.values;
    const startStr = values.start_block?.start?.value?.trim() || '';
    const endStr   = values.end_block?.end?.value?.trim() || '';
    const goalStr  = values.goal_block?.goal?.value?.trim() || '';

    const errors = {};
    const goal = parseInt(goalStr, 10);
    if (!goal || goal < 1) errors['goal_block'] = 'Enter a positive number';

    const toTs = (s) => s ? Math.floor(new Date(`${s}T00:00:00Z`).getTime() / 1000) : null;
    const start = toTs(startStr);
    const end   = toTs(endStr);
    if (!start) errors['start_block'] = 'Use YYYY-MM-DD';
    if (!end)   errors['end_block'] = 'Use YYYY-MM-DD';
    if (start && end && end < start) errors['end_block'] = 'End must be after Start';

    if (Object.keys(errors).length) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_action: 'errors', errors })
      };
    }

    const install = await fetchInstall(team_id);
    const record = { ...(install || {}), team_id, channel_id, goal, start, end };
    await saveInstall(team_id, record);
    return clear();
  }

  // ===== Handle kindness modal submission =====
  if (payload.type === 'view_submission' && payload.view.callback_id === 'kindness_modal') {
    const meta = JSON.parse(payload.view.private_metadata || '{}');
    const team_id = meta.team_id || payload.team?.id;

    const values = payload.view.state.values;
    const description = values.description_block?.description?.value || '';
    const prayer      = values.prayer_block?.prayer?.value || '';
    const anon        = values.anon_block?.anon_choice?.selected_option?.value || 'no';
    const username    = payload.user?.name || 'Someone';

    const install   = await fetchInstall(team_id);
    const botToken  = install?.bot_token || process.env.SLACK_BOT_TOKEN;
    const bot_user  = install?.bot_user || null;
    const team_name = install?.team_name || payload.team?.domain || 'teammate';
    const goal      = Number.isInteger(install?.goal) ? install.goal : 100;
    const start     = install?.start ?? 0;
    const channel_id = install?.channel_id || process.env.CHANNEL_ID;

    if (!channel_id) return clear();

    let baseText;
    if (anon === 'yes') {
      baseText = `${username} shared: _"${description}"_`;
    } else {
      baseText = `A ${team_name} teammate shared: _"${description}"_`;
    }
    if (prayer) baseText += `\n🙏 Prayer request: _"${prayer}"_`;

    const now = Math.floor(Date.now() / 1000);
    if (start && now < start) {
      try {
        await axios.post('https://slack.com/api/chat.postMessage',
          { channel: channel_id, text: baseText },
          { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        console.error('post (pre-start) error:', e.response?.data || e.message);
      }
      return clear();
    }

    let count = 0;
    try {
      count = await countActs({ botToken, channel_id, oldest: start || 0, bot_user });
    } catch (e) {
      console.error('countActs error:', e.message);
    }

    const nextAct = count + 1;
    const remaining = Math.max(0, goal - nextAct);
    const lit   = Math.min(nextAct, goal);
    const unlit = Math.max(goal - lit, 0);
    const candleBar = '🔥'.repeat(lit) + '🕯️'.repeat(unlit);

    const text = `Act #${nextAct}: ${baseText}\nOnly ${remaining} more to go!\n${candleBar}`;

    try {
      const res = await axios.post('https://slack.com/api/chat.postMessage',
        { channel: channel_id, text },
        { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' } }
      );
      if (!res.data.ok) console.error('chat.postMessage error:', res.data.error);
    } catch (e) {
      console.error('postMessage error:', e.response?.data || e.message);
    }

    return clear();
  }

  return clear();
};
