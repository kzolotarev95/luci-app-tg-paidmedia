#!/usr/bin/env python3

import datetime
import json
import logging
import os
import pathlib
import tempfile
import time
import traceback
import urllib.error
import urllib.request


LOG = logging.getLogger("tg-paidmedia")


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


class TelegramPaidMediaBot:
    def __init__(self):
        self.token = os.environ.get("TG_BOT_TOKEN", "").strip()
        if not self.token:
            raise RuntimeError("TG_BOT_TOKEN is required")

        self.api_base = "https://api.telegram.org/bot{0}/".format(self.token)
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
        self.bot_title = os.environ.get("TG_BOT_TITLE", "Paid Media Shop").strip()
        self.welcome_text = os.environ.get(
            "TG_WELCOME_TEXT",
            (
                "Choose an item below and Telegram will show the official "
                "Stars purchase confirmation window."
            ),
        ).strip()

        pathlib.Path(self.data_dir).mkdir(parents=True, exist_ok=True)
        pathlib.Path(self.catalog_path).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(self.status_path).parent.mkdir(parents=True, exist_ok=True)

        self.catalog = load_json(self.catalog_path, {"next_id": 1, "items": []})
        self.catalog.setdefault("next_id", 1)
        self.catalog.setdefault("items", [])

        self.state = load_json(
            self.state_path,
            {
                "offset": 0,
                "pending_uploads": {},
                "stats": {
                    "handled_updates": 0,
                    "purchases": 0,
                },
                "last_balance": {},
                "last_purchase": {},
            },
        )
        self.state.setdefault("offset", 0)
        self.state.setdefault("pending_uploads", {})
        self.state.setdefault("stats", {})
        self.state["stats"].setdefault("handled_updates", 0)
        self.state["stats"].setdefault("purchases", 0)
        self.state.setdefault("last_balance", {})
        self.state.setdefault("last_purchase", {})

        self._normalize_catalog()
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
            "stats": self.state.get("stats", {}),
        }

    def _normalize_catalog(self):
        max_id = 0
        normalized = []

        for item in self.catalog.get("items", []):
            if not isinstance(item, dict):
                continue
            if not item.get("id") or not item.get("file_id") or not item.get("kind"):
                continue
            try:
                item_id = int(item["id"])
                price = max(int(item.get("price", 1)), 1)
            except (TypeError, ValueError):
                continue

            kind = str(item.get("kind", "")).strip().lower()
            if kind not in {"photo", "video"}:
                continue

            item["id"] = item_id
            item["kind"] = kind
            item["title"] = (item.get("title") or "Item {0}".format(item_id)).strip() or "Item {0}".format(item_id)
            item["caption"] = safe_caption(item.get("caption", ""))
            item["price"] = price
            max_id = max(max_id, item_id)
            normalized.append(item)

        normalized.sort(key=lambda entry: int(entry["id"]))
        self.catalog["items"] = normalized
        self.catalog["next_id"] = max(int(self.catalog.get("next_id", 1)), max_id + 1)

    def save_catalog(self):
        atomic_write_json(self.catalog_path, self.catalog)

    def save_state(self):
        atomic_write_json(self.state_path, self.state)

    def write_status(self):
        self.status["catalog_items"] = len(self.catalog["items"])
        self.status["stats"] = self.state.get("stats", {})
        self.status["last_balance"] = self.state.get("last_balance", {})
        self.status["last_purchase"] = self.state.get("last_purchase", {})
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
            with urllib.request.urlopen(
                request, timeout=timeout or (self.poll_timeout + 15)
            ) as response:
                data = json.load(response)
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                "Telegram API HTTP error for {0}: {1}".format(method, details)
            ) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(
                "Telegram API connection error for {0}: {1}".format(method, exc)
            ) from exc

        if not data.get("ok"):
            raise RuntimeError(
                "Telegram API error for {0}: {1}".format(
                    method, data.get("description", "unknown error")
                )
            )

        return data.get("result")

    def get_item(self, item_id):
        for item in self.catalog["items"]:
            if int(item["id"]) == int(item_id):
                return item
        return None

    def is_admin(self, user_id):
        return bool(self.admin_ids) and int(user_id) in self.admin_ids

    def send_message(self, chat_id, text, reply_markup=None):
        payload = {
            "chat_id": chat_id,
            "text": text,
        }
        if reply_markup:
            payload["reply_markup"] = reply_markup
        return self.api_call("sendMessage", payload)

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
            {"command": "start", "description": "Open the paid media catalog"},
            {"command": "catalog", "description": "Show available items"},
            {"command": "buy", "description": "Buy an item by numeric id"},
            {"command": "admin", "description": "Show admin command list"},
            {"command": "balance", "description": "Show Telegram Stars balance"},
            {"command": "transactions", "description": "Show recent Star history"},
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
            lines.append("No items are published yet.")
        else:
            lines.append("Catalog:")
            for item in self.catalog["items"]:
                media_type = "Photo" if item["kind"] == "photo" else "Video"
                lines.append(
                    "#{0} | {1} | {2} Stars | {3}".format(
                        item["id"], media_type, item["price"], item["title"]
                    )
                )

        lines.extend(
            [
                "",
                "Use /buy <id> or the buttons below.",
            ]
        )

        if include_admin_hint:
            lines.extend(
                [
                    "",
                    "Admin mode is enabled for your account.",
                    "Use /admin to see upload and pricing commands.",
                ]
            )

        return "\n".join(lines)

    def build_catalog_keyboard(self):
        rows = []
        for item in self.catalog["items"]:
            rows.append(
                [
                    {
                        "text": "Buy #{0} - {1} Stars".format(
                            item["id"], item["price"]
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

    def send_paid_item(self, chat_id, item):
        payload = {
            "chat_id": chat_id,
            "star_count": int(item["price"]),
            "media": [
                {
                    "type": "photo" if item["kind"] == "photo" else "video",
                    "media": item["file_id"],
                }
            ],
            "payload": "item:{0}".format(item["id"]),
            "caption": safe_caption(item.get("caption") or item.get("title")),
        }
        return self.api_call("sendPaidMedia", payload)

    def show_admin_help(self, chat_id):
        text = "\n".join(
            [
                "Admin commands:",
                "/addphoto <stars> <title> - wait for the next photo",
                "/addvideo <stars> <title> - wait for the next video",
                "/setprice <id> <stars> - change price",
                "/settitle <id> <title> - change title",
                "/setcaption <id> <caption> - change paid caption",
                "/delete <id> - remove item",
                "/publish <id> - send the paid item to current chat",
                "/balance - current Telegram Stars balance",
                "/transactions [count] - last incoming and outgoing Star events",
                "/withdraw - explain current payout limitation",
                "/cancel - cancel pending upload mode",
            ]
        )
        return self.send_message(chat_id, text)

    def parse_command(self, text):
        if not text or not text.startswith("/"):
            return None, ""

        head, _, tail = text.partition(" ")
        command = head.split("@", 1)[0].lower()
        return command, tail.strip()

    def set_pending_upload(self, chat_id, kind, price, title):
        self.state["pending_uploads"][str(chat_id)] = {
            "kind": kind,
            "price": int(price),
            "title": title.strip() or "{0} {1}".format(kind.title(), self.catalog["next_id"]),
        }
        self.save_state()

    def clear_pending_upload(self, chat_id):
        self.state["pending_uploads"].pop(str(chat_id), None)
        self.save_state()

    def store_media_item(self, chat_id, message, pending):
        if pending["kind"] == "photo":
            photos = message.get("photo") or []
            if not photos:
                self.send_message(chat_id, "Waiting for a photo. Send /cancel to leave upload mode.")
                return
            file_id = photos[-1]["file_id"]
        else:
            video = message.get("video")
            if not video:
                self.send_message(chat_id, "Waiting for a video. Send /cancel to leave upload mode.")
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

        self.send_message(
            chat_id,
            (
                "Saved item #{0}: {1}\n"
                "Price: {2} Stars\n"
                "Use /publish {0} to send it here or /catalog to review the shop."
            ).format(item_id, item["title"], item["price"]),
        )

    def handle_buy_command(self, chat_id, raw_value):
        if not raw_value:
            self.send_message(chat_id, "Usage: /buy <id>")
            return

        try:
            item_id = int(raw_value.split()[0])
        except ValueError:
            self.send_message(chat_id, "Item id must be a number.")
            return

        item = self.get_item(item_id)
        if not item:
            self.send_message(chat_id, "Item not found.")
            return

        self.send_paid_item(chat_id, item)

    def handle_admin_command(self, message, command, args):
        chat_id = message["chat"]["id"]
        user_id = message.get("from", {}).get("id")

        if not self.is_admin(user_id):
            self.send_message(chat_id, "Admin access is denied for this Telegram account.")
            return

        if command == "/admin":
            self.show_admin_help(chat_id)
            return

        if command == "/cancel":
            self.clear_pending_upload(chat_id)
            self.send_message(chat_id, "Pending upload mode cleared.")
            return

        if command in {"/addphoto", "/addvideo"}:
            parts = args.split(" ", 1)
            if not parts or not parts[0]:
                self.send_message(chat_id, "Usage: {0} <stars> <title>".format(command))
                return
            try:
                price = int(parts[0])
            except ValueError:
                self.send_message(chat_id, "Price must be an integer number of Stars.")
                return
            if price < 1:
                self.send_message(chat_id, "Price must be at least 1 Star.")
                return

            title = parts[1] if len(parts) > 1 else ""
            kind = "photo" if command == "/addphoto" else "video"
            self.set_pending_upload(chat_id, kind, price, title)
            self.send_message(
                chat_id,
                "Upload mode enabled for a {0}. Send the media file now.".format(kind),
            )
            return

        if command == "/setprice":
            parts = args.split()
            if len(parts) != 2:
                self.send_message(chat_id, "Usage: /setprice <id> <stars>")
                return
            try:
                item_id = int(parts[0])
                price = int(parts[1])
            except ValueError:
                self.send_message(chat_id, "Both id and price must be integers.")
                return
            if price < 1:
                self.send_message(chat_id, "Price must be at least 1 Star.")
                return
            item = self.get_item(item_id)
            if not item:
                self.send_message(chat_id, "Item not found.")
                return
            item["price"] = price
            self.save_catalog()
            self.send_message(chat_id, "Item #{0} price updated to {1} Stars.".format(item_id, price))
            return

        if command == "/settitle":
            parts = args.split(" ", 1)
            if len(parts) != 2:
                self.send_message(chat_id, "Usage: /settitle <id> <title>")
                return
            try:
                item_id = int(parts[0])
            except ValueError:
                self.send_message(chat_id, "Item id must be an integer.")
                return
            item = self.get_item(item_id)
            if not item:
                self.send_message(chat_id, "Item not found.")
                return
            title = parts[1].strip()
            if not title:
                self.send_message(chat_id, "Title cannot be empty.")
                return
            item["title"] = title
            self.save_catalog()
            self.send_message(chat_id, "Item #{0} title updated.".format(item_id))
            return

        if command == "/setcaption":
            parts = args.split(" ", 1)
            if len(parts) != 2:
                self.send_message(chat_id, "Usage: /setcaption <id> <caption>")
                return
            try:
                item_id = int(parts[0])
            except ValueError:
                self.send_message(chat_id, "Item id must be an integer.")
                return
            item = self.get_item(item_id)
            if not item:
                self.send_message(chat_id, "Item not found.")
                return
            item["caption"] = safe_caption(parts[1])
            self.save_catalog()
            self.send_message(chat_id, "Item #{0} caption updated.".format(item_id))
            return

        if command == "/delete":
            if not args:
                self.send_message(chat_id, "Usage: /delete <id>")
                return
            try:
                item_id = int(args.split()[0])
            except ValueError:
                self.send_message(chat_id, "Item id must be an integer.")
                return

            item = self.get_item(item_id)
            if not item:
                self.send_message(chat_id, "Item not found.")
                return

            self.catalog["items"] = [
                entry for entry in self.catalog["items"] if int(entry["id"]) != item_id
            ]
            self.save_catalog()
            self.update_status(catalog_items=len(self.catalog["items"]))
            self.send_message(chat_id, "Item #{0} removed.".format(item_id))
            return

        if command == "/publish":
            if not args:
                self.send_message(chat_id, "Usage: /publish <id>")
                return
            try:
                item_id = int(args.split()[0])
            except ValueError:
                self.send_message(chat_id, "Item id must be an integer.")
                return
            item = self.get_item(item_id)
            if not item:
                self.send_message(chat_id, "Item not found.")
                return
            self.send_paid_item(chat_id, item)
            return

        if command == "/balance":
            balance = self.refresh_balance()
            amount = balance.get("amount", 0)
            nanostars = balance.get("nanostar_amount", 0)
            self.send_message(
                chat_id,
                "Current bot balance: {0} Stars ({1} nanostars)".format(amount, nanostars),
            )
            return

        if command == "/transactions":
            count = 5
            if args:
                try:
                    count = int(args.split()[0])
                except ValueError:
                    self.send_message(chat_id, "Count must be an integer between 1 and 20.")
                    return
            transactions = self.recent_transactions(count)
            if not transactions:
                self.send_message(chat_id, "No Star transactions were returned by Telegram.")
                return

            lines = ["Recent Star transactions:"]
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
                    "Automatic Stars withdrawal is not implemented in this feed.\n"
                    "The bot can track balance and transaction history, but payout workflows "
                    "are handled outside a plain Bot API token flow."
                ),
            )
            return

    def handle_callback_query(self, query):
        data = query.get("data", "")
        callback_id = query.get("id")
        from_user = query.get("from", {})
        chat_id = from_user.get("id")

        if not data.startswith("buy:"):
            self.answer_callback(callback_id, "Unsupported action.", show_alert=True)
            return

        try:
            item_id = int(data.split(":", 1)[1])
        except ValueError:
            self.answer_callback(callback_id, "Invalid item id.", show_alert=True)
            return

        item = self.get_item(item_id)
        if not item:
            self.answer_callback(callback_id, "Item not found.", show_alert=True)
            return

        self.answer_callback(callback_id, "Opening the Telegram Stars purchase window.")
        self.send_paid_item(chat_id, item)

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

    def handle_message(self, message):
        chat_id = message["chat"]["id"]
        from_user = message.get("from", {})
        user_id = from_user.get("id")
        text = (message.get("text") or "").strip()

        pending = self.state["pending_uploads"].get(str(chat_id))
        if pending and self.is_admin(user_id) and (message.get("photo") or message.get("video")):
            self.store_media_item(chat_id, message, pending)
            return

        if not text:
            return

        command, args = self.parse_command(text)
        if not command:
            return

        if command in {"/start", "/catalog"}:
            self.send_catalog(chat_id, user_id=user_id)
            return

        if command == "/buy":
            self.handle_buy_command(chat_id, args)
            return

        if command in {
            "/admin",
            "/cancel",
            "/addphoto",
            "/addvideo",
            "/setprice",
            "/settitle",
            "/setcaption",
            "/delete",
            "/publish",
            "/balance",
            "/transactions",
            "/withdraw",
        }:
            self.handle_admin_command(message, command, args)
            return

        if command == "/help":
            self.send_catalog(chat_id, user_id=user_id)
            return

        self.send_message(
            chat_id,
            "Unknown command. Use /catalog to browse items or /admin if you are the shop owner.",
        )

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
