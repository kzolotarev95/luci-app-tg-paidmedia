#!/bin/sh

set -eu

REPO_OWNER="kzolotarev95"
REPO_NAME="luci-app-tg-paidmedia"
REPO_BRANCH="${TG_PAIDMEDIA_BRANCH:-main}"
ARCHIVE_URL="https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/refs/heads/${REPO_BRANCH}"
TMP_DIR="/tmp/tg-paidmedia-install.$$"
ARCHIVE_PATH="${TMP_DIR}/repo.tar.gz"
SRC_ROOT="${TMP_DIR}/src"
REPO_ROOT="${SRC_ROOT}/${REPO_NAME}-${REPO_BRANCH}"
TRACK_FILE="/usr/libexec/tg-paidmedia/installed-packages.list"
TRACKED_PACKAGES=""

log() {
	printf '%s\n' "$*"
}

fail() {
	printf 'ERROR: %s\n' "$*" >&2
	exit 1
}

cleanup() {
	rm -rf "$TMP_DIR"
}

trap cleanup EXIT INT TERM

require_root() {
	if [ "$(id -u)" != "0" ]; then
		fail "run this script as root"
	fi
}

command_exists() {
	command -v "$1" >/dev/null 2>&1
}

load_tracked_packages() {
	if [ -f "$TRACK_FILE" ]; then
		TRACKED_PACKAGES="$(cat "$TRACK_FILE")"
	fi
}

track_package() {
	local pkg="$1"

	if [ -z "$pkg" ]; then
		return 0
	fi

	if printf '%s\n' "$TRACKED_PACKAGES" | grep -qx "$pkg" 2>/dev/null; then
		return 0
	fi

	if [ -n "$TRACKED_PACKAGES" ]; then
		TRACKED_PACKAGES="${TRACKED_PACKAGES}
$pkg"
	else
		TRACKED_PACKAGES="$pkg"
	fi
}

save_tracked_packages() {
	mkdir -p "$(dirname "$TRACK_FILE")"
	printf '%s\n' "$TRACKED_PACKAGES" > "$TRACK_FILE"
}

pkg_installed() {
	opkg list-installed "$1" 2>/dev/null | grep -q "^$1 - "
}

ensure_pkg() {
	local pkg="$1"

	if pkg_installed "$pkg"; then
		return 0
	fi

	log "Installing package: $pkg"
	opkg install "$pkg"
	track_package "$pkg"
}

ensure_python() {
	if command_exists python3; then
		return 0
	fi

	if pkg_installed python3-light; then
		return 0
	fi

	log "Installing package: python3-light"
	if opkg install python3-light; then
		track_package "python3-light"
		return 0
	fi

	log "Falling back to python3"
	opkg install python3
	track_package "python3"
}

fetch_archive() {
	mkdir -p "$TMP_DIR" "$SRC_ROOT"

	log "Downloading repository snapshot"

	if command_exists uclient-fetch; then
		uclient-fetch -O "$ARCHIVE_PATH" "$ARCHIVE_URL"
	elif command_exists wget; then
		wget -O "$ARCHIVE_PATH" "$ARCHIVE_URL"
	else
		fail "uclient-fetch or wget is required"
	fi

	tar -xzf "$ARCHIVE_PATH" -C "$SRC_ROOT"

	if [ ! -d "$REPO_ROOT" ]; then
		fail "unable to unpack repository snapshot"
	fi
}

install_file() {
	local src="$1"
	local dst="$2"
	local mode="$3"

	mkdir -p "$(dirname "$dst")"
	cp "$src" "$dst"
	chmod "$mode" "$dst"
}

install_if_missing() {
	local src="$1"
	local dst="$2"
	local mode="$3"

	if [ -f "$dst" ]; then
		return 0
	fi

	install_file "$src" "$dst" "$mode"
}

set_admin_ids() {
	local raw_ids="$1"
	local old_ifs
	local id

	uci -q delete tg-paidmedia.main.admin_ids || true

	old_ifs="$IFS"
	IFS=' ,;'
	set -f
	for id in $raw_ids; do
		[ -n "$id" ] || continue
		uci add_list tg-paidmedia.main.admin_ids="$id"
	done
	set +f
	IFS="$old_ifs"
}

