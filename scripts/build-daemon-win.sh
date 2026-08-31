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
# And the whole toolchain has to be the one rustup manages, which means the
# PATH rather than just the name of the cargo binary: cargo runs whichever
# rustc it finds, so pointing at rustup's cargo while a distribution's rustc is
# first still fails with "can't find crate for `core`" - a message that reads
# like a broken checkout rather than the wrong compiler.
set -eu

TARGET=x86_64-pc-windows-gnu
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$SRC_DIR/nobilis/Cargo.toml"

# rustup's toolchain ahead of anything the distribution installed, so cargo and
# the rustc it shells out to agree about which targets exist.
if [ -d "$HOME/.cargo/bin" ]; then
  PATH="$HOME/.cargo/bin:$PATH"
  export PATH
fi
CARGO="${CARGO:-cargo}"

echo "building the Windows daemon with $(command -v "$CARGO")"
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
