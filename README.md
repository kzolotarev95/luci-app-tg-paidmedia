# luci-app-tg-paidmedia

![OpenWrt](https://img.shields.io/badge/OpenWrt-22.03%20to%2025.x-00b5e2?style=for-the-badge&logo=openwrt&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram-Paid%20Media-26A5E4?style=for-the-badge&logo=telegram&logoColor=white)
![Stars](https://img.shields.io/badge/Payments-Telegram%20Stars-f5c542?style=for-the-badge)
![LuCI](https://img.shields.io/badge/LuCI-Web%20Panel-2f855a?style=for-the-badge)

Готовый OpenWrt feed с Telegram-ботом для продажи фото и видео через `Paid Media`, приемом `Telegram Stars` и мини-панелью в `LuCI` для запуска, перезапуска, просмотра статуса и логов.

Проект состоит из двух пакетов:

- `tg-paidmedia-bot` - сам Telegram-бот и `procd`-сервис.
- `luci-app-tg-paidmedia` - веб-панель в LuCI для управления ботом.

## Что умеет

- продавать фото через `sendPaidMedia`
- продавать видео через `sendPaidMedia`
- принимать оплату в `Telegram Stars`
- показывать официальный Telegram-экран подтверждения покупки
- хранить простой каталог товаров
- давать админ-команды для загрузки контента и управления ценой
- запускаться как сервис OpenWrt через `procd`
- показывать статус, логи и кнопки управления в LuCI

## Для чего это

Если нужен бот, который продает медиаконтент прямо в Telegram без внешнего сайта и отдельной платежки, то эта заготовка закрывает базовый сценарий:

- пользователь открывает каталог
- выбирает товар
- Telegram показывает встроенное окно покупки за Stars
- после успешной оплаты бот отправляет платный медиаконтент
- админ управляет ботом через команды и LuCI-панель на роутере

## Состав репозитория

- [tg-paidmedia-bot/Makefile](C:/Users/k.zolotarev95/Documents/luci-app-tg-paidmedia/tg-paidmedia-bot/Makefile)
- [tg-paidmedia-bot/files/etc/config/tg-paidmedia](C:/Users/k.zolotarev95/Documents/luci-app-tg-paidmedia/tg-paidmedia-bot/files/etc/config/tg-paidmedia)
- [tg-paidmedia-bot/files/etc/init.d/tg-paidmedia](C:/Users/k.zolotarev95/Documents/luci-app-tg-paidmedia/tg-paidmedia-bot/files/etc/init.d/tg-paidmedia)
- [tg-paidmedia-bot/files/usr/libexec/tg-paidmedia/bot.py](C:/Users/k.zolotarev95/Documents/luci-app-tg-paidmedia/tg-paidmedia-bot/files/usr/libexec/tg-paidmedia/bot.py)
- [luci-app-tg-paidmedia/Makefile](C:/Users/k.zolotarev95/Documents/luci-app-tg-paidmedia/luci-app-tg-paidmedia/Makefile)
- [luci-app-tg-paidmedia/htdocs/luci-static/resources/view/tg-paidmedia/overview.js](C:/Users/k.zolotarev95/Documents/luci-app-tg-paidmedia/luci-app-tg-paidmedia/htdocs/luci-static/resources/view/tg-paidmedia/overview.js)

## Быстрый старт

### 1. Подключить feed в сборке OpenWrt

```sh
echo "src-link tg_paidmedia /path/to/luci-app-tg-paidmedia" >> feeds.conf.default
./scripts/feeds update -a
./scripts/feeds install tg-paidmedia-bot
./scripts/feeds install luci-app-tg-paidmedia
```

### 2. Выбрать пакеты в `menuconfig`

```sh
make menuconfig
```

Выбрать:

- `Network -> Telephony -> tg-paidmedia-bot`
- `LuCI -> Applications -> luci-app-tg-paidmedia`

### 3. Собрать прошивку или пакеты

```sh
make package/tg-paidmedia-bot/compile V=s
make package/luci-app-tg-paidmedia/compile V=s
```

### 4. Настроить бота на роутере

Пример UCI-конфига:

```sh
uci set tg-paidmedia.main.enabled='1'
uci set tg-paidmedia.main.token='123456:telegram_bot_token'
uci add_list tg-paidmedia.main.admin_ids='123456789'
uci set tg-paidmedia.main.bot_title='Paid Media Shop'
uci set tg-paidmedia.main.welcome_text='Choose an item below and Telegram will show the official Stars purchase confirmation window.'
uci commit tg-paidmedia
/etc/init.d/tg-paidmedia enable
/etc/init.d/tg-paidmedia start
```

### 5. Открыть LuCI-панель

После установки в LuCI появится страница управления ботом:

`Services -> Telegram Paid Media`

Там можно:

- проверить, запущен ли сервис
- перезапустить бота
- остановить и снова запустить сервис
- посмотреть последние логи

## Админ-команды бота

| Команда | Что делает |
| --- | --- |
| `/start` | Показать приветствие и каталог |
| `/catalog` | Снова показать каталог |
| `/buy <id>` | Открыть покупку конкретного товара |
| `/admin` | Показать список админ-команд |
| `/addphoto <stars> <title>` | Перейти в режим ожидания следующего фото |
| `/addvideo <stars> <title>` | Перейти в режим ожидания следующего видео |
| `/setprice <id> <stars>` | Изменить цену товара |
| `/settitle <id> <title>` | Изменить название товара |
| `/setcaption <id> <caption>` | Изменить подпись к контенту |
| `/delete <id>` | Удалить товар из каталога |
| `/publish <id>` | Опубликовать платный медиапост в текущем чате |
| `/balance` | Показать текущий баланс Stars |
| `/transactions [count]` | Показать последние транзакции |
| `/withdraw` | Пояснить текущий статус по выводу средств |
| `/cancel` | Отменить режим ожидания загрузки |

## Как выглядит рабочий сценарий

1. Админ пишет `/addphoto 50 Premium shot`.
2. Бот переходит в режим ожидания фото.
3. Админ отправляет фотографию.
4. Контент попадает в каталог с ценой `50 Stars`.
5. Пользователь открывает `/catalog` или `/start`.
6. Пользователь нажимает покупку или вызывает `/buy <id>`.
7. Telegram показывает штатное окно оплаты через Stars.
8. После оплаты бот отдает купленный медиаконтент.

## LuCI-панель

Веб-интерфейс сделан как легкая мини-панель для OpenWrt:

- статус сервиса
- быстрые кнопки `Start`, `Stop`, `Restart`
- чтение логов через LuCI
- вывод текущей конфигурации и путей

Это удобно, если бот крутится прямо на роутере и нужно быстро перезапустить его без SSH.

## Ограничение по выводу Stars

Важно: проект умеет принимать `Telegram Stars`, читать баланс и историю транзакций, но не обещает полностью автоматический unattended-вывод средств наружу.

Причина простая: обычный Bot API дает доступ к операциям и балансу, но финальный флоу вывода зависит от внешней инфраструктуры Telegram и не сводится к простому `bot token -> auto payout`.

Поэтому в текущем состоянии проект:

- принимает Stars
- показывает доход и транзакции
- хранит данные о продажах
- напоминает админу про ограничение вывода

## Совместимость

Проект ориентирован на OpenWrt:

- `22.03`
- `23.05`
- `24.x`
- `25.x`

Если в конкретной ветке OpenWrt меняются зависимости LuCI или структура feed, может понадобиться небольшая адаптация `Makefile` или зависимостей пакета.

## Полезные пути на устройстве

```text
/etc/config/tg-paidmedia
/etc/init.d/tg-paidmedia
/etc/tg-paidmedia/catalog.json
/usr/libexec/tg-paidmedia/bot.py
/var/lib/tg-paidmedia/state.json
/var/run/tg-paidmedia/status.json
```

## Проверка после установки

```sh
/etc/init.d/tg-paidmedia status
logread -e tg-paidmedia
uci show tg-paidmedia
```

## Идеи для следующего этапа

- загрузка контента прямо из LuCI, а не только через команды бота
- импорт каталога из JSON или CSV
- предпросмотр карточек товаров
- фильтры и категории
- отдельная статистика по продажам
- резервное копирование каталога

## Лицензия

`MIT`
