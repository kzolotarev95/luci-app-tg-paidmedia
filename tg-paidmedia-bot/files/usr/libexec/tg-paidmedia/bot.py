#!/usr/bin/env python3

import datetime
import html
import http.client
import http.server
import json
import logging
import os
import pathlib
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import traceback
import urllib.parse
import urllib.error
import urllib.request


LOG = logging.getLogger("tg-paidmedia")


class IPv4HTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        host = self.host
        port = self.port or self.default_port
        last_error = None

        for family, socktype, proto, _, sockaddr in socket.getaddrinfo(
            host, port, socket.AF_INET, socket.SOCK_STREAM
        ):
            sock = None
            try:
                sock = socket.socket(family, socktype, proto)
                if self.timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:
                    sock.settimeout(self.timeout)
                if self.source_address:
                    sock.bind(self.source_address)
                sock.connect(sockaddr)

                if self._tunnel_host:
                    self.sock = sock
                    self._tunnel()

                self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
                return
            except OSError as exc:
                last_error = exc
                if sock is not None:
                    try:
                        sock.close()
                    except OSError:
                        pass

        if last_error is not None:
            raise last_error

        raise OSError("No IPv4 address found for {0}".format(host))


class IPv4HTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self):
        super().__init__(context=ssl.create_default_context())

    def https_open(self, req):
        return self.do_open(IPv4HTTPSConnection, req)


def utc_now():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name, default):
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    try:
        return int(value.strip())
    except ValueError:
        return default


def parse_admin_ids(raw_value):
    if not raw_value:
        return set()

    values = set()
    for chunk in raw_value.replace(";", ",").replace(" ", ",").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            values.add(int(chunk))
        except ValueError:
            LOG.warning("Ignoring invalid admin id: %s", chunk)
    return values


def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError:
        LOG.warning("Invalid JSON in %s, using default", path)
        return default


def atomic_write_json(path, payload):
    pathlib.Path(path).parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        "w",
        delete=False,
        dir=str(pathlib.Path(path).parent),
        encoding="utf-8",
    ) as handle:
        json.dump(payload, handle, ensure_ascii=True, indent=2, sort_keys=True)
        handle.write("\n")
        temp_path = handle.name

    os.replace(temp_path, path)


def write_fatal_status(path, message, exception_text):
    status = load_json(path, {})
    status["started_at"] = status.get("started_at") or utc_now()
    status["last_error"] = message
    status["last_exception"] = exception_text
    status["last_poll_at"] = utc_now()
    status.setdefault("catalog_items", 0)
    status.setdefault("admin_count", 0)
    status.setdefault("bot_username", "")
    status.setdefault("last_purchase", {})
    status.setdefault("last_balance", {})
    status.setdefault("stats", {})
    atomic_write_json(path, status)


def describe_connection_error(exc):
    message = str(exc).strip()

    if "Network unreachable" in message:
        return (
            "Router has no Internet access yet. Waiting for WAN before connecting "
            "to the Telegram API."
        )

    if "Name or service not known" in message or "Temporary failure in name resolution" in message:
        return (
            "DNS is not ready yet on the router. Waiting before retrying the "
            "Telegram API connection."
        )

    return message


def safe_caption(value):
    value = (value or "").strip()
    return value[:1024]


def normalize_media_entries(item, fallback_kind):
    entries = []

    for raw_entry in item.get("media") or []:
        if not isinstance(raw_entry, dict):
            continue

        entry_type = str(raw_entry.get("type") or fallback_kind or "").strip().lower()
        file_id = str(raw_entry.get("file_id") or raw_entry.get("media") or "").strip()
        if entry_type not in {"photo", "video"} or not file_id:
            continue

        entries.append({"type": entry_type, "file_id": file_id})

    legacy_file_id = str(item.get("file_id") or "").strip()
    if not entries and legacy_file_id:
        legacy_type = str(fallback_kind or item.get("kind") or "photo").strip().lower()
        if legacy_type in {"photo", "video"}:
            entries.append({"type": legacy_type, "file_id": legacy_file_id})

    return entries[:10]


def compact_name(user):
    if not user:
        return "unknown"

    full_name = " ".join(
        part for part in [user.get("first_name"), user.get("last_name")] if part
    ).strip()
    if full_name:
        return full_name
    if user.get("username"):
        return "@" + user["username"]
    return str(user.get("id", "unknown"))


def parse_callback_body(body_bytes):
    text = (body_bytes or b"").decode("utf-8", errors="replace").strip()
    if not text:
        return {}

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {
            key: values[-1]
            for key, values in urllib.parse.parse_qs(
                text, keep_blank_values=True, strict_parsing=False
            ).items()
        }


class PlategaWebhookHandler(http.server.BaseHTTPRequestHandler):
    server_version = "TGPaidMediaWebhook/1.0"

    def log_message(self, format_value, *args):
        LOG.info("platega webhook: " + format_value, *args)

    def do_POST(self):
        bot = getattr(self.server, "bot", None)
        if bot is None:
            self.send_error(500, "Bot context is missing")
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0

        body = self.rfile.read(max(content_length, 0))
        payload = parse_callback_body(body)
        status_code, response_payload = bot.handle_platega_webhook(
            self.path,
            dict(self.headers.items()),
            payload,
        )

        body_bytes = json.dumps(response_payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)


