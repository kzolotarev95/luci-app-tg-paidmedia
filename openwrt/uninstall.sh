#!/bin/sh

set -eu

TRACK_FILE="/usr/libexec/tg-paidmedia/installed-packages.list"

log() {
	printf '%s\n' "$*"
}

fail() {
	printf 'ERROR: %s\n' "$*" >&2
	exit 1
}

require_root() {
	if [ "$(id -u)" != "0" ]; then
		fail "run this script as root"
	fi
}

pkg_installed() {
	opkg list-installed "$1" 2>/dev/null | grep -q "^$1 - "
}

remove_tracked_packages() {
	local pkg

	if [ ! -f "$TRACK_FILE" ]; then
		return 0
	fi

	while IFS= read -r pkg; do
		[ -n "$pkg" ] || continue
		if pkg_installed "$pkg"; then
			log "Removing package: $pkg"
			opkg remove "$pkg" >/dev/null 2>&1 || true
		fi
	done < "$TRACK_FILE"
}

refresh_luci() {
	rm -f /tmp/luci-indexcache
	rm -rf /tmp/luci-modulecache

	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
	/etc/init.d/uhttpd restart >/dev/null 2>&1 || true
}

main() {
	require_root

	/etc/init.d/tg-paidmedia stop >/dev/null 2>&1 || true
	/etc/init.d/tg-paidmedia disable >/dev/null 2>&1 || true

	remove_tracked_packages

	rm -f /etc/init.d/tg-paidmedia
	rm -f /etc/config/tg-paidmedia
	rm -f /etc/tg-paidmedia/catalog.json
	rmdir /etc/tg-paidmedia >/dev/null 2>&1 || true

	rm -f /usr/share/luci/menu.d/luci-app-tg-paidmedia.json
	rm -f /usr/share/rpcd/acl.d/luci-app-tg-paidmedia.json
	rm -f /www/luci-static/resources/view/tg-paidmedia/overview.js
	rmdir /www/luci-static/resources/view/tg-paidmedia >/dev/null 2>&1 || true

	rm -f "$TRACK_FILE"
	rm -f /usr/libexec/tg-paidmedia/bot.py
	rmdir /usr/libexec/tg-paidmedia >/dev/null 2>&1 || true

	rm -rf /var/lib/tg-paidmedia
	rm -rf /var/run/tg-paidmedia

	refresh_luci

	log "TG Paid Media removed."
}

main "$@"
