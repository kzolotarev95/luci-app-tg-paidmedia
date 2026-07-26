#!/bin/sh

set -eu

REPO_OWNER="kzolotarev95"
REPO_NAME="luci-app-tg-paidmedia"
REPO_BRANCH="${TG_PAIDMEDIA_BRANCH:-main}"
OLD_DEFAULT_HOME_IMAGE_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/assets/bot-home-header.jpg"
DEFAULT_HOME_IMAGE_PATH="/etc/tg-paidmedia/home-header.jpg"
ARCHIVE_URL="https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/refs/heads/${REPO_BRANCH}"
TMP_DIR="/tmp/tg-paidmedia-install.$$"
ARCHIVE_PATH="${TMP_DIR}/repo.tar.gz"
SRC_ROOT="${TMP_DIR}/src"
REPO_ROOT="${SRC_ROOT}/${REPO_NAME}-${REPO_BRANCH}"
TRACK_FILE="/usr/libexec/tg-paidmedia/installed-packages.list"
TRACKED_PACKAGES=""
PKG_MANAGER=""

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

detect_package_manager() {
	if command_exists apk; then
		PKG_MANAGER="apk"
		return 0
	fi

	if command_exists opkg; then
		PKG_MANAGER="opkg"
		return 0
	fi

	fail "apk or opkg is required"
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
	local pkg="$1"

	if [ "$PKG_MANAGER" = "apk" ]; then
		apk info -e "$pkg" >/dev/null 2>&1
		return $?
	fi

	opkg list-installed "$pkg" 2>/dev/null | grep -q "^$pkg - "
}

ensure_pkg() {
	local pkg="$1"

	if pkg_installed "$pkg"; then
		return 0
	fi

	log "Installing package: $pkg"
	if [ "$PKG_MANAGER" = "apk" ]; then
		apk add "$pkg"
	else
		opkg install "$pkg"
	fi
	track_package "$pkg"
}

try_install_pkg() {
	local pkg="$1"

	if pkg_installed "$pkg"; then
		return 0
	fi

	log "Installing package: $pkg"
	if [ "$PKG_MANAGER" = "apk" ]; then
		if apk add "$pkg"; then
			track_package "$pkg"
			return 0
		fi
	else
		if opkg install "$pkg"; then
			track_package "$pkg"
			return 0
		fi
	fi

	return 1
}

reinstall_pkg() {
	local pkg="$1"

	log "Reinstalling package: $pkg"
	if [ "$PKG_MANAGER" = "apk" ]; then
		if apk fix "$pkg"; then
			track_package "$pkg"
			return 0
		fi
	else
		if opkg install --force-reinstall "$pkg"; then
			track_package "$pkg"
			return 0
		fi
	fi

	return 1
}

python_import_ok() {
	local module="$1"

	python3 -c "import $module" >/dev/null 2>&1
}

python_missing_modules() {
	local modules missing module

	modules="datetime json logging pathlib ssl tempfile traceback urllib.error urllib.request"
	missing=""

	for module in $modules; do
		if ! python_import_ok "$module"; then
			if [ -n "$missing" ]; then
				missing="$missing $module"
			else
				missing="$module"
			fi
		fi
	done

	printf '%s' "$missing"
}

python_runtime_ok() {
	if ! command_exists python3; then
		return 1
	fi

	[ -z "$(python_missing_modules)" ]
}

ensure_python() {
	local missing_modules pkg
	local required_pkgs reinstall_pkgs

	if python_runtime_ok; then
		return 0
	fi

	ensure_pkg python3

	required_pkgs="
python3-light
python3-logging
python3-email
python3-urllib
python3-openssl
python3-codecs
"

	for pkg in $required_pkgs; do
		if ! try_install_pkg "$pkg"; then
			log "Optional package $pkg is unavailable; continuing with current Python runtime"
		fi
	done

	missing_modules="$(python_missing_modules)"
	if printf '%s\n' "$missing_modules" | grep -qw "ssl"; then
		if ! try_install_pkg python3-openssl; then
			log "Optional package python3-openssl is unavailable; continuing with current Python runtime"
		fi
	fi

	if python_runtime_ok; then
		return 0
	fi

	log "Python runtime still looks broken after dependency install; forcing reinstall of core Python packages"

	reinstall_pkgs="
libpython3.11
libpython3-3.11
python3-base
python3
python3-light
python3-logging
python3-email
python3-urllib
python3-openssl
python3-codecs
"

	for pkg in $reinstall_pkgs; do
		if ! reinstall_pkg "$pkg"; then
			log "Reinstall attempt for $pkg was skipped or failed; continuing"
		fi
	done

	if python_runtime_ok; then
		return 0
	fi

	missing_modules="$(python_missing_modules)"
	fail "python3 runtime is installed, but required standard modules are still unavailable: $missing_modules"
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
	local token admin_ids enabled_value current_token current_home_image

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
	current_home_image="$(uci -q get tg-paidmedia.main.home_image || true)"
	if [ -n "$current_token" ]; then
		enabled_value="1"
	else
		enabled_value="0"
	fi

	if [ -z "$current_home_image" ] || [ "$current_home_image" = "$OLD_DEFAULT_HOME_IMAGE_URL" ]; then
		uci set tg-paidmedia.main.home_image="$DEFAULT_HOME_IMAGE_PATH"
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
	detect_package_manager
	load_tracked_packages

	if [ "$PKG_MANAGER" = "apk" ]; then
		log "Updating apk indexes"
		apk update
	else
		log "Updating opkg indexes"
		opkg update
	fi

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
	install_file "$REPO_ROOT/tg-paidmedia-bot/files/usr/libexec/tg-paidmedia/yoomoney-tunnel.sh" "/usr/libexec/tg-paidmedia/yoomoney-tunnel.sh" "0755"
	install_file "$REPO_ROOT/luci-app-tg-paidmedia/root/usr/share/luci/menu.d/luci-app-tg-paidmedia.json" "/usr/share/luci/menu.d/luci-app-tg-paidmedia.json" "0644"
	install_file "$REPO_ROOT/luci-app-tg-paidmedia/root/usr/share/rpcd/acl.d/luci-app-tg-paidmedia.json" "/usr/share/rpcd/acl.d/luci-app-tg-paidmedia.json" "0644"
	install_file "$REPO_ROOT/luci-app-tg-paidmedia/htdocs/luci-static/resources/view/tg-paidmedia/overview.js" "/www/luci-static/resources/view/tg-paidmedia/overview.js" "0644"
	install_if_missing "$REPO_ROOT/tg-paidmedia-bot/files/etc/config/tg-paidmedia" "/etc/config/tg-paidmedia" "0644"
	install_if_missing "$REPO_ROOT/tg-paidmedia-bot/files/etc/tg-paidmedia/catalog.json" "/etc/tg-paidmedia/catalog.json" "0644"
	install_if_missing "$REPO_ROOT/assets/bot-home-header.jpg" "$DEFAULT_HOME_IMAGE_PATH" "0644"

	configure_uci
	save_tracked_packages
	refresh_luci
	start_service

	log ""
	log "TG Paid Media установлен."
	if [ -n "$(uci -q get tg-paidmedia.main.token || true)" ]; then
		log "Сервис бота запущен. Откройте LuCI -> Services -> TG Paid Media."
	else
		log "Откройте LuCI -> Services -> TG Paid Media и добавьте токен бота."
	fi
	log "Поддержать проект: Сбербанк: 4817 7602 5832 3256"
}

main "$@"
