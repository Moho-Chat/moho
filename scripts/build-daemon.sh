#!/usr/bin/env sh
# Builds the daemon for this machine, with a cargo that works.
#
# See find-cargo.sh for why "run cargo" is not as simple as it sounds when the
# caller is an npm script.
set -eu

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "$SRC_DIR/scripts/find-cargo.sh"

echo "building the daemon with $CARGO"
# Whether this is a release build, decided by moho's checkout - the
# submodule's own cannot tell (in CI it is a bare commit, on no branch). The
# daemon then reports its version, or "development".
NOBILIS_CHANNEL="$(node "$SRC_DIR/scripts/version-label.mjs" --channel)"
export NOBILIS_CHANNEL
# From inside nobilis/: cargo reads .cargo/config.toml from the directory it
# runs in, not from the manifest's, and nobilis's names the version a bundled
# libopus reports (#251).
cd "$SRC_DIR/nobilis"
# --locked: build exactly what Cargo.lock names, and fail rather than quietly
# re-resolve and rewrite it when Cargo.toml and the lockfile disagree.
"$CARGO" build --release --locked --manifest-path "$SRC_DIR/nobilis/Cargo.toml"

# A bundled libopus built before .cargo/config.toml named its version still
# says "unknown", and its build script does not rerun for that setting - so a
# kept target directory (here, or CI's cache) would ship "unknown" for good.
# Only that crate is built again, and only when it happened. A daemon linked
# to the system's libopus does not contain the string at all.
if grep -aq 'libopus unknown' "$SRC_DIR/nobilis/target/release/nobilis"; then
  echo "the bundled libopus does not know its version - building it again"
  "$CARGO" clean --release -p libopus_sys --manifest-path "$SRC_DIR/nobilis/Cargo.toml"
  "$CARGO" build --release --locked --manifest-path "$SRC_DIR/nobilis/Cargo.toml"
fi
