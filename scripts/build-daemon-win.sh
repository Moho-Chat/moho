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
# Whether this is a release build, decided by moho's checkout - the
# submodule's own cannot tell (in CI it is a bare commit, on no branch). The
# daemon then reports its version, or "development".
NOBILIS_CHANNEL="$(node "$SRC_DIR/scripts/version-label.mjs" --channel)"
export NOBILIS_CHANNEL
# CMake's view of the MinGW target, for every crate built with it: compilers, and BoringSSL (Signal's number lookup)
# built without its assembly, which is ELF/Mach-O only and fails to link for MinGW. See the file.
CMAKE_TOOLCHAIN_FILE_x86_64_pc_windows_gnu="$SRC_DIR/nobilis/cmake/x86_64-w64-mingw32.cmake"
export CMAKE_TOOLCHAIN_FILE_x86_64_pc_windows_gnu
# BoringSSL is C++, and boring-sys links the C++ runtime as plain `stdc++` on any gnu target - for MinGW that is
# libstdc++-6.dll, which no Windows machine has and the installer does not ship. 1.5.2 went out like that: Windows
# refused to start the daemon (no window, so no "DLL not found" box either) and moho sat "disconnected". Static instead.
BORING_BSSL_RUST_CPPLIB=static=stdc++
export BORING_BSSL_RUST_CPPLIB
# rustc does not search the cross compiler's library directory for a static library, so name it; asked of g++ itself,
# because Arch and Ubuntu keep libstdc++.a in different places.
MINGW_CXX_LIBDIR="$(dirname "$(x86_64-w64-mingw32-g++ -print-file-name=libstdc++.a)")"
CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS="-L native=$MINGW_CXX_LIBDIR"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS
# From inside nobilis/, for its .cargo/config.toml - see build-daemon.sh.
cd "$SRC_DIR/nobilis"
# --locked: see build-daemon.sh.
"$CARGO" build --release --locked --target "$TARGET" --manifest-path "$MANIFEST"

BUILT="$SRC_DIR/nobilis/target/$TARGET/release/nobilis.exe"

# The Windows build always bundles libopus; see build-daemon.sh for why a kept
# target directory can leave it calling itself "unknown".
if [ -f "$BUILT" ] && grep -aq 'libopus unknown' "$BUILT"; then
  echo "the bundled libopus does not know its version - building it again"
  "$CARGO" clean --release --target "$TARGET" -p libopus_sys --manifest-path "$MANIFEST"
  "$CARGO" build --release --locked --target "$TARGET" --manifest-path "$MANIFEST"
fi
WANTED="$SRC_DIR/nobilis/target/release/nobilis.exe"

# Not merely "did cargo exit 0": a build that fails after having produced an
# executable once leaves the old one in place, and copying that forward is how
# a stale daemon gets shipped.
[ -f "$BUILT" ] || { echo "no $BUILT - the build did not produce one" >&2; exit 1; }

# And nothing it imports may be a MinGW runtime DLL. A machine with MinGW on PATH (a developer's, the test VM's)
# finds them and runs fine; anybody else's cannot start the daemon at all, and says nothing about why.
MINGW_DLLS="$(x86_64-w64-mingw32-objdump -p "$BUILT" | grep -i 'DLL Name' | grep -iE 'libstdc\+\+|libgcc_s|libwinpthread' || true)"
if [ -n "$MINGW_DLLS" ]; then
  echo "$BUILT needs MinGW runtime DLLs no Windows machine has:" >&2
  echo "$MINGW_DLLS" >&2
  exit 1
fi

mkdir -p "$(dirname "$WANTED")"
cp -f "$BUILT" "$WANTED"
echo "daemon    -> $WANTED"
