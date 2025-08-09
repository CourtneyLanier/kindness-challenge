# Rhoda – Kindness Challenge for Slack

Run a seasonal kindness campaign (e.g., “100 Acts in 100 Days”) directly in Slack:
- Anonymous or named submissions via `/kindness`
- Optional prayer request field
- Per-workspace config (`/kindness-config`) for Start/End/Goal + channel binding
- In-channel progress bar (🔥 lit, 🕯️ unlit)
- Reset a season with `/kindness-reset`

## Install (for a new workspace)
1. Click **Add to Slack** on the site (or use the OAuth link below).
2. Create/choose a channel and add the app.
3. In that channel, run `/kindness-config` to set Start/End/Goal.
4. Teammates submit with `/kindness`.

### Add-to-Slack URL (example)
https://slack.com/oauth/v2/authorize?client_id=293633679958.9306655997923&scope=commands,chat:write,chat:write.public,channels:read,channels:history&redirect_uri=https%3A%2F%2FYOUR_SITE%2F.netlify%2Ffunctions%2Foauth

## Deploy / Self-host

Environment variables (Netlify → Site settings → Build & deploy → Environment):

- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_SIGNING_SECRET`
- `APP_BASE_URL` = `https://YOUR_SITE`
- `NETLIFY_SITE_ID` = your site’s API ID
- `NETLIFY_API_TOKEN` = PAT from the same Netlify team as the site

Recommended Slack scopes:  
`commands, chat:write, chat:write.public, channels:read, channels:history`

Slash commands (in your Slack app config):

- `/kindness` → `https://YOUR_SITE/.netlify/functions/kindness`
- `/kindness-config` → `https://YOUR_SITE/.netlify/functions/config`
- `/kindness-reset` → `https://YOUR_SITE/.netlify/functions/reset`

## Notes
- The app posts and counts in the configured channel only.
- Before the Start date, submissions post without numbering/candles.
- Counting is based on bot messages in that channel since Start.
