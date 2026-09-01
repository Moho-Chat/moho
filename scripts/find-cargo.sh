# Picks a cargo that actually runs. Sourced, not executed.
#
# `cargo` on PATH is not enough, and the failure is a confusing one.
#
# rustup installs a shim rather than a compiler, and the shim finds the real
# toolchain through CARGO_HOME and RUSTUP_HOME. On a machine using the XDG
# layout those live under ~/.local/share rather than ~/.cargo and ~/.rustup, so
# they are named by environment variables set in a login shell - which an npm
# script does not get. The shim then fails with "rustup could not choose a
# version of cargo to run", which reads like rust is missing rather than like
# it was asked in the wrong place.
#
# A distribution's own /usr/bin/cargo is a real compiler and does run, so it
# looks like the answer, and for a native build it is. It is also the wrong
# one: it carries no cross-compilation targets, and a Windows build through it
# fails with "can't find crate for `core`" - which in turn reads like a broken
# checkout. The two wrong answers point at each other.
#
# So: fill in the XDG locations if nothing else has, prefer rustup's shim
# because that is the toolchain with the targets, and fall back to whatever
# else answers `--version`.

# Only as a default. Anything already set is somebody's deliberate choice, and
# a machine using the traditional ~/.cargo layout needs no help.
[ -n "${CARGO_HOME:-}" ] || { [ -d "$HOME/.local/share/cargo" ] && CARGO_HOME="$HOME/.local/share/cargo"; }
[ -n "${RUSTUP_HOME:-}" ] || { [ -d "$HOME/.local/share/rustup" ] && RUSTUP_HOME="$HOME/.local/share/rustup"; }
[ -n "${CARGO_HOME:-}" ] && export CARGO_HOME
[ -n "${RUSTUP_HOME:-}" ] && export RUSTUP_HOME

if [ -z "${CARGO:-}" ]; then
  for candidate in \
    "${CARGO_HOME:-$HOME/.cargo}/bin/cargo" \
    "$HOME/.cargo/bin/cargo" \
    "$(command -v cargo 2>/dev/null || true)" \
    /usr/bin/cargo
  do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    # Asked rather than assumed: this is the one check that tells a working
    # toolchain from a shim that cannot find one.
    if "$candidate" --version >/dev/null 2>&1; then
      CARGO="$candidate"
      break
    fi
  done
fi

if [ -z "${CARGO:-}" ] || ! "$CARGO" --version >/dev/null 2>&1; then
  echo "no working cargo found - set CARGO to one, or install rust" >&2
  exit 1
fi

# Its own directory first, so the rustc it shells out to is the one that
# belongs with it.
PATH="$(dirname "$CARGO"):$PATH"
export PATH CARGO
