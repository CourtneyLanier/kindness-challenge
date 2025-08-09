// netlify/functions/interact.js
const axios = require('axios');
const crypto = require('crypto');

/* ========= Netlify Blobs (HTTP API) ========= */
const SITE_ID   = process.env.NETLIFY_SITE_ID;
const API_TOKEN = process.env.NETLIFY_API_TOKEN;
const STORE     = `https://api.netlify.com/api/v1/blobs/sites/${SITE_ID}/stores/kindness-installs`;

async function fetchInstall(team_id) {
  const key = `team:${team_id}`;
  try {
    const res = await axios.get(`${STORE}/items/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      responseType: 'text'
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
  await axios.put(
    `${STORE}/items/${encodeURIComponent(key)}`,
    JSON.stringify(record),
    { headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

/* ========= Slack signature verification ========= */
function isSlackSignatureValid({ signingSecret, body, timestamp, signature }) {
  if (!timestamp || !signature) return false;

  // prevent replay (>5 mins old)
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

/* ========= Slack helpers ========= */
// Accepts: C-id, #name, or <#C…|name> mention format
async function resolveChannelId(botToken, input) {
  if (!input) return null;
  let val = input.trim();

  // Mention format like <#C123|channel>
  const m = val.match(/^<\#(C[A-Z0-9]+)\|.*>$/i);
  if (m) return m[1];

  // Raw channel ID
  if (/^C[A-Z0-9]+$/i.test(val)) return val;

  // Strip leading # for name
  val = val.replace(/^#/, '').toLowerCase();

  // conversations.list (iterate pages)
  let cursor = '';
  do {
    const resp = await axios.get('https://slack.com/api/conversations.list', {
      headers: { Authorization: `Bearer ${botToken}` },
      params: { limit: 1000, cursor, exclude_archived: true, types: 'public_channel,private_channel' }
    });
    if (!resp.data.ok) throw new Error(`conversations.list error: ${resp.data.error}`);

    const found = (resp.data.channels || []).find(ch => (ch.name || '').toLowerCase() === val);
    if (found) return found.id;

    cursor = resp.data.response_metadata?.next_cursor || '';
  } while (cursor);

  return null;
}

// Count messages posted by this app's bot in a channel since `oldest`
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
    // Only count messages posted by this app's bot (matches bot_user id)
    total += msgs.filter(m => m.bot_id && bot_user && m.bot_id === bot_user).length;

    cursor = resp.data.response_metadata?.next_cursor || '';
  } while (cursor);

  return total;
}

/* ========= Main handler ========= */
exports.handler = async (event) => {
  // Verify Slack signature
  const timestamp = event.headers['x-slack-request-timestamp'];
  const signature = event.headers['x-slack-signature'];
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!isSlackSignatureValid({ signingSecret, body: event.body, timestamp, signature })) {
    console.error('❌ Invalid Slack signature');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  // Slack sends application/x-www-form-urlencoded with "payload=..."
  const params = new URLSearchParams(event.body);
  const payload = JSON.parse(params.get('payload') || '{}');

  // Always respond with something Slack understands
  const clear = () => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_action: 'clear' })
  });

  /* ======== CONFIG SAVE (from /kindness-config modal) ======== */
  if (payload.type === 'view_submission' && payload.view.callback_id === 'kindness_config_modal') {
    const meta = JSON.parse(payload.view.private_metadata || '{}');
    const team_id = meta.team_id || payload.team?.id;
    const values = payload.view.state.values;

    const startStr   = values.start_block?.start?.value?.trim() || '';
    const endStr     = values.end_block?.end?.value?.trim() || '';
    const goalStr    = values.goal_block?.goal?.value?.trim() || '';
    const channelInp = (values.channel_block?.channel?.value || '').trim();
    const fallbackChannel = meta.channel_id || null; // where /kindness-config was used

    const errors = {};
    const goal = parseInt(goalStr, 10);
    if (!goal || goal < 1) errors['goal_block'] = 'Enter a positive number';

    const toTs = (s) => s ? Math.floor(new Date(`${s}T00:00:00Z`).getTime() / 1000) : null;
    const start = toTs(startStr);
    const end   = toTs(endStr);
    if (!start) errors['start_block'] = 'Use YYYY-MM-DD';
    if (!end)   errors['end_block'] = 'Use YYYY-MM-DD';
    if (start && end && end < start) errors['end_block'] = 'End must be after Start';

    const install = await fetchInstall(team_id);
    const botToken = install?.bot_token || process.env.SLACK_BOT_TOKEN;

    // Resolve channel: if field empty, use the channel where command ran
    let channel_id = null;
    if (channelInp) {
      channel_id = await resolveChannelId(botToken, channelInp);
    } else {
      channel_id = fallbackChannel;
    }

    if (!channel_id) {
      errors['channel_block'] = 'Channel not found. Invite the bot to the channel and try again, or run /kindness-config in the target channel and leave this blank.';
    }

    if (Object.keys(errors).length) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_action: 'errors', errors })
      };
    }

    // Save config
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

  /* ======== KINDNESS SUBMISSION (from /kindness modal) ======== */
  if (payload.type === 'view_submission' && payload.view.callback_id === 'kindness_modal') {
    const meta = JSON.parse(payload.view.private_metadata || '{}');
    const team_id     = meta.team_id || payload.team?.id;
    const channelMeta = meta.channel_id || null;

    const values = payload.view.state.values;
    const description = values.description_block?.description?.value || '';
    const prayer      = values.prayer_block?.prayer?.value || '';
    const anon        = values.anon_block?.anon_choice?.selected_option?.value || 'no';
    const username    = payload.user?.name || 'Someone';

    // Load per-workspace install/config
    const install   = await fetchInstall(team_id);
    const botToken  = install?.bot_token || process.env.SLACK_BOT_TOKEN;
    const bot_user  = install?.bot_user || null;
    const team_name = install?.team_name || payload.team?.domain || 'teammate';
    const goal      = Number.isInteger(install?.goal) ? install.goal : 100;
    const start     = install?.start ?? 0;
    const channel_id = install?.channel_id || channelMeta || process.env.CHANNEL_ID;

    if (!channel_id) {
      console.error('No channel_id available for team', team_id);
      return clear();
    }

    // Base text + prayer, honoring anonymity
    let baseText;
    if (anon === 'yes') {
      // Yes = include name
      baseText = `${username} shared: _"${description}"_`;
    } else {
      baseText = `A ${team_name} teammate shared: _"${description}"_`;
    }
    if (prayer) baseText += `\n🙏 Prayer request: _"${prayer}"_`;

    // Before start date: just post base text (no counter/candles)
    const now = Math.floor(Date.now() / 1000);
    if (start && now < start) {
      try {
        await axios.post(
          'https://slack.com/api/chat.postMessage',
          { channel: channel_id, text: baseText },
          { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        console.error('post (pre-start) error:', e.response?.data || e.message);
      }
      return clear();
    }

    // After start: count acts by this bot in this channel since start
    let count = 0;
    try {
      count = await countActs({ botToken, channel_id, oldest: start || 0, bot_user });
    } catch (e) {
      console.error('countActs error:', e.message);
    }

    const nextAct  = count + 1;
    const remaining = Math.max(0, goal - nextAct);
    const lit   = Math.min(nextAct, goal);
    const unlit = Math.max(goal - lit, 0);
    const candleBar = '🔥'.repeat(lit) + '🕯️'.repeat(unlit);

    const text = `Act #${nextAct}: ${baseText}\nOnly ${remaining} more to go!\n${candleBar}`;

    try {
      const res = await axios.post(
        'https://slack.com/api/chat.postMessage',
        { channel: channel_id, text },
        { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' } }
      );
      if (!res.data.ok) console.error('chat.postMessage error:', res.data.error);
    } catch (e) {
      console.error('postMessage error:', e.response?.data || e.message);
    }

    return clear();
  }

  // Default: clear
  return clear();
};