configure_uci() {
	local token admin_ids enabled_value current_token

	token="${TG_BOT_TOKEN:-}"
	admin_ids="${TG_ADMIN_IDS:-${TG_ADMIN_ID:-}}"

	if ! uci -q get tg-paidmedia.main >/dev/null 2>&1; then
		uci set tg-paidmedia.main=bot
	fi

	if [ -n "$token" ]; then
		uci set tg-paidmedia.main.token="$token"
	fi

	if [ -n "$admin_ids" ]; then
		set_admin_ids "$admin_ids"
	fi

	current_token="$(uci -q get tg-paidmedia.main.token || true)"
	if [ -n "$current_token" ]; then
		enabled_value="1"
	else
		enabled_value="0"
	fi

	uci set tg-paidmedia.main.enabled="$enabled_value"
	uci commit tg-paidmedia
}

refresh_luci() {
	rm -f /tmp/luci-indexcache
	rm -rf /tmp/luci-modulecache

	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
	/etc/init.d/uhttpd restart >/dev/null 2>&1 || true
}

start_service() {
	local current_token

	current_token="$(uci -q get tg-paidmedia.main.token || true)"

	if [ -n "$current_token" ]; then
		/etc/init.d/tg-paidmedia enable >/dev/null 2>&1 || true
		/etc/init.d/tg-paidmedia restart >/dev/null 2>&1 || true
	else
		/etc/init.d/tg-paidmedia disable >/dev/null 2>&1 || true
		/etc/init.d/tg-paidmedia stop >/dev/null 2>&1 || true
	fi
}

main() {
	require_root
	load_tracked_packages

	log "Updating opkg indexes"
	opkg update

	ensure_python
	ensure_pkg ca-bundle
	ensure_pkg rpcd-mod-file
	ensure_pkg luci-base

	fetch_archive

	mkdir -p \
		/etc/config \
		/etc/init.d \
		/etc/tg-paidmedia \
		/usr/libexec/tg-paidmedia \
		/usr/share/luci/menu.d \
		/usr/share/rpcd/acl.d \
		/www/luci-static/resources/view/tg-paidmedia \
		/var/lib/tg-paidmedia \
		/var/run/tg-paidmedia

	install_file "$REPO_ROOT/tg-paidmedia-bot/files/etc/init.d/tg-paidmedia" "/etc/init.d/tg-paidmedia" "0755"
	install_file "$REPO_ROOT/tg-paidmedia-bot/files/usr/libexec/tg-paidmedia/bot.py" "/usr/libexec/tg-paidmedia/bot.py" "0755"
	install_file "$REPO_ROOT/luci-app-tg-paidmedia/root/usr/share/luci/menu.d/luci-app-tg-paidmedia.json" "/usr/share/luci/menu.d/luci-app-tg-paidmedia.json" "0644"
	install_file "$REPO_ROOT/luci-app-tg-paidmedia/root/usr/share/rpcd/acl.d/luci-app-tg-paidmedia.json" "/usr/share/rpcd/acl.d/luci-app-tg-paidmedia.json" "0644"
	install_file "$REPO_ROOT/luci-app-tg-paidmedia/htdocs/luci-static/resources/view/tg-paidmedia/overview.js" "/www/luci-static/resources/view/tg-paidmedia/overview.js" "0644"
	install_if_missing "$REPO_ROOT/tg-paidmedia-bot/files/etc/config/tg-paidmedia" "/etc/config/tg-paidmedia" "0644"
	install_if_missing "$REPO_ROOT/tg-paidmedia-bot/files/etc/tg-paidmedia/catalog.json" "/etc/tg-paidmedia/catalog.json" "0644"

	configure_uci
	save_tracked_packages
	refresh_luci
	start_service

	log ""
	log "TG Paid Media installed."
	if [ -n "$(uci -q get tg-paidmedia.main.token || true)" ]; then
		log "Bot service started. Open LuCI -> Services -> TG Paid Media."
	else
		log "Open LuCI -> Services -> TG Paid Media and add your bot token."
	fi
}

main "$@"
