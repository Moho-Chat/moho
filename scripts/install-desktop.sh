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

# The one built from what is checked out, by name.
#
# This used to take whichever AppImage `ls` listed first, which was right for
# exactly as long as there was only ever one of them: builds were all called
# moho-0.1.0 and overwrote each other. They are named after their commit now,
# so dist/ accumulates them and "first" became alphabetical - which installed
# a build from earlier in the day over the one just made, silently, because
# both exist and neither is wrong to `ls`.
#
# Asking for the current commit's own file instead fails loudly when the build
# did not happen, which is the failure worth having.
BUILD="$(cd "$SRC_DIR" && git rev-parse --short HEAD 2>/dev/null || true)"
DIRTY=""
if [ -n "$BUILD" ] && ! (cd "$SRC_DIR" && git diff --quiet HEAD 2>/dev/null); then
  DIRTY="-dirty"
fi
APPIMAGE=""
if [ -n "$BUILD" ] && [ -f "$SRC_DIR/dist/$APP_ID-$BUILD$DIRTY.AppImage" ]; then
  APPIMAGE="$SRC_DIR/dist/$APP_ID-$BUILD$DIRTY.AppImage"
else
  # No git, or a build whose name does not match the checkout: newest wins,
  # which is at least the one most recently made rather than the one whose
  # name happens to sort first.
  APPIMAGE="$(ls -t "$SRC_DIR"/dist/*.AppImage 2>/dev/null | head -1)"
fi

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
# What makes an irc:// link in a browser offer moho at all. Exec already takes
# %U, so the desktop has somewhere to put the URL once it decides to.
MimeType=x-scheme-handler/irc;x-scheme-handler/ircs;
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
