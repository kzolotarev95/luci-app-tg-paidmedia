include $(TOPDIR)/rules.mk

PKG_LICENSE:=MIT
PKG_MAINTAINER:=Codex
LUCI_TITLE:=LuCI support for Telegram Paid Media bot
LUCI_DEPENDS:=+tg-paidmedia-bot +rpcd-mod-file
LUCI_PKGARCH:=all

ifneq ($(wildcard $(TOPDIR)/feeds/luci/luci.mk),)
  include $(TOPDIR)/feeds/luci/luci.mk
else
  include ../../luci/luci.mk
endif

# call BuildPackage - OpenWrt buildroot signature
