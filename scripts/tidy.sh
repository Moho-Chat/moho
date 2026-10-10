#!/usr/bin/env sh
# Keeps a development checkout from filling the disk.
#
# Everything this removes is build output that the next build makes again, and
# none of it is the project: it is what grew to a hundred gigabytes without
# anybody choosing it.
#
# - dist/ got one AppImage per deploy and never lost one. Only the newest few
#   are kept; the installed copy lives in ~/.local/bin.
# - Cargo never removes what a build no longer uses. Every change to a
#   dependency, a feature or the compiler leaves the old build beside the new
#   one, so nobilis/target held fifty copies of each library. Past a size it
#   is emptied, and the build that follows starts it again with only what is
#   current. Run before a build, never after one: after, it would throw away
#   the thing just made.
# - Debug builds and the Windows cross-build are not what a deploy uses and
#   are made again when somebody asks for them.
#
#   scripts/tidy.sh            (also run first by `npm run deploy`)
set -eu

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KEEP_APPIMAGES="${MOHO_KEEP_APPIMAGES:-2}"
# In megabytes: a clean release build of the daemon is about two gigabytes.
TARGET_LIMIT_MB="${MOHO_TARGET_LIMIT_MB:-8000}"

size_mb() { du -sm "$1" 2>/dev/null | cut -f1; }

# What is in dist/ besides the newest AppImages: older ones, Windows and
# Debian packages, the unpacked trees and their block maps.
if [ -d "$SRC_DIR/dist" ]; then
  keep="$(ls -t "$SRC_DIR"/dist/*.AppImage 2>/dev/null | head -n "$KEEP_APPIMAGES")"
  for f in "$SRC_DIR"/dist/* "$SRC_DIR"/dist/.[!.]*; do
    [ -e "$f" ] || continue
    case "$(basename "$f")" in builder-debug.yml|builder-effective-config.yaml|latest*.yml) continue ;; esac
    printf '%s\n' "$keep" | grep -qxF "$f" && continue
    rm -rf "$f"
  done
fi

# A build directory left over from before the daemon lived in nobilis/.
rm -rf "$SRC_DIR/target"

TARGET="$SRC_DIR/nobilis/target"
if [ -d "$TARGET" ]; then
  rm -rf "$TARGET/debug" "$TARGET"/x86_64-pc-windows-* "$TARGET"/aarch64-*
  used="$(size_mb "$TARGET")"
  if [ "${used:-0}" -gt "$TARGET_LIMIT_MB" ]; then
    echo "tidy: nobilis/target is ${used} MB, over ${TARGET_LIMIT_MB} MB - emptying it; the next build starts it fresh"
    rm -rf "$TARGET"
  fi
fi
