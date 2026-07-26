#!/bin/sh

set -eu

SSH_BIN="${TG_YOOMONEY_TUNNEL_SSH_BIN:-/usr/bin/ssh}"
HOST="${TG_YOOMONEY_TUNNEL_HOST:-}"
PORT="${TG_YOOMONEY_TUNNEL_PORT:-22}"
USER_NAME="${TG_YOOMONEY_TUNNEL_USER:-root}"
REMOTE_PORT="${TG_YOOMONEY_TUNNEL_REMOTE_PORT:-18101}"
LOCAL_HOST="${TG_YOOMONEY_TUNNEL_LOCAL_HOST:-127.0.0.1}"
LOCAL_PORT="${TG_YOOMONEY_TUNNEL_LOCAL_PORT:-8100}"
PRIVATE_KEY="${TG_YOOMONEY_TUNNEL_PRIVATE_KEY:-}"
ACCEPT_HOSTKEY="${TG_YOOMONEY_TUNNEL_ACCEPT_HOSTKEY:-1}"
STATUS_PATH="${TG_YOOMONEY_TUNNEL_STATUS_PATH:-/var/run/tg-paidmedia/yoomoney-tunnel.status}"
RETRY_DELAY="${TG_YOOMONEY_TUNNEL_RETRY_DELAY:-10}"
ATTEMPT="0"

if [ -z "$HOST" ]; then
	echo "tg-paidmedia tunnel: remote host is not configured" >&2
	exit 1
fi

if [ -n "$PRIVATE_KEY" ] && [ ! -f "$PRIVATE_KEY" ]; then
	echo "tg-paidmedia tunnel: private key does not exist: $PRIVATE_KEY" >&2
	exit 1
fi

DESTINATION="${USER_NAME}@${HOST}"
REMOTE_BIND="127.0.0.1:${REMOTE_PORT}:${LOCAL_HOST}:${LOCAL_PORT}"
SSH_VERSION="$("$SSH_BIN" -V 2>&1 || true)"

mkdir -p "$(dirname "$STATUS_PATH")"

timestamp_utc() {
	date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date
}

sanitize_line() {
	printf '%s' "$1" | tr '\r\n' '  '
}

write_status() {
	local state="$1"
	local message="${2:-}"
	local checked_at tmp_path

	checked_at="$(timestamp_utc)"
	tmp_path="${STATUS_PATH}.tmp.$$"
	{
		printf 'state=%s\n' "$state"
		printf 'checked_at=%s\n' "$checked_at"
		printf 'pid=%s\n' "$$"
		printf 'attempt=%s\n' "$ATTEMPT"
		printf 'target=%s\n' "${DESTINATION}:${REMOTE_PORT} -> ${LOCAL_HOST}:${LOCAL_PORT}"
		printf 'message=%s\n' "$(sanitize_line "$message")"
	} > "$tmp_path"
	mv "$tmp_path" "$STATUS_PATH"
}

stop_tunnel() {
	write_status "stopped" "Tunnel process stopped"
	exit 0
}

trap stop_tunnel INT TERM

set -- "$SSH_BIN" -N

case "$SSH_VERSION" in
	*Dropbear*|*dbclient*)
		if [ "$ACCEPT_HOSTKEY" = "1" ]; then
			set -- "$@" -y
		fi
		set -- "$@" -K 30 -I 60
		;;
	*)
		set -- "$@" \
			-o ExitOnForwardFailure=yes \
			-o ServerAliveInterval=30 \
			-o ServerAliveCountMax=3 \
			-o BatchMode=yes
		if [ "$ACCEPT_HOSTKEY" = "1" ]; then
			set -- "$@" -o StrictHostKeyChecking=accept-new
		fi
		;;
esac

if [ -n "$PRIVATE_KEY" ]; then
	set -- "$@" -i "$PRIVATE_KEY"
fi

if [ -n "$PORT" ]; then
	set -- "$@" -p "$PORT"
fi

set -- "$@" -R "$REMOTE_BIND" "$DESTINATION"

while true; do
	ATTEMPT=$((ATTEMPT + 1))
	write_status "connecting" "Opening reverse SSH tunnel, attempt ${ATTEMPT}"
	echo "tg-paidmedia tunnel: starting reverse SSH tunnel $DESTINATION $REMOTE_BIND (attempt $ATTEMPT)" >&2

	set +e
	"$@" &
	SSH_PID="$!"
	sleep 2

	if kill -0 "$SSH_PID" 2>/dev/null; then
		write_status "active" "Reverse SSH tunnel is connected"
		wait "$SSH_PID"
		EXIT_CODE="$?"
		write_status "retrying" "SSH tunnel disconnected with exit code ${EXIT_CODE}"
		echo "tg-paidmedia tunnel: SSH tunnel disconnected with exit code $EXIT_CODE, retrying in ${RETRY_DELAY}s" >&2
	else
		wait "$SSH_PID"
		EXIT_CODE="$?"
		write_status "retrying" "SSH tunnel failed with exit code ${EXIT_CODE}"
		echo "tg-paidmedia tunnel: SSH tunnel failed with exit code $EXIT_CODE, retrying in ${RETRY_DELAY}s" >&2
	fi
	set -e

	sleep "$RETRY_DELAY"
done
