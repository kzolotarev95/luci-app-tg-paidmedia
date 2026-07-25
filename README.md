# luci-app-tg-paidmedia

## Установка

Репозиторий:
[https://github.com/kzolotarev95/luci-app-tg-paidmedia](https://github.com/kzolotarev95/luci-app-tg-paidmedia)

Добавить feed и установить пакеты:

```sh
echo "src-git tg_paidmedia https://github.com/kzolotarev95/luci-app-tg-paidmedia.git" >> feeds.conf.default
./scripts/feeds update tg_paidmedia
./scripts/feeds install -a -p tg_paidmedia
make menuconfig
```

## Удаление

Удалить пакеты из сборки:

```sh
./scripts/feeds uninstall -a -p tg_paidmedia
```

Удалить feed:

```sh
sed -i '/tg_paidmedia/d' feeds.conf.default
rm -rf feeds/tg_paidmedia
```
