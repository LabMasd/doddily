#!/usr/bin/env bash
# Send stdin as one Telegram message through the home server's existing bot, the same way
# ~/server-report/report.sh does: token from Claude's Telegram channel .env, chat id from
# ~/server-report/chat_id. Sending only (never reads updates), so it does not clash with the
# Claude session that reads the bot. The token goes to curl on stdin, never on a command line.
set -u
ENV_FILE="${FRESHNESS_TG_ENV:-$HOME/.claude/channels/telegram/.env}"
CHAT_FILE="${FRESHNESS_TG_CHAT:-$HOME/server-report/chat_id}"
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DIR/PAUSED" ]; then echo "freshness: paused, not sending" >&2; exit 0; fi
text="$(cat)"
token="$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$ENV_FILE" 2>/dev/null | head -1 | tr -d "\"'")"
chat="$(cat "$CHAT_FILE" 2>/dev/null)"
if [ -z "$token" ] || [ -z "$chat" ]; then echo "$(date '+%F %T') freshness: no token or chat id" >&2; exit 1; fi
code="$(printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token" |
  curl -sS -m 20 -K - -o /dev/null -w '%{http_code}' \
    --data-urlencode "chat_id=$chat" --data-urlencode "text=$text" 2>/dev/null)"
if [ "$code" != 200 ]; then echo "$(date '+%F %T') freshness: send failed (http ${code:-none})" >&2; exit 1; fi
