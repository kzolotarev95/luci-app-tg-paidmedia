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

echo "tg-paidmedia tunnel: starting reverse SSH tunnel $DESTINATION $REMOTE_BIND" >&2
exec "$@"
