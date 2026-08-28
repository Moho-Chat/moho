#!/usr/bin/env sh
# Puts the built AppImage where the desktop can find it, with a launcher entry
# and icons.
#
# Separate from packaging because building and installing are different acts -
# but paired with it in `npm run deploy`, because the gap between them is where
# a stale copy lives. An AppImage sitting in dist/ while an older one runs from
# ~/.local/bin is exactly the kind of confusion that costs an evening.
set -eu

APP_ID=moho
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APPIMAGE="$(ls "$SRC_DIR"/dist/*.AppImage 2>/dev/null | head -1)"

BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"

if [ -z "$APPIMAGE" ]; then
  echo "no AppImage in $SRC_DIR/dist - run 'npm run pack' first" >&2
  exit 1
fi

install -Dm755 "$APPIMAGE" "$BIN_DIR/$APP_ID.AppImage"

# Every size the panel, launcher and window switcher might ask for. Scaling one
# 512px icon down at display time is blurrier than shipping the sizes.
for size in 16 24 32 48 64 96 128 256 512; do
  target="$ICON_ROOT/${size}x${size}/apps/$APP_ID.png"
  mkdir -p "$(dirname "$target")"
  if command -v magick >/dev/null 2>&1; then
    magick "$SRC_DIR/resources/icons/$APP_ID.png" -resize "${size}x${size}" "$target"
  else
    install -Dm644 "$SRC_DIR/resources/icons/$APP_ID.png" "$target"
  fi
done

mkdir -p "$APPS_DIR"
cat > "$APPS_DIR/$APP_ID.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=moho
GenericName=Chat Client
Comment=IRC, Discord, Matrix and Sneedchat in one client
Exec=$BIN_DIR/$APP_ID.AppImage %U
Icon=$APP_ID
Terminal=false
Categories=Network;InstantMessaging;Chat;
Keywords=chat;irc;discord;matrix;sneedchat;messaging;
StartupWMClass=moho
StartupNotify=true
SingleMainWindow=true
EOF
chmod 644 "$APPS_DIR/$APP_ID.desktop"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$ICON_ROOT" >/dev/null 2>&1 || true

echo "installed $(basename "$APPIMAGE") -> $BIN_DIR/$APP_ID.AppImage"
echo "launcher  -> $APPS_DIR/$APP_ID.desktop"