class TelegramPaidMediaBot:
    def __init__(self):
        self.token = os.environ.get("TG_BOT_TOKEN", "").strip()
        if not self.token:
            raise RuntimeError("TG_BOT_TOKEN is required")

        self.api_base = "https://api.telegram.org/bot{0}/".format(self.token)
        self.url_opener = urllib.request.build_opener(IPv4HTTPSHandler())
        self.wget_path = os.environ.get("TG_WGET_PATH", "/usr/bin/wget")
        self.admin_ids = parse_admin_ids(os.environ.get("TG_ADMIN_IDS", ""))
        self.data_dir = os.environ.get("TG_DATA_DIR", "/var/lib/tg-paidmedia")
        self.catalog_path = os.environ.get(
            "TG_CATALOG_PATH", "/etc/tg-paidmedia/catalog.json"
        )
        self.state_path = os.environ.get(
            "TG_STATE_PATH", os.path.join(self.data_dir, "state.json")
        )
        self.status_path = os.environ.get(
            "TG_STATUS_PATH", "/var/run/tg-paidmedia/status.json"
        )
        self.poll_timeout = env_int("TG_POLL_TIMEOUT", 25)
        self.drop_pending = env_bool("TG_DROP_PENDING", True)
        self.orders_path = os.environ.get(
            "TG_ORDERS_PATH", os.path.join(self.data_dir, "orders.json")
        )
        self.bot_title = os.environ.get("TG_BOT_TITLE", "Магазин платного контента").strip()
        self.welcome_text = os.environ.get(
            "TG_WELCOME_TEXT",
            (
                "Выберите платный пост ниже, и Telegram покажет официальное "
                "окно покупки за Stars."
            ),
        ).strip()

        self.platega_enabled = env_bool("TG_PLATEGA_ENABLED", False)
        self.platega_base_url = (
            os.environ.get("TG_PLATEGA_BASE_URL", "https://app.platega.io")
            .strip()
            .rstrip("/")
        )
        self.platega_merchant_id = os.environ.get("TG_PLATEGA_MERCHANT_ID", "").strip()
        self.platega_secret = os.environ.get("TG_PLATEGA_SECRET_KEY", "").strip()
        self.platega_callback_url = os.environ.get(
            "TG_PLATEGA_CALLBACK_URL", ""
        ).strip()
        self.platega_success_url = os.environ.get(
            "TG_PLATEGA_SUCCESS_URL", ""
        ).strip()
        self.platega_fail_url = os.environ.get("TG_PLATEGA_FAIL_URL", "").strip()
        self.platega_redirect_url = os.environ.get(
            "TG_PLATEGA_REDIRECT_URL", ""
        ).strip()
        self.platega_webhook_host = os.environ.get(
            "TG_PLATEGA_WEBHOOK_HOST", "0.0.0.0"
        ).strip() or "0.0.0.0"
        self.platega_webhook_port = env_int("TG_PLATEGA_WEBHOOK_PORT", 8099)
        self.platega_webhook_path = (
            os.environ.get("TG_PLATEGA_WEBHOOK_PATH", "/platega/webhook").strip()
            or "/platega/webhook"
        )
        if not self.platega_webhook_path.startswith("/"):
            self.platega_webhook_path = "/" + self.platega_webhook_path
        self.platega_status_poll_interval = env_int(
            "TG_PLATEGA_STATUS_POLL_INTERVAL", 20
        )
        self.platega_status_timeout = env_int("TG_PLATEGA_STATUS_TIMEOUT", 900)
        self.platega_http_timeout = env_int("TG_PLATEGA_HTTP_TIMEOUT", 25)
        self._platega_server = None
        self._platega_server_thread = None
        self._orders_lock = threading.Lock()

        pathlib.Path(self.data_dir).mkdir(parents=True, exist_ok=True)
        pathlib.Path(self.catalog_path).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(self.status_path).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(self.orders_path).parent.mkdir(parents=True, exist_ok=True)

        self.catalog = load_json(self.catalog_path, {"next_id": 1, "items": []})
        self.catalog.setdefault("next_id", 1)
        self.catalog.setdefault("items", [])

        self.state = load_json(
            self.state_path,
            {
                "offset": 0,
                "pending_actions": {},
                "pending_uploads": {},
                "subscribers": {},
                "stats": {
                    "handled_updates": 0,
                    "purchases": 0,
                },
                "last_balance": {},
                "last_purchase": {},
                "recent_purchases": [],
            },
        )
        self.state.setdefault("offset", 0)
        self.state.setdefault("pending_actions", {})
        self.state.setdefault("pending_uploads", {})
        self.state.setdefault("subscribers", {})
        self.state.setdefault("stats", {})
        self.state["stats"].setdefault("handled_updates", 0)
        self.state["stats"].setdefault("purchases", 0)
        self.state["stats"].setdefault("stars_purchases", 0)
        self.state["stats"].setdefault("sbp_orders_created", 0)
        self.state["stats"].setdefault("sbp_orders_paid", 0)
        self.state.setdefault("last_balance", {})
        self.state.setdefault("last_purchase", {})
        self.state.setdefault("recent_purchases", [])
        self.state.setdefault("last_platega_order", {})
        self.state.setdefault("last_platega_event", {})
        self.orders = load_json(self.orders_path, {"next_id": 1, "items": []})
        self.orders.setdefault("next_id", 1)
        self.orders.setdefault("items", [])

        self._normalize_catalog()
        self._normalize_orders()
        self.me = None
        self.status = {
            "started_at": utc_now(),
            "bot_title": self.bot_title,
            "bot_username": "",
            "catalog_items": len(self.catalog["items"]),
            "admin_count": len(self.admin_ids),
            "last_poll_at": "",
            "last_update_id": 0,
            "last_error": "",
            "last_exception": "",
            "last_purchase": self.state.get("last_purchase", {}),
            "last_balance": self.state.get("last_balance", {}),
            "last_platega_order": self.state.get("last_platega_order", {}),
            "last_platega_event": self.state.get("last_platega_event", {}),
            "platega_enabled": self.has_platega_credentials(),
            "platega_webhook_url": self.platega_callback_url,
            "stats": self.state.get("stats", {}),
        }

    def _normalize_catalog(self):
        max_id = 0
        normalized = []

        for item in self.catalog.get("items", []):
            if not isinstance(item, dict):
                continue
            if not item.get("id") or not item.get("kind"):
                continue
            try:
                item_id = int(item["id"])
                price = max(int(item.get("price", 1)), 1)
            except (TypeError, ValueError):
                continue

            kind = str(item.get("kind", "")).strip().lower()
            if kind not in {"photo", "video"}:
                continue

            media_entries = normalize_media_entries(item, kind)
            if not media_entries:
                continue

            item["id"] = item_id
            item["kind"] = media_entries[0]["type"]
            item["media"] = media_entries
            item["file_id"] = media_entries[0]["file_id"]
            item["title"] = (item.get("title") or "Item {0}".format(item_id)).strip() or "Item {0}".format(item_id)
            item["caption"] = safe_caption(item.get("caption", ""))
            item["price"] = price
            max_id = max(max_id, item_id)
            normalized.append(item)

        normalized.sort(key=lambda entry: int(entry["id"]))
        self.catalog["items"] = normalized
        self.catalog["next_id"] = max(int(self.catalog.get("next_id", 1)), max_id + 1)

    def _normalize_orders(self):
        max_id = 0
        normalized = []

        for entry in self.orders.get("items", []):
            if not isinstance(entry, dict):
                continue
            try:
                order_id = int(entry.get("id"))
                item_id = int(entry.get("item_id"))
                chat_id = int(entry.get("chat_id"))
                user_id = int(entry.get("user_id"))
            except (TypeError, ValueError):
                continue

            entry["id"] = order_id
            entry["item_id"] = item_id
            entry["chat_id"] = chat_id
            entry["user_id"] = user_id
            entry["status"] = str(entry.get("status") or "CREATED").strip().upper()
            entry["created_at"] = entry.get("created_at") or utc_now()
            entry["updated_at"] = entry.get("updated_at") or entry["created_at"]
            entry["delivery_state"] = str(entry.get("delivery_state") or "pending").strip().lower()
            entry["poll_next_at"] = float(entry.get("poll_next_at") or 0)
            entry["poll_until"] = float(entry.get("poll_until") or 0)
            entry["amount_rub"] = float(entry.get("amount_rub") or 0)
            normalized.append(entry)
            max_id = max(max_id, order_id)

        normalized.sort(key=lambda value: int(value["id"]))
        self.orders["items"] = normalized
        self.orders["next_id"] = max(int(self.orders.get("next_id", 1)), max_id + 1)

    def save_catalog(self):
        atomic_write_json(self.catalog_path, self.catalog)

    def save_state(self):
        atomic_write_json(self.state_path, self.state)

    def save_orders(self):
        atomic_write_json(self.orders_path, self.orders)

    def remember_private_subscriber(self, chat, user):
        if not isinstance(chat, dict) or not isinstance(user, dict):
            return

        if chat.get("type") != "private":
            return

        chat_id = chat.get("id")
        user_id = user.get("id")
        if not chat_id or not user_id:
            return

        subscribers = self.state.setdefault("subscribers", {})
        key = str(chat_id)
        existing = subscribers.get(key, {})
        payload = {
            "chat_id": int(chat_id),
            "user_id": int(user_id),
            "username": user.get("username", "") or "",
            "first_name": user.get("first_name", "") or "",
            "added_at": existing.get("added_at") or utc_now(),
            "last_seen_at": utc_now(),
        }

        if existing == payload:
            return

        subscribers[key] = payload
        self.save_state()

    def forget_subscriber(self, chat_id):
        if self.state.setdefault("subscribers", {}).pop(str(chat_id), None) is not None:
            self.save_state()

    def should_forget_subscriber(self, error_text):
        lowered = (error_text or "").lower()
        return any(
            marker in lowered
            for marker in {
                "bot was blocked by the user",
                "user is deactivated",
                "chat not found",
                "forbidden",
            }
        )

    def write_status(self):
        self.status["catalog_items"] = len(self.catalog["items"])
        self.status["stats"] = self.state.get("stats", {})
        self.status["last_balance"] = self.state.get("last_balance", {})
        self.status["last_purchase"] = self.state.get("last_purchase", {})
        self.status["last_platega_order"] = self.state.get("last_platega_order", {})
        self.status["last_platega_event"] = self.state.get("last_platega_event", {})
        self.status["platega_enabled"] = self.has_platega_credentials()
        self.status["platega_webhook_url"] = self.platega_callback_url
        atomic_write_json(self.status_path, self.status)

    def update_status(self, **kwargs):
        self.status.update(kwargs)
        self.write_status()

    def api_call(self, method, payload=None, timeout=None):
        body = json.dumps(payload or {}).encode("utf-8")
        request = urllib.request.Request(
            self.api_base + method,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with self.url_opener.open(
                request, timeout=timeout or (self.poll_timeout + 15)
            ) as response:
                data = json.load(response)
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                "Telegram API HTTP error for {0}: {1}".format(method, details)
            ) from exc
        except urllib.error.URLError as exc:
            LOG.warning(
                "urllib transport failed for %s, retrying via wget: %s",
                method,
                exc,
            )
            data = self.api_call_via_wget(method, payload or {}, timeout)
        except TimeoutError as exc:
            LOG.warning(
                "urllib transport timed out for %s, retrying via wget: %s",
                method,
                exc,
            )
            data = self.api_call_via_wget(method, payload or {}, timeout)

        if not data.get("ok"):
            raise RuntimeError(
                "Telegram API error for {0}: {1}".format(
                    method, data.get("description", "unknown error")
                )
            )

        return data.get("result")

    def api_call_via_wget(self, method, payload=None, timeout=None):
        request_timeout = int(timeout or (self.poll_timeout + 15))
        command = [
            self.wget_path,
            "-qO-",
            "--timeout",
            str(request_timeout),
            "--tries",
            "1",
            "--header",
            "Content-Type: application/json",
            "--post-data",
            json.dumps(payload or {}, separators=(",", ":")),
            self.api_base + method,
        ]

        try:
            completed = subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                timeout=request_timeout + 5,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                "Telegram API connection error for {0}: wget is not available".format(
                    method
                )
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                "Telegram API connection error for {0}: wget timed out".format(method)
            ) from exc
        except subprocess.CalledProcessError as exc:
            stderr_text = (exc.stderr or "").strip()
            stdout_text = (exc.stdout or "").strip()
            details = stderr_text or stdout_text or "wget request failed"
            raise RuntimeError(
                "Telegram API connection error for {0}: {1}".format(method, details)
            ) from exc

        try:
            return json.loads(completed.stdout or "{}")
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                "Telegram API invalid response for {0}: {1}".format(
                    method, (completed.stdout or "").strip()[:200]
                )
            ) from exc

    def has_platega_credentials(self):
        return (
            self.platega_enabled
            and bool(self.platega_merchant_id)
            and bool(self.platega_secret)
        )

    def platega_headers(self):
        return {
            "Content-Type": "application/json",
            "X-MerchantId": self.platega_merchant_id,
            "X-Secret": self.platega_secret,
        }

    def platega_request(self, method, path, payload=None):
        if not self.has_platega_credentials():
            raise RuntimeError("Platega is not configured")

        body = None
        headers = self.platega_headers()
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")

        request = urllib.request.Request(
            self.platega_base_url + path,
            data=body,
            headers=headers,
            method=method.upper(),
        )

        try:
            with self.url_opener.open(request, timeout=self.platega_http_timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError("Platega HTTP error: {0}".format(details)) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError("Platega connection error: {0}".format(exc)) from exc

    def item_rub_price(self, item):
        try:
            value = float(item.get("rub_price") or 0)
        except (TypeError, ValueError):
            return 0.0
        if value <= 0:
            return 0.0
        return round(value, 2)

    def format_rub_amount(self, value):
        amount = round(float(value or 0), 2)
        return "{0:.2f}".format(amount).rstrip("0").rstrip(".")

    def order_title(self, order):
        item = self.get_item(order.get("item_id"))
        if item:
            return item.get("title") or "Item {0}".format(item["id"])
        return "Item {0}".format(order.get("item_id"))

    def find_order(self, local_order_id):
        for entry in self.orders["items"]:
            if int(entry["id"]) == int(local_order_id):
                return entry
        return None

    def find_order_by_transaction(self, transaction_id):
        transaction_id = str(transaction_id or "").strip()
        if not transaction_id:
            return None
        for entry in self.orders["items"]:
            if str(entry.get("transaction_id") or "").strip() == transaction_id:
                return entry
        return None

    def touch_order(self, order, **kwargs):
        order.update(kwargs)
        order["updated_at"] = utc_now()
        self.state["last_platega_order"] = {
            "id": order.get("id"),
            "item_id": order.get("item_id"),
            "item_title": self.order_title(order),
            "status": order.get("status"),
            "delivery_state": order.get("delivery_state"),
            "amount_rub": order.get("amount_rub", 0),
            "transaction_id": order.get("transaction_id", ""),
            "updated_at": order["updated_at"],
        }
        self.save_orders()
        self.save_state()
        self.update_status(last_platega_order=self.state["last_platega_order"])

    def start_platega_webhook_server(self):
        if not self.has_platega_credentials() or self._platega_server is not None:
            return

        server = http.server.ThreadingHTTPServer(
            (self.platega_webhook_host, self.platega_webhook_port),
            PlategaWebhookHandler,
        )
        server.bot = self
        self._platega_server = server
        self._platega_server_thread = threading.Thread(
            target=server.serve_forever,
            name="platega-webhook",
            daemon=True,
        )
        self._platega_server_thread.start()
        LOG.info(
            "Platega webhook server is listening on %s:%s%s",
            self.platega_webhook_host,
            self.platega_webhook_port,
            self.platega_webhook_path,
        )

    def send_photo(self, chat_id, file_id, caption=""):
        payload = {"chat_id": chat_id, "photo": file_id}
        if caption:
            payload["caption"] = safe_caption(caption)
        return self.api_call("sendPhoto", payload)

    def send_video(self, chat_id, file_id, caption=""):
        payload = {"chat_id": chat_id, "video": file_id}
        if caption:
            payload["caption"] = safe_caption(caption)
        return self.api_call("sendVideo", payload)

    def send_media_group(self, chat_id, media_entries, caption=""):
        payload_media = []
        for index, entry in enumerate(media_entries):
            payload_entry = {"type": entry["type"], "media": entry["file_id"]}
            if index == 0 and caption:
                payload_entry["caption"] = safe_caption(caption)
            payload_media.append(payload_entry)
        return self.api_call("sendMediaGroup", {"chat_id": chat_id, "media": payload_media})

    def send_direct_item(self, chat_id, item):
        media_entries = normalize_media_entries(item, item.get("kind", "photo"))
        caption = safe_caption(item.get("caption") or item.get("title"))

        if not media_entries:
            raise RuntimeError("Item has no media to deliver")

        if len(media_entries) == 1:
            entry = media_entries[0]
            if entry["type"] == "photo":
                return self.send_photo(chat_id, entry["file_id"], caption=caption)
            return self.send_video(chat_id, entry["file_id"], caption=caption)

        return self.send_media_group(chat_id, media_entries, caption=caption)

    def create_platega_order(self, chat_id, user, item):
        rub_price = self.item_rub_price(item)
        if rub_price <= 0:
            raise RuntimeError("SBP price is not configured for this item")
        if not self.has_platega_credentials():
            raise RuntimeError("Platega is not configured")

        with self._orders_lock:
            local_order_id = int(self.orders["next_id"])
            self.orders["next_id"] = local_order_id + 1

            order = {
                "id": local_order_id,
                "item_id": int(item["id"]),
                "chat_id": int(chat_id),
                "user_id": int(user.get("id") or chat_id),
                "user_name": compact_name(user),
                "user_username": str(user.get("username") or ""),
                "amount_rub": rub_price,
                "status": "CREATED",
                "delivery_state": "pending",
                "created_at": utc_now(),
                "updated_at": utc_now(),
                "transaction_id": "",
                "payment_url": "",
                "poll_next_at": 0,
                "poll_until": 0,
            }
            self.orders["items"].append(order)
            self.save_orders()

        payload = {
            "paymentMethod": 2,
            "amount": rub_price,
            "currency": "RUB",
            "description": "Paid media #{0}: {1}".format(item["id"], item.get("title", "")),
            "payload": "tg-paidmedia-order:{0}".format(local_order_id),
            "successUrl": self.platega_success_url,
            "failedUrl": self.platega_fail_url,
            "redirectUrl": self.platega_redirect_url or self.platega_success_url,
        }

        platega_result = self.platega_request("POST", "/transaction/process", payload)
        transaction_id = platega_result.get("id") or platega_result.get("transactionId") or ""
        payment_url = (
            platega_result.get("url")
            or platega_result.get("redirectUrl")
            or platega_result.get("paymentUrl")
            or ""
        )
        now_value = time.time()

        with self._orders_lock:
            order = self.find_order(local_order_id)
            if order is None:
                raise RuntimeError("Local order disappeared")
            self.state["stats"]["sbp_orders_created"] += 1
            self.touch_order(
                order,
                status=str(platega_result.get("status") or "CREATED").upper(),
                transaction_id=str(transaction_id),
                payment_url=str(payment_url),
                poll_next_at=now_value + max(self.platega_status_poll_interval, 5),
                poll_until=now_value + max(self.platega_status_timeout, 60),
            )

        return order

    def fetch_platega_status(self, order):
        transaction_id = str(order.get("transaction_id") or "").strip()
        if not transaction_id:
            raise RuntimeError("Order has no Platega transaction id")

        try:
            return self.platega_request("GET", "/transaction/{0}".format(transaction_id))
        except RuntimeError:
            return self.platega_request("GET", "/h2h/{0}".format(transaction_id))

    def sync_platega_order(self, order, status_payload, source="poll"):
        status_value = str(status_payload.get("status") or order.get("status") or "").upper()
        transaction_id = (
            status_payload.get("id")
            or status_payload.get("transactionId")
            or order.get("transaction_id")
            or ""
        )
        payment_url = (
            status_payload.get("url")
            or status_payload.get("redirectUrl")
            or status_payload.get("paymentUrl")
            or order.get("payment_url")
            or ""
        )

        self.state["last_platega_event"] = {
            "source": source,
            "status": status_value,
            "transaction_id": str(transaction_id),
            "received_at": utc_now(),
        }
        self.save_state()
        self.update_status(last_platega_event=self.state["last_platega_event"])

        next_poll = order.get("poll_next_at", 0)
        if status_value in {"CONFIRMED", "DECLINED", "CANCELED", "CANCELLED", "CHARGEBACKED"}:
            next_poll = 0

        self.touch_order(
            order,
            status=status_value or order.get("status", "CREATED"),
            transaction_id=str(transaction_id),
            payment_url=str(payment_url),
            poll_next_at=next_poll,
        )

        if status_value == "CONFIRMED" and order.get("delivery_state") != "delivered":
            self.deliver_platega_order(order)

    def deliver_platega_order(self, order):
        item = self.get_item(order.get("item_id"))
        if not item:
            self.touch_order(order, delivery_state="missing_item")
            return

        if order.get("delivery_state") == "delivered":
            return

        try:
            self.send_message(
                order["chat_id"],
                "SBP payment confirmed. Sending your content now.",
            )
            self.send_direct_item(order["chat_id"], item)
            self.state["stats"]["sbp_orders_paid"] += 1
            self.append_recent_purchase(
                "СБП / Platega",
                user_id=order.get("user_id"),
                user_name=order.get("user_name", ""),
                user_username=order.get("user_username", ""),
                item=item,
                amount_text="{0} RUB".format(
                    self.format_rub_amount(order.get("amount_rub", 0))
                ),
                order_id=order.get("id"),
                received_at=utc_now(),
            )
            self.save_state()
            self.touch_order(order, delivery_state="delivered")
            self.notify_admin_purchase(
                "СБП / Platega",
                user_id=order.get("user_id"),
                user_name=order.get("user_name", ""),
                user_username=order.get("user_username", ""),
                item=item,
                amount_text="{0} RUB".format(
                    self.format_rub_amount(order.get("amount_rub", 0))
                ),
                order_id=order.get("id"),
                received_at=order.get("updated_at") or utc_now(),
            )
        except Exception as exc:
            LOG.exception("Unable to deliver SBP order %s", order.get("id"))
            self.touch_order(order, delivery_state="delivery_error", delivery_error=str(exc))

    def check_pending_platega_orders(self):
        if not self.has_platega_credentials():
            return

        now_value = time.time()
        for order in list(self.orders.get("items", [])):
            if order.get("delivery_state") == "delivered":
                continue
            if order.get("status") in {"CONFIRMED", "DECLINED", "CANCELED", "CANCELLED", "CHARGEBACKED"}:
                continue
            if order.get("poll_next_at", 0) and order["poll_next_at"] > now_value:
                continue
            if order.get("poll_until", 0) and order["poll_until"] < now_value:
                self.touch_order(order, delivery_state="expired_poll", poll_next_at=0)
                continue

            try:
                status_payload = self.fetch_platega_status(order)
            except Exception as exc:
                LOG.warning("Unable to refresh Platega order %s: %s", order.get("id"), exc)
                self.touch_order(
                    order,
                    poll_next_at=now_value + max(self.platega_status_poll_interval, 5),
                )
                continue

            self.sync_platega_order(order, status_payload, source="poll")
            if order.get("status") not in {"CONFIRMED", "DECLINED", "CANCELED", "CANCELLED", "CHARGEBACKED"}:
                self.touch_order(
                    order,
                    poll_next_at=now_value + max(self.platega_status_poll_interval, 5),
                )

    def handle_platega_webhook(self, path, headers, payload):
        if urllib.parse.urlparse(path).path != self.platega_webhook_path:
            return 404, {"ok": False, "error": "unknown path"}

        if not self.has_platega_credentials():
            return 503, {"ok": False, "error": "platega disabled"}

        merchant_id = str(
            headers.get("X-MerchantId")
            or headers.get("x-merchantid")
            or headers.get("X-MerchantID")
            or ""
        ).strip()
        secret = str(headers.get("X-Secret") or headers.get("x-secret") or "").strip()
        if merchant_id != self.platega_merchant_id or secret != self.platega_secret:
            LOG.warning("Rejected Platega webhook because credentials do not match")
            return 403, {"ok": False, "error": "forbidden"}

        order = self.find_order_by_transaction(payload.get("id") or payload.get("transactionId"))
        if order is None:
            self.state["last_platega_event"] = {
                "source": "webhook",
                "status": str(payload.get("status") or "").upper(),
                "transaction_id": str(payload.get("id") or payload.get("transactionId") or ""),
                "received_at": utc_now(),
                "warning": "order not found",
            }
            self.save_state()
            self.update_status(last_platega_event=self.state["last_platega_event"])
            return 200, {"ok": True}

        self.sync_platega_order(order, payload, source="webhook")
        return 200, {"ok": True}

    def get_item(self, item_id):
        for item in self.catalog["items"]:
            if int(item["id"]) == int(item_id):
                return item
        return None

    def is_admin(self, user_id):
        return bool(self.admin_ids) and int(user_id) in self.admin_ids

    def notify_admin_purchase(
        self,
        payment_method,
        user_id=None,
        user_name="",
        user_username="",
        item=None,
        amount_text="",
        order_id=None,
        received_at="",
    ):
        if not self.admin_ids:
            return

        lines = [
            "Новая покупка",
            "Способ оплаты: {0}".format(html.escape(str(payment_method))),
        ]

        if item:
            lines.append(
                "Пост: #{0} {1}".format(
                    html.escape(str(item.get("id"))),
                    html.escape(item.get("title") or "-"),
                )
            )
        if amount_text:
            lines.append("Сумма: {0}".format(html.escape(str(amount_text))))
        if user_name or user_id:
            display_name = user_name or ("@" + str(user_username) if user_username else "-")
            safe_user_name = html.escape(
                display_name
            )
            safe_user_id = html.escape(str(user_id or "-"))
            profile_link = ""
            if user_username:
                profile_link = "https://t.me/{0}".format(
                    urllib.parse.quote(str(user_username).lstrip("@"))
                )
            elif user_id:
                profile_link = "tg://user?id={0}".format(int(user_id))

            if profile_link:
                lines.append(
                    'Покупатель: <a href="{0}">{1}</a> (ID: {2})'.format(
                        html.escape(profile_link, quote=True),
                        safe_user_name,
                        safe_user_id,
                    )
                )
            else:
                lines.append(
                    "Покупатель: {0} (ID: {1})".format(safe_user_name, safe_user_id)
                )
        if order_id is not None:
            lines.append("Заказ: #{0}".format(html.escape(str(order_id))))
        if received_at:
            lines.append("Время: {0}".format(html.escape(str(received_at))))

        text = "\n".join(lines)
        for admin_id in sorted(self.admin_ids):
            try:
                self.send_message(admin_id, text, parse_mode="HTML")
            except Exception as exc:
                LOG.warning(
                    "Failed to notify admin %s about purchase: %s", admin_id, exc
                )

    def append_recent_purchase(
        self,
        payment_method,
        user_id=None,
        user_name="",
        user_username="",
        item=None,
        amount_text="",
        order_id=None,
        received_at="",
    ):
        entries = self.state.setdefault("recent_purchases", [])
        entries.append(
            {
                "payment_method": payment_method,
                "user_id": user_id,
                "user_name": user_name,
                "user_username": user_username,
                "item_id": item.get("id") if item else None,
                "item_title": item.get("title") if item else "",
                "amount_text": amount_text,
                "order_id": order_id,
                "received_at": received_at or utc_now(),
            }
        )
        self.state["recent_purchases"] = entries[-20:]

    def send_message(
        self,
        chat_id,
        text,
        reply_markup=None,
        parse_mode=None,
        disable_web_page_preview=None,
    ):
        payload = {
            "chat_id": chat_id,
            "text": text,
        }
        if reply_markup:
            payload["reply_markup"] = reply_markup
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if disable_web_page_preview is not None:
            payload["disable_web_page_preview"] = bool(disable_web_page_preview)
        return self.api_call("sendMessage", payload)

    def menu_labels(self):
        return {
            "catalog": "📚 Каталог",
            "how_to_buy": "⭐ Как купить Stars",
            "create_photo_post": "🖼 Создать фото-пост",
            "create_video_post": "🎬 Создать видео-пост",
            "my_posts": "🗂 Мои посты",
            "balance": "💰 Баланс Stars",
            "transactions": "📈 Операции Stars",
            "sales": "🧾 Последние покупки",
            "admin_help": "🛠 Помощь админа",
            "back": "⬅️ Назад",
            "cancel": "❌ Отмена",
        }

    def is_menu_button(self, text, key):
        labels = self.menu_labels()
        legacy = {
            "catalog": {"Каталог"},
            "how_to_buy": {"Как купить"},
            "create_photo_post": {"Создать фото-пост"},
            "create_video_post": {"Создать видео-пост"},
            "my_posts": {"Мои посты"},
            "balance": {"Баланс Stars"},
            "transactions": {"Операции Stars"},
            "sales": {"Последние покупки"},
            "admin_help": {"Помощь админа"},
            "back": {"Назад"},
            "cancel": {"Отмена"},
        }
        return text in {labels[key], *legacy.get(key, set())}

    def build_main_keyboard(self, user_id=None):
        labels = self.menu_labels()
        rows = [
            [{"text": labels["catalog"]}, {"text": labels["how_to_buy"]}],
        ]

        if user_id is not None and self.is_admin(user_id):
            rows.extend(
                [
                    [{"text": labels["create_photo_post"]}, {"text": labels["create_video_post"]}],
                    [{"text": labels["my_posts"]}, {"text": labels["balance"]}],
                    [{"text": labels["transactions"]}, {"text": labels["sales"]}],
                    [{"text": labels["admin_help"]}],
                    [{"text": labels["back"]}, {"text": labels["cancel"]}],
                ]
            )
        else:
            rows.append([{"text": labels["back"]}])

        return {
            "keyboard": rows,
            "resize_keyboard": True,
            "is_persistent": True,
        }

    def send_with_main_keyboard(self, chat_id, user_id, text):
        # Telegram requires a non-empty message text to attach a reply keyboard.
        text = text or "\u2063"
        return self.send_message(
            chat_id,
            text,
            reply_markup=self.build_main_keyboard(user_id=user_id),
        )

    def answer_callback(self, callback_id, text=None, show_alert=False):
        payload = {
            "callback_query_id": callback_id,
            "show_alert": bool(show_alert),
        }
        if text:
            payload["text"] = text
        return self.api_call("answerCallbackQuery", payload)

    def set_my_commands(self):
        commands = [
            {"command": "start", "description": "Открыть каталог платных постов"},
            {"command": "catalog", "description": "Показать доступные посты"},
            {"command": "buy", "description": "Купить пост по его ID"},
            {"command": "admin", "description": "Команды администратора"},
            {"command": "items", "description": "Список сохраненных платных постов"},
            {"command": "postphoto", "description": "Создать платный пост из фото"},
            {"command": "postvideo", "description": "Создать платный пост из видео"},
            {"command": "balance", "description": "Показать баланс Telegram Stars"},
            {"command": "transactions", "description": "Последние операции по Stars"},
            {"command": "sales", "description": "Последние покупки магазина"},
        ]
        self.api_call("setMyCommands", {"commands": commands})

    def refresh_balance(self):
        try:
            balance = self.api_call("getMyStarBalance")
            self.state["last_balance"] = balance
            self.save_state()
            self.update_status(last_balance=balance)
            return balance
        except Exception as exc:
            LOG.warning("Unable to refresh Star balance: %s", exc)
            return self.state.get("last_balance", {})

    def recent_transactions(self, limit_value):
        limit_value = min(max(int(limit_value), 1), 20)
        result = self.api_call("getStarTransactions", {"offset": 0, "limit": limit_value})
        return result.get("transactions", [])

    def setup(self):
        LOG.info("Setup step: getMe")
        self.me = self.api_call("getMe")
        LOG.info("Setup step: setMyCommands")
        self.set_my_commands()
        self.start_platega_webhook_server()

        if self.drop_pending:
            try:
                LOG.info("Setup step: drop pending updates")
                self.api_call(
                    "getUpdates",
                    {
                        "offset": -1,
                        "limit": 1,
                        "allowed_updates": ["message", "callback_query", "purchased_paid_media"],
                    },
                    timeout=10,
                )
                LOG.info("Dropped pending updates on startup")
            except Exception as exc:
                LOG.warning("Unable to drop pending updates: %s", exc)

        LOG.info("Setup step: refresh balance")
        self.refresh_balance()
        LOG.info("Setup step: write runtime status")
        self.update_status(
            bot_username=self.me.get("username", ""),
            bot_id=self.me.get("id", 0),
            last_error="",
            last_exception="",
        )

    def setup_with_retry(self):
        while True:
            try:
                self.setup()
                return
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                friendly_error = describe_connection_error(exc)
                LOG.warning("Startup is waiting for connectivity: %s", friendly_error)
                self.update_status(
                    last_error=friendly_error,
                    last_exception=traceback.format_exc(limit=8),
                    last_poll_at=utc_now(),
                )
                time.sleep(10)

    def get_updates(self, offset_value):
        payload = {
            "offset": int(offset_value),
            "timeout": self.poll_timeout,
            "allowed_updates": ["message", "callback_query", "purchased_paid_media"],
        }
        return self.api_call("getUpdates", payload, timeout=self.poll_timeout + 20)

    def build_catalog_text(self, include_admin_hint=False):
        lines = [self.bot_title, "", self.welcome_text, ""]

        if not self.catalog["items"]:
            lines.append("Пока нет опубликованных платных постов.")
        else:
            lines.append("Доступные платные посты:")
            for item in self.catalog["items"]:
                media_type = "Фото" if item["kind"] == "photo" else "Видео"
                lines.append(
                    "#{0} | {1} | {2} Stars | {3}".format(
                        item["id"], media_type, item["price"], item["title"]
                    )
                )

        if self.catalog["items"]:
            lines.extend(
                [
                    "",
                    "Нажмите кнопку ниже или используйте /buy <id>.",
                ]
            )

        if include_admin_hint:
            lines.extend(
                [
                    "",
                    "Для вашего аккаунта включен режим администратора.",
                    "Быстрая публикация как на скриншоте:",
                    "/postphoto <stars> <название> -> затем отправьте фото",
                    "/postvideo <stars> <название> -> затем отправьте видео",
                    "Бот сразу опубликует платный пост в текущий чат.",
                    "Для остальных команд используйте /admin.",
                ]
            )

        return "\n".join(lines)

    def build_catalog_keyboard(self):
        rows = []
        for item in self.catalog["items"]:
            rows.append(
                [
                    {
                        "text": "Открыть за ⭐ {0}".format(
                            item["price"]
                        ),
                        "callback_data": "buy:{0}".format(item["id"]),
                    }
                ]
            )
        return {"inline_keyboard": rows} if rows else None

    def send_catalog(self, chat_id, user_id=None):
        include_admin = user_id is not None and self.is_admin(user_id)
        return self.send_message(
            chat_id,
            self.build_catalog_text(include_admin_hint=include_admin),
            reply_markup=self.build_catalog_keyboard(),
        )

    def build_admin_items_text(self):
        if not self.catalog["items"]:
            return "\n".join(
                [
                    "Платных постов пока нет.",
                    "",
                    "Как сделать пост как в Telegram Paid Media:",
                    "1. Отправьте /postphoto <stars> <название> или /postvideo <stars> <название>",
                    "2. Затем сразу отправьте фото или видео",
                    "3. Бот сохранит материал и опубликует его в этот чат",
                ]
            )

        lines = ["Ваши платные посты:"]
        for item in self.catalog["items"]:
            media_type = "Фото" if item["kind"] == "photo" else "Видео"
            lines.append(
                "#{0} | {1} | ⭐{2} | {3}".format(
                    item["id"], media_type, item["price"], item["title"]
                )
            )
        lines.extend(
            [
                "",
                "Чтобы опубликовать в текущий чат: /publish <id>",
                "Чтобы изменить цену: /setprice <id> <stars>",
            ]
        )
        return "\n".join(lines)

    def build_admin_items_keyboard(self):
        if not self.catalog["items"]:
            return None

        rows = []
        for item in self.catalog["items"]:
            rows.append(
                [
                    {
                        "text": "🚀 Опубликовать #{0}".format(item["id"]),
                        "callback_data": "publish:{0}".format(item["id"]),
                    },
                    {
                        "text": "🗑 Удалить #{0}".format(item["id"]),
                        "callback_data": "delete:{0}".format(item["id"]),
                    },
                ]
            )
            rows.append(
                [
                    {
                        "text": "💸 Цена #{0}".format(item["id"]),
                        "callback_data": "editprice:{0}".format(item["id"]),
                    },
                    {
                        "text": "✏️ Название #{0}".format(item["id"]),
                        "callback_data": "edittitle:{0}".format(item["id"]),
                    },
                    {
                        "text": "📝 Подпись #{0}".format(item["id"]),
                        "callback_data": "editcaption:{0}".format(item["id"]),
                    },
                ]
            )
        return {"inline_keyboard": rows}

    def send_admin_items(self, chat_id):
        return self.send_message(
            chat_id,
            self.build_admin_items_text(),
            reply_markup=self.build_admin_items_keyboard(),
        )

    def send_paid_item(self, chat_id, item):
        media_payload = [
            {"type": entry["type"], "media": entry["file_id"]}
            for entry in normalize_media_entries(item, item.get("kind", "photo"))
        ]
        payload = {
            "chat_id": chat_id,
            "star_count": int(item["price"]),
            "media": media_payload,
            "payload": "item:{0}".format(item["id"]),
            "caption": safe_caption(item.get("caption") or item.get("title")),
        }
        return self.api_call("sendPaidMedia", payload)

    def notify_subscribers_about_post(self, item, exclude_chat_ids=None):
        exclude = {int(value) for value in (exclude_chat_ids or set())}
        delivered = 0

        for chat_key, subscriber in list(self.state.get("subscribers", {}).items()):
            try:
                chat_id = int(subscriber.get("chat_id", chat_key))
            except (TypeError, ValueError):
                self.forget_subscriber(chat_key)
                continue

            if chat_id in exclude:
                continue

            try:
                self.send_message(
                    chat_id,
                    "🔔 Новый платный пост уже в каталоге.\nОткройте покупку кнопкой ниже.",
                )
                self.send_paid_item(chat_id, item)
                delivered += 1
            except RuntimeError as exc:
                LOG.warning("Failed to notify subscriber %s: %s", chat_id, exc)
                if self.should_forget_subscriber(str(exc)):
                    self.forget_subscriber(chat_id)

        return delivered

    def publish_item_and_notify(self, chat_id, item, exclude_chat_ids=None):
        self.send_paid_item(chat_id, item)

        exclude = set(exclude_chat_ids or set())
        exclude.add(chat_id)
        return self.notify_subscribers_about_post(item, exclude)

    def show_admin_help(self, chat_id):
        text = "\n".join(
            [
                "Команды администратора:",
                "/postphoto <stars> <название> - сразу опубликовать следующее фото как платный пост",
                "/postvideo <stars> <название> - сразу опубликовать следующее видео как платный пост",
                "/addphoto <stars> <название> - сохранить следующее фото в каталог без публикации",
                "/addvideo <stars> <название> - сохранить следующее видео в каталог без публикации",
                "/items - список сохраненных постов",
                "/publish <id> - отправить сохраненный пост в текущий чат",
                "/setprice <id> <stars> - изменить цену",
                "/settitle <id> <название> - изменить название",
                "/setcaption <id> <текст> - изменить подпись платного поста",
                "/delete <id> - удалить пост",
                "/balance - баланс Telegram Stars",
                "/transactions [count] - последние операции Stars",
                "/withdraw - информация о выводе",
                "/cancel - отменить режим ожидания медиа",
            ]
        )
        return self.send_message(chat_id, text)

    def parse_command(self, text):
        if not text or not text.startswith("/"):
            return None, ""

        head, _, tail = text.partition(" ")
        command = head.split("@", 1)[0].lower()
        return command, tail.strip()

    def set_pending_upload(self, chat_id, kind, price, title, publish_chat_id=None):
        pending_upload = {
            "kind": kind,
            "price": int(price),
            "title": title.strip() or "{0} {1}".format(kind.title(), self.catalog["next_id"]),
            "media": [],
            "caption": "",
            "updated_at": 0,
        }
        if publish_chat_id is not None:
            pending_upload["publish_chat_id"] = int(publish_chat_id)
        self.state["pending_uploads"][str(chat_id)] = pending_upload
        self.save_state()

    def clear_pending_upload(self, chat_id):
        self.state["pending_uploads"].pop(str(chat_id), None)
        self.save_state()

    def set_pending_action(self, chat_id, action):
        self.state["pending_actions"][str(chat_id)] = action
        self.save_state()

    def clear_pending_action(self, chat_id):
        self.state["pending_actions"].pop(str(chat_id), None)
        self.save_state()

    def parse_price_and_title(self, raw_value):
        parts = (raw_value or "").strip().split(" ", 1)
        if len(parts) != 2:
            raise ValueError("missing title")

        try:
            price = int(parts[0])
        except ValueError as exc:
            raise ValueError("invalid price") from exc

        title = parts[1].strip()
        if price <= 0:
            raise ValueError("invalid price")
        if not title:
            raise ValueError("missing title")
        return price, title

    def handle_pending_action_input(self, chat_id, user_id, text, pending_action):
        if not self.is_admin(user_id):
            self.clear_pending_action(chat_id)
            return False

        action_type = pending_action.get("type")
        if action_type in {"create_photo_post", "create_video_post"}:
            try:
                price, title = self.parse_price_and_title(text)
            except ValueError:
                self.send_with_main_keyboard(
                    chat_id,
                    user_id,
                    "Введите данные в формате: <цена> <название>\nПример: 152 Фото Ника",
                )
                return True

            media_kind = "photo" if action_type == "create_photo_post" else "video"
            self.set_pending_upload(
                chat_id,
                media_kind,
                price,
                title,
                publish_chat_id=chat_id,
            )
            self.clear_pending_action(chat_id)
            self.send_with_main_keyboard(
                chat_id,
                user_id,
                (
                    "Отлично. Теперь отправьте одно {0}, и я сразу опубликую платный пост "
                    "с кнопкой покупки за Stars."
                ).format("фото" if media_kind == "photo" else "видео"),
            )
            return True

        if action_type in {"edit_price", "edit_title", "edit_caption"}:
            item_id = pending_action.get("item_id")
            item = self.get_item(item_id)
            if not item:
                self.clear_pending_action(chat_id)
                self.send_with_main_keyboard(
                    chat_id,
                    user_id,
                    "Пост для редактирования не найден. Возможно, он уже был удален.",
                )
                return True

            if action_type == "edit_price":
                try:
                    price = int((text or "").strip())
                except ValueError:
                    self.send_with_main_keyboard(
                        chat_id,
                        user_id,
                        "Введите новую цену числом. Пример: 152",
                    )
                    return True

                if price < 1:
                    self.send_with_main_keyboard(
                        chat_id,
                        user_id,
                        "Цена должна быть не меньше 1 Stars.",
                    )
                    return True

                item["price"] = price
                success_text = "Цена поста #{0} обновлена: {1} Stars.".format(item_id, price)
            elif action_type == "edit_title":
                title = (text or "").strip()
                if not title:
                    self.send_with_main_keyboard(
                        chat_id,
                        user_id,
                        "Название не может быть пустым. Отправьте новый заголовок одним сообщением.",
                    )
                    return True

                item["title"] = title
                success_text = "Название поста #{0} обновлено.".format(item_id)
            else:
                caption = safe_caption(text or "")
                if not caption:
                    self.send_with_main_keyboard(
                        chat_id,
                        user_id,
                        "Подпись не может быть пустой. Отправьте новый текст одним сообщением.",
                    )
                    return True

                item["caption"] = caption
                success_text = "Подпись поста #{0} обновлена.".format(item_id)

            self.save_catalog()
            self.clear_pending_action(chat_id)
            self.send_with_main_keyboard(chat_id, user_id, success_text)
            self.send_admin_items(chat_id)
            return True

        self.clear_pending_action(chat_id)
        return False

    def handle_menu_button(self, message, text):
        chat_id = message["chat"]["id"]
        from_user = message.get("from", {})
        user_id = from_user.get("id")

        if self.is_menu_button(text, "catalog"):
            self.send_with_main_keyboard(
                chat_id,
                user_id,
                "Открываю каталог платных постов.",
            )
            self.send_catalog(chat_id, user_id=user_id)
            return True

        if self.is_menu_button(text, "how_to_buy"):
            self.send_message(
                chat_id,
                "Купить звезды дешево можно тут 👉 ⭐️[купить звезды ⭐️](https://t.me/starslly_bot?start=6745392042)",
                reply_markup=self.build_main_keyboard(user_id=user_id),
                parse_mode="Markdown",
                disable_web_page_preview=True,
            )
            return True

        if not self.is_admin(user_id):
            return False

        if self.is_menu_button(text, "create_photo_post"):
            self.set_pending_action(chat_id, {"type": "create_photo_post"})
            self.send_with_main_keyboard(
                chat_id,
                user_id,
                "Введите цену и название одним сообщением.\nПример: 152 Фото Ника",
            )
            return True

        if self.is_menu_button(text, "create_video_post"):
            self.set_pending_action(chat_id, {"type": "create_video_post"})
            self.send_with_main_keyboard(
                chat_id,
                user_id,
                "Введите цену и название одним сообщением.\nПример: 250 Закрытое видео",
            )
            return True

        if self.is_menu_button(text, "my_posts"):
            self.send_admin_items(chat_id)
            return True

        if self.is_menu_button(text, "balance"):
            self.handle_admin_command(message, "/balance", "")
            return True

        if self.is_menu_button(text, "transactions"):
            self.handle_admin_command(message, "/transactions", "")
            return True

        if self.is_menu_button(text, "sales"):
            self.handle_admin_command(message, "/sales", "")
            return True

        if self.is_menu_button(text, "admin_help"):
            self.show_admin_help(chat_id)
            return True

        if self.is_menu_button(text, "back"):
            self.clear_pending_action(chat_id)
            self.clear_pending_upload(chat_id)
            self.send_with_main_keyboard(
                chat_id,
                user_id,
                "Главное меню открыто. Выберите нужное действие кнопками ниже.",
            )
            return True

        if self.is_menu_button(text, "cancel"):
            self.clear_pending_action(chat_id)
            self.clear_pending_upload(chat_id)
            self.send_with_main_keyboard(
                chat_id,
                user_id,
                "Ожидание действия отменено.",
            )
            return True

        return False

    def store_media_item(self, chat_id, message, pending):
        if pending["kind"] == "photo":
            photos = message.get("photo") or []
            if not photos:
                self.send_message(chat_id, "Ожидаю фото. Для выхода используйте /cancel.")
                return
            file_id = photos[-1]["file_id"]
        else:
            video = message.get("video")
            if not video:
                self.send_message(chat_id, "Ожидаю видео. Для выхода используйте /cancel.")
                return
            file_id = video["file_id"]

        item_id = int(self.catalog["next_id"])
        item = {
            "id": item_id,
            "kind": pending["kind"],
            "file_id": file_id,
            "price": int(pending["price"]),
            "title": pending["title"],
            "caption": safe_caption(message.get("caption", "")),
        }

        self.catalog["items"].append(item)
        self.catalog["next_id"] = item_id + 1
        self.save_catalog()
        self.clear_pending_upload(chat_id)
        self.update_status(catalog_items=len(self.catalog["items"]))

        publish_chat_id = pending.get("publish_chat_id")
        if publish_chat_id is not None:
            delivered = self.publish_item_and_notify(int(publish_chat_id), item)
            self.send_message(
                chat_id,
                (
                    "Платный пост #{0} сохранен и опубликован.\n"
                    "Цена: {1} Stars\n"
                    "Уведомлений отправлено: {2}\n"
                    "Чтобы отправить его в другой чат позже, используйте /publish {0}."
                ).format(item_id, item["price"], delivered),
            )
            return

        self.send_message(
            chat_id,
            (
                "Платный пост #{0} сохранен.\n"
                "Цена: {1} Stars\n"
                "Используйте /publish {0}, чтобы отправить его в текущий чат, "
                "или /items для списка постов."
            ).format(item_id, item["price"]),
        )

    def collect_pending_media(self, chat_id, message, pending):
        if pending["kind"] == "photo":
            photos = message.get("photo") or []
            if not photos:
                self.send_message(chat_id, "Ожидаю фото. Для выхода используйте /cancel.")
                return False
            entry = {"type": "photo", "file_id": photos[-1]["file_id"]}
        else:
            video = message.get("video")
            if not video:
                self.send_message(chat_id, "Ожидаю видео. Для выхода используйте /cancel.")
                return False
            entry = {"type": "video", "file_id": video["file_id"]}

        media_entries = pending.setdefault("media", [])
        if any(existing.get("file_id") == entry["file_id"] for existing in media_entries):
            return True

        if len(media_entries) >= 10:
            self.send_message(chat_id, "В одном платном посте можно отправить не более 10 файлов.")
            return False

        media_entries.append(entry)
        if message.get("caption") and not pending.get("caption"):
            pending["caption"] = safe_caption(message.get("caption", ""))

        media_group_id = message.get("media_group_id")
        if media_group_id:
            pending["media_group_id"] = str(media_group_id)

        pending["updated_at"] = time.time()
        self.state["pending_uploads"][str(chat_id)] = pending
        self.save_state()
        return True

    def finalize_pending_upload(self, chat_id, pending):
        media_entries = normalize_media_entries(pending, pending.get("kind", "photo"))
        if not media_entries:
            return False

        item_id = int(self.catalog["next_id"])
        item = {
            "id": item_id,
            "kind": media_entries[0]["type"],
            "file_id": media_entries[0]["file_id"],
            "media": media_entries,
            "price": int(pending["price"]),
            "title": pending["title"],
            "caption": safe_caption(pending.get("caption", "")),
        }

        self.catalog["items"].append(item)
        self.catalog["next_id"] = item_id + 1
        self.save_catalog()
        self.clear_pending_upload(chat_id)
        self.update_status(catalog_items=len(self.catalog["items"]))

        media_count = len(media_entries)
        publish_chat_id = pending.get("publish_chat_id")
        if publish_chat_id is not None:
            delivered = self.publish_item_and_notify(int(publish_chat_id), item)
            self.send_message(
                chat_id,
                (
                    "Платный пост #{0} сохранен и опубликован.\n"
                    "Файлов: {1}\n"
                    "Цена: {2} Stars\n"
                    "Уведомлений отправлено: {3}\n"
                    "Чтобы отправить его в другой чат позже, используйте /publish {0}."
                ).format(item_id, media_count, item["price"], delivered),
            )
            return True

        self.send_message(
            chat_id,
            (
                "Платный пост #{0} сохранен.\n"
                "Файлов: {1}\n"
                "Цена: {2} Stars\n"
                "Используйте /publish {0}, чтобы отправить его в текущий чат, или /items для списка постов."
            ).format(item_id, media_count, item["price"]),
        )
        return True

    def finalize_ready_pending_uploads(self, force=False):
        now = time.time()
        for chat_key, pending in list(self.state["pending_uploads"].items()):
            media_entries = normalize_media_entries(pending, pending.get("kind", "photo"))
            if not media_entries:
                continue

            if force:
                self.finalize_pending_upload(int(chat_key), pending)
                continue

            if pending.get("media_group_id") and now - float(pending.get("updated_at", 0)) >= 1.5:
                self.finalize_pending_upload(int(chat_key), pending)

    def store_media_item(self, chat_id, message, pending):
        if not self.collect_pending_media(chat_id, message, pending):
            return

        if not message.get("media_group_id"):
            self.finalize_pending_upload(chat_id, pending)

    def handle_buy_command(self, chat_id, raw_value):
        if not raw_value:
            self.send_message(chat_id, "Использование: /buy <id>")
            return

        try:
            item_id = int(raw_value.split()[0])
        except ValueError:
            self.send_message(chat_id, "ID поста должен быть числом.")
            return

        item = self.get_item(item_id)
        if not item:
            self.send_message(chat_id, "Пост не найден.")
            return

        self.send_paid_item(chat_id, item)

    def handle_admin_command(self, message, command, args):
        chat_id = message["chat"]["id"]
        user_id = message.get("from", {}).get("id")

        if not self.is_admin(user_id):
            self.send_message(chat_id, "Для этого Telegram-аккаунта нет прав администратора.")
            return

        if command == "/admin":
            self.show_admin_help(chat_id)
            return

        if command == "/items":
            self.send_admin_items(chat_id)
            return

        if command == "/cancel":
            self.clear_pending_upload(chat_id)
            self.send_message(chat_id, "Режим ожидания медиа отключен.")
            return

        if command in {"/addphoto", "/addvideo", "/postphoto", "/postvideo"}:
            parts = args.split(" ", 1)
            if not parts or not parts[0]:
                self.send_message(chat_id, "Использование: {0} <stars> <название>".format(command))
                return
            try:
                price = int(parts[0])
            except ValueError:
                self.send_message(chat_id, "Цена должна быть целым числом Stars.")
                return
            if price < 1:
                self.send_message(chat_id, "Цена должна быть не меньше 1 Stars.")
                return

            title = parts[1] if len(parts) > 1 else ""
            kind = "photo" if command in {"/addphoto", "/postphoto"} else "video"
            publish_chat_id = chat_id if command in {"/postphoto", "/postvideo"} else None
            self.set_pending_upload(chat_id, kind, price, title, publish_chat_id=publish_chat_id)
            self.send_message(
                chat_id,
                (
                    "Режим загрузки включен для {0}.\n"
                    "{1}"
                ).format(
                    "фото" if kind == "photo" else "видео",
                    "Отправьте файл, и бот сразу опубликует платный пост в этот чат."
                    if publish_chat_id is not None
                    else "Отправьте файл, и бот сохранит его в каталог.",
                ),
            )
            return

        if command == "/setprice":
            parts = args.split()
            if len(parts) != 2:
                self.send_message(chat_id, "Использование: /setprice <id> <stars>")
                return
            try:
                item_id = int(parts[0])
                price = int(parts[1])
            except ValueError:
                self.send_message(chat_id, "И ID, и цена должны быть числами.")
                return
            if price < 1:
                self.send_message(chat_id, "Цена должна быть не меньше 1 Stars.")
                return
            item = self.get_item(item_id)
            if not item:
                self.send_message(chat_id, "Пост не найден.")
                return
            item["price"] = price
            self.save_catalog()
            self.send_message(chat_id, "Цена поста #{0} обновлена: {1} Stars.".format(item_id, price))
            return

        if command == "/settitle":
            parts = args.split(" ", 1)
            if len(parts) != 2:
                self.send_message(chat_id, "Использование: /settitle <id> <название>")
                return
            try:
                item_id = int(parts[0])
            except ValueError:
                self.send_message(chat_id, "ID поста должен быть числом.")
                return
            item = self.get_item(item_id)
            if not item:
                self.send_message(chat_id, "Пост не найден.")
                return
            title = parts[1].strip()
            if not title:
                self.send_message(chat_id, "Название не может быть пустым.")
                return
            item["title"] = title
            self.save_catalog()
            self.send_message(chat_id, "Название поста #{0} обновлено.".format(item_id))
            return

        if command == "/setcaption":
            parts = args.split(" ", 1)
            if len(parts) != 2:
                self.send_message(chat_id, "Использование: /setcaption <id> <текст>")
                return
            try:
                item_id = int(parts[0])
            except ValueError:
                self.send_message(chat_id, "ID поста должен быть числом.")
                return
            item = self.get_item(item_id)
            if not item:
                self.send_message(chat_id, "Пост не найден.")
                return
            item["caption"] = safe_caption(parts[1])
            self.save_catalog()
            self.send_message(chat_id, "Подпись поста #{0} обновлена.".format(item_id))
            return

        if command == "/delete":
            if not args:
                self.send_message(chat_id, "Использование: /delete <id>")
                return
            try:
                item_id = int(args.split()[0])
            except ValueError:
                self.send_message(chat_id, "ID поста должен быть числом.")
                return

            item = self.get_item(item_id)
            if not item:
                self.send_message(chat_id, "Пост не найден.")
                return

            self.catalog["items"] = [
                entry for entry in self.catalog["items"] if int(entry["id"]) != item_id
            ]
            self.save_catalog()
            self.update_status(catalog_items=len(self.catalog["items"]))
            self.send_message(chat_id, "Пост #{0} удален.".format(item_id))
            return

        if command == "/publish":
            if not args:
                self.send_message(chat_id, "Использование: /publish <id>")
                return
            try:
                item_id = int(args.split()[0])
            except ValueError:
                self.send_message(chat_id, "ID поста должен быть числом.")
                return
            item = self.get_item(item_id)
            if not item:
                self.send_message(chat_id, "Пост не найден.")
                return
            delivered = self.publish_item_and_notify(chat_id, item)
            self.send_message(
                chat_id,
                "Пост #{0} опубликован. Уведомлений отправлено: {1}.".format(
                    item_id, delivered
                ),
            )
            return

        if command == "/balance":
            balance = self.refresh_balance()
            amount = balance.get("amount", 0)
            nanostars = balance.get("nanostar_amount", 0)
            self.send_message(
                chat_id,
                "Текущий баланс бота: {0} Stars ({1} nanostars)".format(amount, nanostars),
            )
            return

        if command == "/transactions":
            count = 5
            if args:
                try:
                    count = int(args.split()[0])
                except ValueError:
                    self.send_message(chat_id, "Количество должно быть числом от 1 до 20.")
                    return
            transactions = self.recent_transactions(count)
            if not transactions:
                self.send_message(chat_id, "Telegram пока не вернул операции Stars.")
                return

            lines = ["Последние операции Stars:"]
            for entry in transactions:
                partner = entry.get("source") or entry.get("receiver") or {}
                partner_type = partner.get("type", "unknown")
                transaction_type = partner.get("transaction_type", "")
                payload = partner.get("paid_media_payload", "")
                item_hint = ""
                if payload.startswith("item:"):
                    item_hint = " ({0})".format(payload)
                lines.append(
                    "#{0} | {1} Stars | {2} | {3}{4}".format(
                        entry.get("id", "?"),
                        entry.get("amount", 0),
                        partner_type,
                        transaction_type or "n/a",
                        item_hint,
                    )
                )
            self.send_message(chat_id, "\n".join(lines))
            return

        if command == "/withdraw":
            self.send_message(
                chat_id,
                (
                    "Автоматический вывод Stars здесь не реализован.\n"
                    "Бот умеет показывать баланс и историю операций, "
                    "а вывод настраивается отдельно от обычного Bot API токена."
                ),
            )
            return

    def handle_callback_query(self, query):
        data = query.get("data", "")
        callback_id = query.get("id")
        from_user = query.get("from", {})
        chat_id = from_user.get("id")
        message_chat_id = query.get("message", {}).get("chat", {}).get("id") or chat_id

        if ":" not in data:
            self.answer_callback(callback_id, "Неподдерживаемое действие.", show_alert=True)
            return

        action, raw_item_id = data.split(":", 1)
        try:
            item_id = int(raw_item_id)
        except ValueError:
            self.answer_callback(callback_id, "Некорректный ID поста.", show_alert=True)
            return

        item = self.get_item(item_id)
        if not item:
            self.answer_callback(callback_id, "Пост не найден.", show_alert=True)
            return

        if action == "buy":
            self.answer_callback(callback_id, "Открываю покупку в Stars.")
            self.send_paid_item(chat_id, item)
            return

        if not self.is_admin(from_user.get("id")):
            self.answer_callback(callback_id, "Это действие только для администратора.", show_alert=True)
            return

        if action == "publish":
            self.answer_callback(callback_id, "Публикую пост в текущий чат.")
            delivered = self.publish_item_and_notify(message_chat_id, item)
            self.send_message(
                message_chat_id,
                "Пост #{0} опубликован. Уведомлений отправлено: {1}.".format(
                    item_id, delivered
                ),
            )
            return

        if action in {"editprice", "edittitle", "editcaption"}:
            if action == "editprice":
                prompt = (
                    "Введите новую цену для поста #{0} одним сообщением.\n"
                    "Текущая цена: {1} Stars"
                ).format(item_id, item.get("price", 0))
                pending_type = "edit_price"
            elif action == "edittitle":
                prompt = (
                    "Введите новое название для поста #{0} одним сообщением.\n"
                    "Сейчас: {1}"
                ).format(item_id, item.get("title") or "-")
                pending_type = "edit_title"
            else:
                prompt = (
                    "Введите новую подпись для поста #{0} одним сообщением.\n"
                    "Сейчас: {1}"
                ).format(item_id, item.get("caption") or item.get("title") or "-")
                pending_type = "edit_caption"

            self.set_pending_action(message_chat_id, {
                "type": pending_type,
                "item_id": item_id,
            })
            self.answer_callback(callback_id, "Режим редактирования включен.")
            self.send_with_main_keyboard(message_chat_id, from_user.get("id"), prompt)
            return

        if action == "delete":
            self.catalog["items"] = [
                entry for entry in self.catalog["items"] if int(entry["id"]) != item_id
            ]
            self.save_catalog()
            self.update_status(catalog_items=len(self.catalog["items"]))
            self.answer_callback(callback_id, "Пост удален.")
            self.send_admin_items(message_chat_id)
            return

        self.answer_callback(callback_id, "Неподдерживаемое действие.", show_alert=True)

    def handle_purchase_update(self, payload):
        user = payload.get("from", {})
        purchase_payload = payload.get("paid_media_payload", "")
        item = None

        if purchase_payload.startswith("item:"):
            try:
                item = self.get_item(int(purchase_payload.split(":", 1)[1]))
            except ValueError:
                item = None

        purchase_info = {
            "user_id": user.get("id"),
            "user_name": compact_name(user),
            "user_username": str(user.get("username") or ""),
            "payload": purchase_payload,
            "received_at": utc_now(),
            "item_id": item.get("id") if item else None,
            "item_title": item.get("title") if item else "",
        }

        self.state["stats"]["purchases"] += 1
        self.state["last_purchase"] = purchase_info
        self.save_state()
        self.refresh_balance()
        self.update_status(last_purchase=purchase_info)

        if user.get("id"):
            thank_you = "Purchase confirmed. Thank you for supporting the shop."
            if item:
                thank_you += "\nUnlocked item: #{0} {1}".format(item["id"], item["title"])
            self.send_message(user["id"], thank_you)

        self.append_recent_purchase(
            "Telegram Stars",
            user_id=purchase_info.get("user_id"),
            user_name=purchase_info.get("user_name", ""),
            user_username=purchase_info.get("user_username", ""),
            item=item,
            amount_text=(
                "{0} Stars".format(item.get("price"))
                if item and item.get("price") is not None
                else ""
            ),
            received_at=purchase_info.get("received_at", ""),
        )
        self.save_state()
        self.notify_admin_purchase(
            "Telegram Stars",
            user_id=purchase_info.get("user_id"),
            user_name=purchase_info.get("user_name", ""),
            user_username=purchase_info.get("user_username", ""),
            item=item,
            amount_text=(
                "{0} Stars".format(item.get("price"))
                if item and item.get("price") is not None
                else ""
            ),
            received_at=purchase_info.get("received_at", ""),
        )

    _legacy_build_catalog_text = build_catalog_text
    _legacy_build_catalog_keyboard = build_catalog_keyboard
    _legacy_build_admin_items_text = build_admin_items_text
    _legacy_build_admin_items_keyboard = build_admin_items_keyboard
    _legacy_send_catalog = send_catalog
    _legacy_send_admin_items = send_admin_items
    _legacy_show_admin_help = show_admin_help
    _legacy_publish_item_and_notify = publish_item_and_notify
    _legacy_handle_pending_action_input = handle_pending_action_input
    _legacy_handle_admin_command = handle_admin_command
    _legacy_handle_callback_query = handle_callback_query
    _legacy_handle_purchase_update = handle_purchase_update

    def build_catalog_text(self, include_admin_hint=False):
        lines = [self.bot_title, "", self.welcome_text, ""]

        if not self.catalog["items"]:
            lines.append("No published paid posts yet.")
        else:
            lines.append("Available paid posts:")
            for item in self.catalog["items"]:
                media_type = "Photo" if item["kind"] == "photo" else "Video"
                price_parts = ["{0} Stars".format(item["price"])]
                rub_price = self.item_rub_price(item)
                if rub_price > 0:
                    price_parts.append("{0} RUB via SBP".format(self.format_rub_amount(rub_price)))
                lines.append(
                    "#{0} | {1} | {2} | {3}".format(
                        item["id"], media_type, " / ".join(price_parts), item["title"]
                    )
                )

        if self.catalog["items"]:
            lines.extend(
                [
                    "",
                    "Use the buttons below, or /buy <id> for Stars.",
                ]
            )
            if self.has_platega_credentials():
                lines.append("For SBP use /buyrub <id>.")

        if include_admin_hint and self.admin_ids:
            lines.extend(["", "Admin commands: /admin"])

        return "\n".join(lines)

    def build_catalog_keyboard(self):
        rows = []
        for item in self.catalog["items"]:
            row = self.build_item_purchase_buttons(item)
            rows.append(row)
        return {"inline_keyboard": rows} if rows else None

    def build_item_purchase_buttons(self, item):
        row = [
            {
                "text": "Open for ⭐ {0}".format(item["price"]),
                "callback_data": "buy:{0}".format(item["id"]),
            }
        ]
        rub_price = self.item_rub_price(item)
        if rub_price > 0 and self.has_platega_credentials():
            row.append(
                {
                    "text": "Buy for {0} RUB SBP".format(
                        self.format_rub_amount(rub_price)
                    ),
                    "callback_data": "buyrub:{0}".format(item["id"]),
                }
            )
        return row

    def build_item_purchase_keyboard(self, item):
        return {"inline_keyboard": [self.build_item_purchase_buttons(item)]}

    def send_item_purchase_options(self, chat_id, item):
        self.send_message(
            chat_id,
            "Choose a payment method for post #{0}:".format(item["id"]),
            reply_markup=self.build_item_purchase_keyboard(item),
        )

    def build_admin_items_text(self):
        if not self.catalog["items"]:
            return "Catalog is empty. Use /addphoto or /addvideo."

        lines = ["Your paid posts:"]
        for item in self.catalog["items"]:
            media_type = "Photo" if item["kind"] == "photo" else "Video"
            price_parts = ["⭐{0}".format(item["price"])]
            rub_price = self.item_rub_price(item)
            if rub_price > 0:
                price_parts.append("{0} RUB".format(self.format_rub_amount(rub_price)))
            lines.append(
                "#{0} | {1} | {2} | {3}".format(
                    item["id"], media_type, " / ".join(price_parts), item["title"]
                )
            )

        lines.extend(
            [
                "",
                "Publish: /publish <id>",
                "Set Stars price: /setprice <id> <stars>",
                "Set SBP price: /setrubprice <id> <rubles>",
                "Recent SBP orders: /orders",
            ]
        )
        return "\n".join(lines)

    def build_admin_items_keyboard(self):
        if not self.catalog["items"]:
            return None

        rows = []
        for item in self.catalog["items"]:
            rows.append(
                [
                    {
                        "text": "Publish #{0}".format(item["id"]),
                        "callback_data": "publish:{0}".format(item["id"]),
                    },
                    {
                        "text": "Delete #{0}".format(item["id"]),
                        "callback_data": "delete:{0}".format(item["id"]),
                    },
                ]
            )
            rows.append(
                [
                    {
                        "text": "Stars #{0}".format(item["id"]),
                        "callback_data": "editprice:{0}".format(item["id"]),
                    },
                    {
                        "text": "RUB #{0}".format(item["id"]),
                        "callback_data": "editrubprice:{0}".format(item["id"]),
                    },
                    {
                        "text": "Title #{0}".format(item["id"]),
                        "callback_data": "edittitle:{0}".format(item["id"]),
                    },
                    {
                        "text": "Caption #{0}".format(item["id"]),
                        "callback_data": "editcaption:{0}".format(item["id"]),
                    },
                ]
            )
        return {"inline_keyboard": rows}

    def send_catalog(self, chat_id, user_id=None):
        self.send_message(
            chat_id,
            self.build_catalog_text(include_admin_hint=self.is_admin(user_id)),
            reply_markup=self.build_catalog_keyboard(),
        )

    def send_admin_items(self, chat_id):
        self.send_message(
            chat_id,
            self.build_admin_items_text(),
            reply_markup=self.build_admin_items_keyboard(),
        )

    def publish_item_and_notify(self, chat_id, item, exclude_chat_ids=None):
        delivered = self._legacy_publish_item_and_notify(chat_id, item, exclude_chat_ids)
        self.send_item_purchase_options(chat_id, item)
        return delivered

    def show_admin_help(self, chat_id):
        text = "\n".join(
            [
                "Admin commands:",
                "/postphoto <stars> <title> - publish next photo as paid post",
                "/postvideo <stars> <title> - publish next video as paid post",
                "/addphoto <stars> <title> - save next photo to catalog",
                "/addvideo <stars> <title> - save next video to catalog",
                "/items - show catalog items",
                "/publish <id> - publish saved post to current chat",
                "/setprice <id> <stars> - change Telegram Stars price",
                "/setrubprice <id> <rubles> - change SBP price in RUB",
                "/settitle <id> <title> - change title",
                "/setcaption <id> <text> - change caption",
                "/delete <id> - delete item",
                "/sales - recent purchases list",
                "/orders - recent SBP orders",
                "/balance - Telegram Stars balance",
                "/transactions [count] - recent Stars operations",
                "/withdraw - withdrawal info",
            ]
        )
        self.send_message(chat_id, text)

    def handle_pending_action_input(self, chat_id, user_id, text, pending_action):
        if pending_action.get("type") != "edit_rub_price":
            return self._legacy_handle_pending_action_input(
                chat_id, user_id, text, pending_action
            )

        if not self.is_admin(user_id):
            self.clear_pending_action(chat_id)
            return False

        item_id = pending_action.get("item_id")
        item = self.get_item(item_id)
        if not item:
            self.clear_pending_action(chat_id)
            self.send_with_main_keyboard(chat_id, user_id, "Item not found.")
            return True

        try:
            rub_price = round(float((text or "").strip().replace(",", ".")), 2)
        except ValueError:
            self.send_with_main_keyboard(
                chat_id,
                user_id,
                "Send the new SBP price as a number. Example: 299",
            )
            return True

        if rub_price < 0:
            self.send_with_main_keyboard(
                chat_id,
                user_id,
                "SBP price cannot be negative.",
            )
            return True

        item["rub_price"] = rub_price
        self.save_catalog()
        self.clear_pending_action(chat_id)
        self.send_with_main_keyboard(
            chat_id,
            user_id,
            "SBP price for post #{0} updated: {1} RUB.".format(
                item_id, self.format_rub_amount(rub_price)
            ),
        )
        self.send_admin_items(chat_id)
        return True

    def handle_buy_rub_command(self, chat_id, user, raw_value):
        if not raw_value:
            self.send_message(chat_id, "Usage: /buyrub <id>")
            return

        try:
            item_id = int(raw_value.split()[0])
        except ValueError:
            self.send_message(chat_id, "Item id must be a number.")
            return

        item = self.get_item(item_id)
        if not item:
            self.send_message(chat_id, "Post not found.")
            return

        rub_price = self.item_rub_price(item)
        if rub_price <= 0:
            self.send_message(chat_id, "SBP price is not configured for this item yet.")
            return

        if not self.has_platega_credentials():
            self.send_message(chat_id, "SBP payments are not configured yet.")
            return

        try:
            order = self.create_platega_order(chat_id, user, item)
        except Exception as exc:
            LOG.exception("Unable to create Platega order")
            self.send_message(chat_id, "Unable to create SBP payment: {0}".format(exc))
            return

        message_lines = [
            "SBP order created.",
            "Order: #{0}".format(order["id"]),
            "Item: #{0} {1}".format(item["id"], item.get("title", "")),
            "Amount: {0} RUB".format(self.format_rub_amount(order["amount_rub"])),
        ]
        payment_url = order.get("payment_url")
        if payment_url:
            message_lines.append("Pay here: {0}".format(payment_url))
        message_lines.append("After confirmation I will send the media directly in this chat.")
        self.send_message(chat_id, "\n".join(message_lines), disable_web_page_preview=True)

    def send_orders_summary(self, chat_id):
        if not self.orders["items"]:
            self.send_message(chat_id, "No SBP orders yet.")
            return

        lines = ["Recent SBP orders:"]
        for order in list(reversed(self.orders["items"]))[:10]:
            lines.append(
                "#{0} | item #{1} | {2} RUB | {3} | delivery: {4}".format(
                    order["id"],
                    order["item_id"],
                    self.format_rub_amount(order.get("amount_rub", 0)),
                    order.get("status", "-"),
                    order.get("delivery_state", "-"),
                )
            )
        self.send_message(chat_id, "\n".join(lines))

    def send_sales_summary(self, chat_id):
        items = list(reversed(self.state.get("recent_purchases", [])))[:10]
        if not items:
            self.send_message(chat_id, "No purchases yet.")
            return

        lines = ["Recent purchases:"]
        for entry in items:
            safe_time = html.escape(str(entry.get("received_at", "-")))
            safe_method = html.escape(str(entry.get("payment_method", "-")))
            safe_item_id = html.escape(str(entry.get("item_id") or "-"))
            safe_amount = html.escape(str(entry.get("amount_text") or "-"))
            display_name = str(
                entry.get("user_name")
                or ("@" + str(entry.get("user_username")) if entry.get("user_username") else "")
                or entry.get("user_id")
                or "-"
            )
            safe_name = html.escape(display_name)
            user_id = entry.get("user_id")
            user_username = str(entry.get("user_username") or "").lstrip("@")
            profile_link = ""
            if user_username:
                profile_link = "https://t.me/{0}".format(
                    urllib.parse.quote(user_username)
                )
            elif user_id:
                profile_link = "tg://user?id={0}".format(int(user_id))

            if profile_link:
                buyer_value = '<a href="{0}">{1}</a>'.format(
                    html.escape(profile_link, quote=True),
                    safe_name,
                )
            else:
                buyer_value = safe_name

            lines.append(
                "{0} | {1} | #{2} | {3} | {4}".format(
                    safe_time,
                    safe_method,
                    safe_item_id,
                    safe_amount,
                    buyer_value,
                )
            )
        self.send_message(chat_id, "\n".join(lines), parse_mode="HTML")

    def handle_admin_command(self, message, command, args):
        chat_id = message["chat"]["id"]
        user_id = message.get("from", {}).get("id")

        if command == "/admin":
            if not self.is_admin(user_id):
                self.send_message(chat_id, "Administrator access is required.")
                return
            self.show_admin_help(chat_id)
            return

        if command == "/setrubprice":
            if not self.is_admin(user_id):
                self.send_message(chat_id, "Administrator access is required.")
                return
            parts = args.split()
            if len(parts) != 2:
                self.send_message(chat_id, "Usage: /setrubprice <id> <rubles>")
                return
            try:
                item_id = int(parts[0])
                rub_price = round(float(parts[1].replace(",", ".")), 2)
            except ValueError:
                self.send_message(chat_id, "Item id and ruble price must be numeric.")
                return
            if rub_price < 0:
                self.send_message(chat_id, "SBP price cannot be negative.")
                return
            item = self.get_item(item_id)
            if not item:
                self.send_message(chat_id, "Post not found.")
                return
            item["rub_price"] = rub_price
            self.save_catalog()
            self.send_message(
                chat_id,
                "SBP price for post #{0} updated: {1} RUB.".format(
                    item_id, self.format_rub_amount(rub_price)
                ),
            )
            return

        if command == "/orders":
            if not self.is_admin(user_id):
                self.send_message(chat_id, "Administrator access is required.")
                return
            self.send_orders_summary(chat_id)
            return

        if command == "/sales":
            if not self.is_admin(user_id):
                self.send_message(chat_id, "Administrator access is required.")
                return
            self.send_sales_summary(chat_id)
            return

        return self._legacy_handle_admin_command(message, command, args)

    def handle_callback_query(self, query):
        data = query.get("data", "")
        callback_id = query.get("id")
        from_user = query.get("from", {})
        chat_id = from_user.get("id")
        message_chat_id = query.get("message", {}).get("chat", {}).get("id") or chat_id

        if data.startswith("buyrub:"):
            try:
                item_id = int(data.split(":", 1)[1])
            except ValueError:
                self.answer_callback(callback_id, "Invalid item id.", show_alert=True)
                return
            item = self.get_item(item_id)
            if not item:
                self.answer_callback(callback_id, "Post not found.", show_alert=True)
                return
            self.answer_callback(callback_id, "Creating SBP payment link...")
            self.handle_buy_rub_command(chat_id, from_user, str(item_id))
            return

        if data.startswith("editrubprice:"):
            if not self.is_admin(from_user.get("id")):
                self.answer_callback(callback_id, "Admin only.", show_alert=True)
                return
            try:
                item_id = int(data.split(":", 1)[1])
            except ValueError:
                self.answer_callback(callback_id, "Invalid item id.", show_alert=True)
                return
            item = self.get_item(item_id)
            if not item:
                self.answer_callback(callback_id, "Post not found.", show_alert=True)
                return
            self.set_pending_action(
                message_chat_id,
                {"type": "edit_rub_price", "item_id": item_id},
            )
            self.answer_callback(callback_id, "SBP price edit mode enabled.")
            self.send_with_main_keyboard(
                message_chat_id,
                from_user.get("id"),
                "Send new SBP price for post #{0}.\nCurrent: {1} RUB".format(
                    item_id, self.format_rub_amount(self.item_rub_price(item))
                ),
            )
            return

        return self._legacy_handle_callback_query(query)

    def handle_purchase_update(self, payload):
        self.state["stats"]["stars_purchases"] += 1
        self.save_state()
        return self._legacy_handle_purchase_update(payload)

    def handle_message(self, message):
        chat_id = message["chat"]["id"]
        from_user = message.get("from", {})
        user_id = from_user.get("id")
        text = (message.get("text") or "").strip()

        self.remember_private_subscriber(message.get("chat", {}), from_user)

        pending = self.state["pending_uploads"].get(str(chat_id))
        if pending and self.is_admin(user_id) and (message.get("photo") or message.get("video")):
            self.store_media_item(chat_id, message, pending)
            return

        if not text:
            return

        if self.handle_menu_button(message, text):
            return

        pending_action = self.state["pending_actions"].get(str(chat_id))
        if pending_action and self.handle_pending_action_input(
            chat_id, user_id, text, pending_action
        ):
            return

        command, args = self.parse_command(text)
        if not command:
            return

        if command in {"/start", "/catalog"}:
            self.send_with_main_keyboard(chat_id, user_id, "")
            self.send_catalog(chat_id, user_id=user_id)
            return

        if command == "/buy":
            self.handle_buy_command(chat_id, args)
            return

        if command == "/buyrub":
            self.handle_buy_rub_command(chat_id, from_user, args)
            return

        if command in {
            "/admin",
            "/cancel",
            "/addphoto",
            "/addvideo",
            "/postphoto",
            "/postvideo",
            "/items",
            "/setprice",
            "/settitle",
            "/setcaption",
            "/delete",
            "/publish",
            "/balance",
            "/transactions",
            "/withdraw",
            "/sales",
            "/setrubprice",
            "/orders",
        }:
            self.handle_admin_command(message, command, args)
            return

        if command == "/help":
            self.send_with_main_keyboard(chat_id, user_id, "")
            self.send_catalog(chat_id, user_id=user_id)
            return

        self.send_with_main_keyboard(
            chat_id,
            user_id,
            "Неизвестная команда. Откройте каталог кнопкой ниже или используйте /admin для старых команд.",
        )
        return

    def handle_update(self, update):
        if "message" in update:
            self.handle_message(update["message"])
            return

        if "callback_query" in update:
            self.handle_callback_query(update["callback_query"])
            return

        if "purchased_paid_media" in update:
            self.handle_purchase_update(update["purchased_paid_media"])

    def run(self):
        self.setup_with_retry()
        offset_value = int(self.state.get("offset", 0))

        while True:
            try:
                updates = self.get_updates(offset_value)
                self.update_status(last_poll_at=utc_now(), last_error="", last_exception="")

                for update in updates:
                    offset_value = int(update["update_id"]) + 1
                    self.state["offset"] = offset_value
                    self.state["stats"]["handled_updates"] += 1
                    self.save_state()

                    self.handle_update(update)
                    self.update_status(last_update_id=int(update["update_id"]))

                self.finalize_ready_pending_uploads(force=bool(updates))
                self.check_pending_platega_orders()
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                LOG.exception("Unhandled bot loop error")
                self.update_status(
                    last_error=str(exc),
                    last_exception=traceback.format_exc(limit=8),
                    last_poll_at=utc_now(),
                )
                time.sleep(5)


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="tg-paidmedia: %(asctime)s %(levelname)s %(message)s",
    )

    status_path = os.environ.get("TG_STATUS_PATH", "/var/run/tg-paidmedia/status.json")

    try:
        bot = TelegramPaidMediaBot()
        LOG.info("Starting Telegram Paid Media bot")
        bot.write_status()
        bot.run()
    except KeyboardInterrupt:
        raise
    except Exception as exc:
        exception_text = traceback.format_exc(limit=12)
        LOG.exception("Fatal startup error")

        try:
            if "bot" in locals():
                bot.update_status(
                    last_error=str(exc),
                    last_exception=exception_text,
                    last_poll_at=utc_now(),
                )
            else:
                write_fatal_status(status_path, str(exc), exception_text)
        except Exception:
            LOG.exception("Unable to write fatal status")

        raise


if __name__ == "__main__":
    main()
