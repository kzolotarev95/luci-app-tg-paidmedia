# tg-paidmedia for OpenWrt

OpenWrt feed with two packages:

- `tg-paidmedia-bot` - Telegram bot for selling photos and videos through `sendPaidMedia`, receiving Telegram Stars, and managing a simple catalog through admin commands.
- `luci-app-tg-paidmedia` - LuCI page for configuring the bot, starting or restarting the service, and reading logs.

## What is implemented

- Paid photo and video sales through Telegram `sendPaidMedia`
- Payments in Telegram Stars
- Admin commands for adding media, setting prices, and browsing Star transactions
- OpenWrt `procd` service with UCI configuration
- LuCI mini panel with service status, restart buttons, and log viewer

## Important limitation

The bot can read Star balance and Star transactions through the Bot API, but this feed does **not** implement fully automatic withdrawal to Fragment or TON. The public Bot API exposes balance and transaction history, while withdrawal flows are handled outside a plain bot token workflow. The bot therefore tracks revenue and reminds the admin, but does not promise unattended payout automation.

## Package layout

- [tg-paidmedia-bot/Makefile](C:/Users/k.zolotarev95/Documents/luci-app-tg-paidmedia/tg-paidmedia-bot/Makefile)
- [luci-app-tg-paidmedia/Makefile](C:/Users/k.zolotarev95/Documents/luci-app-tg-paidmedia/luci-app-tg-paidmedia/Makefile)

## Admin bot commands

- `/start` - show catalog
- `/catalog` - show catalog again
- `/buy <id>` - send a paid media purchase message
- `/admin` - show admin help
- `/addphoto <stars> <title>` - wait for the next photo from admin
- `/addvideo <stars> <title>` - wait for the next video from admin
- `/setprice <id> <stars>` - change item price
- `/settitle <id> <title>` - change item title
- `/setcaption <id> <caption>` - change paid media caption
- `/delete <id>` - remove item
- `/publish <id>` - send a paid media message into the current chat
- `/balance` - current Star balance
- `/transactions [count]` - recent Star transactions
- `/withdraw` - explain current withdrawal limitation
- `/cancel` - cancel pending upload mode

## Installation idea

Add this repository as a local feed and install both packages:

```sh
./scripts/feeds update -a
./scripts/feeds install tg-paidmedia-bot
./scripts/feeds install luci-app-tg-paidmedia
make menuconfig
```
