// netlify/functions/interact.js
const axios = require('axios');
const crypto = require('crypto');

// ---- Netlify Blobs (HTTP API) helpers ----
const SITE_ID = process.env.NETLIFY_SITE_ID;
const NTLI_TOKEN = process.env.NETLIFY_API_TOKEN;
const STORE_BASE = `https://api.netlify.com/api/v1/blobs/sites/${SITE_ID}/stores/kindness-installs`;

async function fetchInstall(team_id) {
  const key = `team:${team_id}`;
  try {
    const res = await axios.get(`${STORE_BASE}/items/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${NTLI_TOKEN}` }, responseType: 'text'
    });
    return res.data ? JSON.parse(res.data) : null;
  } catch (e) {
    if (e.response && e.response.status === 404) return null;
    console.error('fetchInstall error:', e.response?.data || e.message);
    return null;
  }
}

async function saveInstall(team_id, record) {
  const key = `team:${team_id}`;
  await axios.put(`${STORE_BASE}/items/${encodeURIComponent(key)}`,
    JSON.stringify(record),
    { headers: { Authorization: `Bearer ${NTLI_TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

// ---- Slack signature verification ----
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

// ---- Channel resolution (accepts C-id, #name, or <#C…|name>) ----
async function resolveChannelId(botToken, input) {
  if (!input) return null;
  let i = input.trim();

  // Slack mention format like <#C123|channel-name>
  const m = i.match(/^<\#(C[A-Z0-9]+)\|.*>$/i);
  if (m) return m[1];

  // Raw channel ID
  if (/^C[A-Z0-9]+$/i.test(i)) return i;

  // Strip leading #
  i = i.replace(/^#/, '').toLowerCase();

  // Search via conversations.list
  let cursor = '';
  do {
    const resp = await axios.get('https://slack.com/api/conversations.list', {
      headers: { Authorization: `Bearer ${botToken}` },
      params: { limit: 1000, cursor, exclude_archived: true, types: 'public_channel,private_channel' }
    });
    if (!resp.data.ok) throw new Error(`conversations.list error: ${resp.data.error}`);
    const found = (resp.data.channels || []).find(ch => (ch.name || '').toLowerCase() === i);
    if (found) return found.id;
    cursor = resp.data.response_metadata?.next_cursor || '';
  } while (cursor);

  return null;
}

// ---- Count acts posted by this bot since "oldest" ----
async function countActs({ botToken, channel_id, oldest, bot_user }) {
  let total = 0;
  let cursor = '';

  do {
    const resp = await axios.get('https://slack.com/api/conversations.history', {
      headers: { Authorization: `Bearer ${botToken}` },
      params: { channel: channel_id, oldest, limit: 200, cursor }
    });
    if (!resp.data.ok) throw new Error(`conversations.history error: ${resp.data.error}`);

    // Count only messages posted by this app's bot (prevents counting chatter)
    const msgs = resp.data.messages || [];
    total += msgs.filter(m => m.bot_id && bot_user && m.bot_id === bot_user).length;

    cursor = resp.data.response_metadata?.next_cursor || '';
  } while (cursor);

  return total;
}

exports.handler = async (event) => {
  // Verify Slack signature
  const timestamp = event.headers['x-slack-request-timestamp'];
  const signature = event.headers['x-slack-signature'];
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!isSlackSignatureValid({ signingSecret, body: event.body, timestamp, signature })) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  // Slack sends urlencoded "payload="
  const params = new URLSearchParams(event.body);
  const payload = JSON.parse(params.get('payload') || '{}');

  // Respond helper
  const clear = () => ({
    statusCode: 200, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_action: 'clear' })
  });

  // ---------- Handle CONFIG SAVE ----------
  if (payload.type === 'view_submission' && payload.view.callback_id === 'kindness_config_modal') {
    const meta = JSON.parse(payload.view.private_metadata || '{}');
    const team_id = meta.team_id || payload.team?.id;
    const values = payload.view.state.values;

    const startStr   = values.start_block?.start?.value?.trim() || '';
    const endStr     = values.end_block?.end?.value?.trim() || '';
    const goalStr    = values.goal_block?.goal?.value?.trim() || '';
    const channelInp = values.channel_block?.channel?.value?.trim() || '';

    // Validate
    const errors = {};
    const goal = parseInt(goalStr, 10);
    if (!goal || goal < 1) errors['goal_block'] = 'Enter a positive number';

    const toTs = (s) => s ? Math.floor(new Date(`${s}T00:00:00Z`).getTime() / 1000) : null;
    const start = toTs(startStr);
    const end   = toTs(endStr);
    if (!start) errors['start_block'] = 'Use YYYY-MM-DD';
    if (!end)   errors['end_block'] = 'Use YYYY-MM-DD';
    if (start && end && end < start) errors['end_block'] = 'End must be after Start';

    // Get install to obtain workspace bot token (needed to resolve channel names)
    const install = await fetchInstall(team_id);
    const botToken = install?.bot_token || process.env.SLACK_BOT_TOKEN;

    // Resolve channel
    const channel_id = await resolveChannelId(botToken, channelInp);
    if (!channel_id) errors['channel_block'] = 'Channel not found or bot not invited';

    if (Object.keys(errors).length) {
      return {
        statusCode: 200, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_action: 'errors', errors })
      };
    }

    // Save
    const record = {
      ...(install || {}),
      team_id,
      channel_id,
      goal,
      start,
      end
    };
    await saveInstall(team_id, record);
    return clear();
  }

  // ---------- Handle KINDNESS SUBMISSION ----------
  if (payload.type === 'view_submission' && payload.view.callback_id === 'kindness_modal') {
    const meta = JSON.parse(payload.view.private_metadata || '{}');
    const team_id = meta.team_id || payload.team?.id;
    const channelMeta = meta.channel_id || null;

    const values = payload.view.state.values;
    const description = values.description_block.description.value;
    const prayer = values.prayer_block?.prayer?.value || '';
    const anon = values.anon_block.anon_choice.selected_option.value;
    const username = payload.user?.name || 'Someone';

    // Load per-workspace config & token
    const install = await fetchInstall(team_id);
    const botToken  = install?.bot_token || process.env.SLACK_BOT_TOKEN;
    const bot_user  = install?.bot_user || null;
    const team_name = install?.team_name || payload.team?.domain || 'teammate';
    const goal      = install?.goal ?? 100;
    const start     = install?.start ?? 0;
    const channel_id = install?.channel_id || channelMeta || process.env.CHANNEL_ID;

    if (!channel_id) {
      // No channel configured & none passed; bail gracefully
      console.error('No channel_id available for team', team_id);
      return clear();
    }

    // Build base text + prayer
    let baseText;
    if (anon === 'yes') {
      // Yes = include name
      baseText = `${username} shared: _"${description}"_`;
    } else {
      baseText = `A ${team_name} teammate shared: _"${description}"_`;
    }
    if (prayer) baseText += `\n🙏 Prayer request: _"${prayer}"_`;

    // Pre-start gate: before Start date, just post the base text (no counter/candles)
    const now = Math.floor(Date.now() / 1000);
    if (start && now < start) {
      await axios.post('https://slack.com/api/chat.postMessage',
        { channel: channel_id, text: baseText },
        { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' } }
      );
      return clear();
    }

    // Count acts posted by this bot since "start"
    let count = 0;
    try {
      count = await countActs({ botToken, channel_id, oldest: start || 0, bot_user });
    } catch (e) {
      console.error('countActs error:', e.message);
    }

    const nextAct = count + 1;
    const remaining = Math.max(0, goal - nextAct);
    const lit = Math.min(nextAct, goal);
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

  // Default: clear any other interactions
  return clear();
};
