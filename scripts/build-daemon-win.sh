#!/usr/bin/env sh
# Builds the Windows daemon and puts it where the packager expects it.
#
# Two things make this its own script rather than a line in package.json.
#
# The packager reads nobilis/target/release/nobilis.exe, but a cross-build
# writes to nobilis/target/x86_64-pc-windows-gnu/release/. Nothing connects
# those, so `pack:win` would happily bundle whatever .exe happened to be at the
# first path - which, on a machine that has been cross-building for days, is
# something old. That is the same shape of bug as an AppImage shipping a stale
# daemon, and it is worse here: it only shows up as "unknown method" on
# somebody else's computer.
#
# And it has to be a cargo that works, which is not the same as the one named
# `cargo` - see find-cargo.sh.
set -eu

TARGET=x86_64-pc-windows-gnu
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$SRC_DIR/nobilis/Cargo.toml"

. "$SRC_DIR/scripts/find-cargo.sh"

echo "building the Windows daemon with $CARGO"
"$CARGO" build --release --target "$TARGET" --manifest-path "$MANIFEST"

BUILT="$SRC_DIR/nobilis/target/$TARGET/release/nobilis.exe"
WANTED="$SRC_DIR/nobilis/target/release/nobilis.exe"

# Not merely "did cargo exit 0": a build that fails after having produced an
# executable once leaves the old one in place, and copying that forward is how
# a stale daemon gets shipped.
[ -f "$BUILT" ] || { echo "no $BUILT - the build did not produce one" >&2; exit 1; }

mkdir -p "$(dirname "$WANTED")"
cp -f "$BUILT" "$WANTED"
echo "daemon    -> $WANTED"
