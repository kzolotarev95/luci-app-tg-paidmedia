#!/usr/bin/env python3

import datetime
import http.client
import json
import logging
import os
import pathlib
import socket
import ssl
import subprocess
import tempfile
import time
import traceback
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
        self.bot_title = os.environ.get("TG_BOT_TITLE", "Магазин платного контента").strip()
        self.welcome_text = os.environ.get(
            "TG_WELCOME_TEXT",
            (
                "Выберите платный пост ниже, и Telegram покажет официальное "
                "окно покупки за Stars."
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
            {"command": "start", "description": "Открыть каталог платных постов"},
            {"command": "catalog", "description": "Показать доступные посты"},
            {"command": "buy", "description": "Купить пост по его ID"},
            {"command": "admin", "description": "Команды администратора"},
            {"command": "items", "description": "Список сохраненных платных постов"},
            {"command": "postphoto", "description": "Создать платный пост из фото"},
            {"command": "postvideo", "description": "Создать платный пост из видео"},
            {"command": "balance", "description": "Показать баланс Telegram Stars"},
            {"command": "transactions", "description": "Последние операции по Stars"},
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

    def send_admin_items(self, chat_id):
        return self.send_message(chat_id, self.build_admin_items_text())

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
        }
        if publish_chat_id is not None:
            pending_upload["publish_chat_id"] = int(publish_chat_id)
        self.state["pending_uploads"][str(chat_id)] = pending_upload
        self.save_state()

    def clear_pending_upload(self, chat_id):
        self.state["pending_uploads"].pop(str(chat_id), None)
        self.save_state()

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
            self.send_paid_item(int(publish_chat_id), item)
            self.send_message(
                chat_id,
                (
                    "Платный пост #{0} сохранен и опубликован.\n"
                    "Цена: {1} Stars\n"
                    "Чтобы отправить его в другой чат позже, используйте /publish {0}."
                ).format(item_id, item["price"]),
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
            self.send_paid_item(chat_id, item)
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
        }:
            self.handle_admin_command(message, command, args)
            return

        if command == "/help":
            self.send_catalog(chat_id, user_id=user_id)
            return

        self.send_message(
            chat_id,
            "Неизвестная команда. Используйте /catalog для каталога или /admin для команд администратора.",
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
