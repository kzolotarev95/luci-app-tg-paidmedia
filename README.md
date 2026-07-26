# TG Paid Media for OpenWrt

<p align="center">
  <img src="./assets/bot-home-header.jpg" alt="TG Paid Media" width="100%" />
</p>

<p align="center">
  <strong>Telegram Paid Media bot + LuCI panel + Telegram Stars + RUB payments in one OpenWrt package.</strong>
</p>

<p align="center">
  Run a paid content bot directly on your router, manage it from LuCI, accept Telegram Stars, connect SBP and YooMoney, and keep service status, logs, webhooks, and reverse tunnel under control from one place.
</p>

<p align="center">
  <a href="https://openwrt.org/"><img alt="OpenWrt" src="https://img.shields.io/badge/OpenWrt-ready-00B5E2?style=for-the-badge&logo=openwrt&logoColor=white"></a>
  <a href="#license"><img alt="License" src="https://img.shields.io/badge/license-MIT-111111?style=for-the-badge"></a>
  <img alt="LuCI" src="https://img.shields.io/badge/LuCI-integrated-1F6FEB?style=for-the-badge">
  <img alt="Telegram Stars" src="https://img.shields.io/badge/Telegram%20Stars-supported-2AABEE?style=for-the-badge">
  <img alt="YooMoney" src="https://img.shields.io/badge/YooMoney-ready-FCC521?style=for-the-badge">
</p>

## Contents

- [Why this project](#why-this-project)
- [What you get](#what-you-get)
- [Quick install](#quick-install)
- [First launch in 5 minutes](#first-launch-in-5-minutes)
- [Payments](#payments)
- [LuCI highlights](#luci-highlights)
- [Bot admin commands](#bot-admin-commands)
- [Project structure](#project-structure)
- [Who this is for](#who-this-is-for)
- [Remove](#remove)
- [License](#license)

## Why this project

`TG Paid Media` is for people who want a self-hosted Telegram paid content store without a separate VPS panel, bulky CMS, or custom backend. The project combines the bot runtime and the LuCI interface into one OpenWrt-friendly package.

What makes it useful:

- Sell photo and video content through Telegram Paid Media.
- Accept native Telegram Stars payments.
- Add RUB payments through `Platega` and `YooMoney`.
- Run everything as an OpenWrt service.
- Configure the bot from LuCI instead of editing files by hand.
- Track health, logs, webhook state, and reverse tunnel status in one interface.

## What you get

### Core features

- Telegram bot for paid media catalog and content delivery.
- Catalog storage in `JSON` with persistent bot state.
- Admin workflow for adding, editing, publishing, and deleting items.
- Telegram Stars sales statistics and recent transaction visibility.
- RUB pricing per item for external payment flows.

### OpenWrt and LuCI integration

- Native LuCI page under `Services -> TG Paid Media`.
- Start, stop, and restart buttons for the bot service.
- Service overview with counters, last events, restart hints, and recent errors.
- Built-in log viewer for fast debugging without extra shell work.
- Settings screen for token, admin IDs, paths, payment configuration, and home header image.

### Payment operations

- `Platega` support for SBP payment flow.
- `YooMoney` support with webhook endpoint and hosted payment flow.
- Quick YooMoney health check for:
  - service state
  - notification secret
  - webhook availability
  - reverse tunnel state
- Quick `Reverse tunnel` on/off button directly inside the YooMoney mini-check.

### Router-friendly deployment

- Designed for OpenWrt environments.
- Install script supports systems with `opkg` and newer images using `apk`.
- Keeps everything local and manageable from the router panel.

## Quick install

Install directly from GitHub:

```sh
wget -qO- "https://raw.githubusercontent.com/kzolotarev95/luci-app-tg-paidmedia/main/openwrt/install.sh?v=$(date +%s)" | sh
```

After installation, open:

```text
LuCI -> Services -> TG Paid Media
```

## First launch in 5 minutes

### 1. Install the package

Run the install command above as `root`.

### 2. Open the LuCI page

Go to:

```text
Services -> TG Paid Media
```

### 3. Fill in the bot basics

In settings, set:

- `Bot token`
- `Admin IDs`
- `Bot title`
- `Welcome text`
- optional home header image

### 4. Enable and start the service

Turn the bot on, save the config, and start or restart the service from the status section.

### 5. Add your first paid content

Use admin commands in Telegram to build the catalog:

- `/addphoto <stars> <title>`
- `/addvideo <stars> <title>`
- `/items`
- `/publish <id>`

At this point you already have a working paid media bot with Telegram Stars.

## Payments

### Telegram Stars

The bot supports Telegram Stars as the native payment method for paid content inside Telegram.

### Platega

Use `Platega` when you want RUB payments through SBP. The bot tracks order creation, payment status, and recent payment events.

### YooMoney

Use `YooMoney` when you want a direct RUB payment page and webhook-based confirmation.

The project already includes:

- webhook host, port, and path settings
- callback and success URLs
- notification secret validation
- YooMoney mini-check in LuCI
- optional reverse SSH tunnel for routers behind NAT or without a public incoming port

## LuCI highlights

The LuCI page is built to answer the important questions fast:

- Is the bot running right now?
- Is autostart enabled?
- How many catalog items and admins are configured?
- How many Stars, SBP, and YooMoney purchases have happened?
- What was the last payment event?
- Why did the service restart?
- Is YooMoney secret/webhook/reverse tunnel healthy?

This is the part that makes the project feel operational, not just installable.

## Bot admin commands

Main admin commands currently available:

- `/postphoto <stars> <title>`
- `/postvideo <stars> <title>`
- `/addphoto <stars> <title>`
- `/addvideo <stars> <title>`
- `/items`
- `/publish <id>`
- `/setprice <id> <stars>`
- `/setrubprice <id> <rubles>`
- `/settitle <id> <title>`
- `/setcaption <id> <text>`
- `/delete <id>`
- `/sales`
- `/orders`
- `/buyyoomoney <id>`
- `/balance`
- `/transactions [count]`
- `/withdraw`

## Project structure

```text
luci-app-tg-paidmedia/
|-- README.md
|-- assets/
|   `-- bot-home-header.jpg
|-- openwrt/
|   |-- install.sh
|   `-- uninstall.sh
|-- luci-app-tg-paidmedia/
|   |-- Makefile
|   |-- htdocs/luci-static/resources/view/tg-paidmedia/
|   |   `-- overview.js
|   `-- root/usr/share/
|       |-- luci/menu.d/luci-app-tg-paidmedia.json
|       `-- rpcd/acl.d/luci-app-tg-paidmedia.json
`-- tg-paidmedia-bot/
    |-- Makefile
    `-- files/
        |-- etc/
        |   |-- config/tg-paidmedia
        |   |-- init.d/tg-paidmedia
        |   `-- tg-paidmedia/catalog.json
        `-- usr/libexec/tg-paidmedia/
            |-- bot.py
            `-- yoomoney-tunnel.sh
```

## Who this is for

- Creators who want to sell private photo or video content in Telegram.
- OpenWrt users who prefer self-hosted services over third-party dashboards.
- Router and homelab owners who want payment-aware Telegram automation.
- People who need a practical way to expose YooMoney webhook handling from a NATed setup.

## Remove

If you need to fully uninstall the project:

```sh
wget -qO- "https://raw.githubusercontent.com/kzolotarev95/luci-app-tg-paidmedia/main/openwrt/uninstall.sh?v=$(date +%s)" | sh
```

## License

MIT
