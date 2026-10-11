#!/usr/bin/env bash
# Makes nobilis's release of the same version as one of moho's.
#
# Run by the maintainer once the release workflow has published moho's tag:
# the daemon is its own repository with its own releases, and the job that
# builds it holds a token that can only release moho.
#
#   scripts/release-nobilis.sh v1.0.0
#   scripts/release-nobilis.sh v1.0.0 --keep DIR    leave the notes and the two
#                                                   daemon binaries in DIR
#
# nobilis is tagged at the commit moho's tag points to, named after the same
# version, its notes the version's major features and the nobilis lines of the
# changelog, with the two daemon binaries the release's run built. Safe to run
# again: a release that exists is updated rather than repeated.
set -euo pipefail

TAG="${1:?usage: scripts/release-nobilis.sh vX.Y.Z [--keep DIR]}"
KEEP=""
[ "${2:-}" = "--keep" ] && KEEP="${3:?--keep needs a directory}"
VERSION="${TAG#v}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

read -r PRE < <(gh release view "$TAG" --repo Moho-Chat/moho --json isPrerelease -q .isPrerelease)

NOBILIS_SHA="$(git -C "$ROOT" rev-parse "$TAG:nobilis")"
echo "nobilis $TAG at ${NOBILIS_SHA:0:7}"
if ! git -C "$ROOT/nobilis" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  git -C "$ROOT/nobilis" tag -a "$TAG" "$NOBILIS_SHA" -m "nobilis $VERSION"
fi
git -C "$ROOT/nobilis" push -q github "refs/tags/$TAG"

# Its notes: the version's major features, and the nobilis lines only.
SECTION="$VERSION"
grep -q "^## \[$VERSION\]" "$ROOT/CHANGELOG.md" || SECTION="${VERSION%%-*}"
awk -v v="$SECTION" '
  index($0, "## [" v "]") == 1 { on = 1; next }
  on && /^## \[/ { exit }
  !on { next }
  /^### / { fixes = ($0 ~ /^### Fixes/); print; next }
  /^- / { if (!fixes || /\[nobilis /) print; next }
  { print }
' "$ROOT/CHANGELOG.md" > "$WORK/nobilis-notes.md"
printf '\nnobilis is the daemon inside moho %s; these are its own builds, for running it on its own.\n' "$VERSION" >> "$WORK/nobilis-notes.md"

# The daemon binaries, from the run that built this release.
RUN="$(gh run list --repo Moho-Chat/moho --workflow release.yml --branch "$TAG" --status success --limit 1 --json databaseId -q '.[0].databaseId')"
[ -n "$RUN" ] || { echo "no successful release run for $TAG" >&2; exit 1; }
mkdir -p "$WORK/nobilis"
gh run download "$RUN" --repo Moho-Chat/moho -n daemon-linux -D "$WORK/d-linux"
gh run download "$RUN" --repo Moho-Chat/moho -n daemon-windows -D "$WORK/d-win"
install -m 755 "$WORK/d-linux/nobilis" "$WORK/nobilis/nobilis-$VERSION-linux-x86_64"
install -m 644 "$WORK/d-win/nobilis.exe" "$WORK/nobilis/nobilis-$VERSION-windows-x86_64.exe"

NOBILIS_FLAGS=(--latest)
[ "$PRE" = "true" ] && NOBILIS_FLAGS=(--prerelease --latest=false)
if gh release view "$TAG" --repo Moho-Chat/nobilis >/dev/null 2>&1; then
  gh release edit "$TAG" --repo Moho-Chat/nobilis --notes-file "$WORK/nobilis-notes.md"
  gh release upload "$TAG" --repo Moho-Chat/nobilis "$WORK"/nobilis/* --clobber
else
  gh release create "$TAG" --repo Moho-Chat/nobilis --verify-tag --title "nobilis $VERSION" \
    --notes-file "$WORK/nobilis-notes.md" "${NOBILIS_FLAGS[@]}" "$WORK"/nobilis/*
fi
echo "  GitHub Moho-Chat/nobilis $TAG"
if [ -n "$KEEP" ]; then
  mkdir -p "$KEEP"
  cp "$WORK/nobilis-notes.md" "$KEEP/"
  cp -r "$WORK/nobilis" "$KEEP/"
fi
