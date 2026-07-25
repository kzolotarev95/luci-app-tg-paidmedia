include $(TOPDIR)/rules.mk

PKG_NAME:=tg-paidmedia-bot
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=Codex
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/tg-paidmedia-bot
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Telephony
  TITLE:=Telegram Paid Media bot with Telegram Stars support
  DEPENDS:=+python3 +ca-bundle
endef

define Package/tg-paidmedia-bot/description
Telegram bot for selling photo and video content through Paid Media,
accepting Telegram Stars, and running as an OpenWrt service.
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/tg-paidmedia-bot/install
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/tg-paidmedia $(1)/etc/config/tg-paidmedia

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/tg-paidmedia $(1)/etc/init.d/tg-paidmedia

	$(INSTALL_DIR) $(1)/etc/tg-paidmedia
	$(INSTALL_DATA) ./files/etc/tg-paidmedia/catalog.json $(1)/etc/tg-paidmedia/catalog.json

	$(INSTALL_DIR) $(1)/usr/libexec/tg-paidmedia
	$(INSTALL_BIN) ./files/usr/libexec/tg-paidmedia/bot.py $(1)/usr/libexec/tg-paidmedia/bot.py
endef

$(eval $(call BuildPackage,tg-paidmedia-bot))
