#!/usr/bin/env sh
# Builds the daemon for this machine, with a cargo that works.
#
# See find-cargo.sh for why "run cargo" is not as simple as it sounds when the
# caller is an npm script.
set -eu

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "$SRC_DIR/scripts/find-cargo.sh"

echo "building the daemon with $CARGO"
"$CARGO" build --release --manifest-path "$SRC_DIR/nobilis/Cargo.toml"
