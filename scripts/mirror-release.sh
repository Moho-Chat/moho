#!/usr/bin/env bash
# Mirrors a published GitHub release of moho to Gitea, and makes nobilis's
# release of the same version on both hosts. Run here, by hand, once the
# release workflow has published the tag on GitHub - Gitea releases are never
# made by Actions.
#
#   scripts/mirror-release.sh v1.0.0
#
# moho on Gitea: the same title, notes, pre-release flag and files as GitHub.
# nobilis, on GitHub and Gitea: tagged at the commit moho's tag points to,
# named after the same version, its notes the version's major features and
# the nobilis lines of the changelog, with the two daemon binaries the
# release's run built.
#
# Safe to run again: a release that exists is updated rather than repeated.
set -euo pipefail

TAG="${1:?usage: scripts/mirror-release.sh vX.Y.Z}"
VERSION="${TAG#v}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GITEA="https://git.salastil.com/api/v1"
TOKEN="$(cat "$HOME/.config/gitea/token")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

gitea() { # method path [curl args...]
  local method="$1" path="$2"; shift 2
  curl -fsS -X "$method" -H "Authorization: token $TOKEN" "$GITEA$path" "$@"
}

# Creates or updates a Gitea release and makes its files exactly those given.
gitea_release() { # repo title notes-file prerelease file...
  local repo="$1" title="$2" notes="$3" pre="$4"; shift 4
  local body id
  body="$(python3 -c 'import json,sys; print(json.dumps({"tag_name": sys.argv[1], "name": sys.argv[2], "body": open(sys.argv[3]).read(), "prerelease": sys.argv[4] == "true"}))' "$TAG" "$title" "$notes" "$pre")"
  if id="$(gitea GET "/repos/$repo/releases/tags/$TAG" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"; then
    gitea PATCH "/repos/$repo/releases/$id" -H 'Content-Type: application/json' -d "$body" >/dev/null
    for asset in $(gitea GET "/repos/$repo/releases/$id/assets" | python3 -c 'import json,sys; print(" ".join(str(a["id"]) for a in json.load(sys.stdin)))'); do
      gitea DELETE "/repos/$repo/releases/$id/assets/$asset" >/dev/null
    done
  else
    id="$(gitea POST "/repos/$repo/releases" -H 'Content-Type: application/json' -d "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
  fi
  for f in "$@"; do
    gitea POST "/repos/$repo/releases/$id/assets?name=$(basename "$f")" -F "attachment=@$f" >/dev/null
    echo "  uploaded $(basename "$f") -> Gitea $repo"
  done
}

# --- moho -------------------------------------------------------------------
echo "moho $TAG: GitHub -> Gitea"
read -r PRE TITLE < <(gh release view "$TAG" --repo Moho-Chat/moho --json isPrerelease,name -q '"\(.isPrerelease) \(.name)"')
gh release view "$TAG" --repo Moho-Chat/moho --json body -q .body > "$WORK/moho-notes.md"
mkdir -p "$WORK/moho"
gh release download "$TAG" --repo Moho-Chat/moho --dir "$WORK/moho"
git -C "$ROOT" push -q origin "refs/tags/$TAG" 2>/dev/null || true
gitea_release Salastil/moho "$TITLE" "$WORK/moho-notes.md" "$PRE" "$WORK"/moho/*

# --- nobilis ------------------------------------------------------------------
NOBILIS_SHA="$(git -C "$ROOT" rev-parse "$TAG:nobilis")"
echo "nobilis $TAG at ${NOBILIS_SHA:0:7}"
if ! git -C "$ROOT/nobilis" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  git -C "$ROOT/nobilis" tag -a "$TAG" "$NOBILIS_SHA" -m "nobilis $VERSION"
fi
git -C "$ROOT/nobilis" push -q github "refs/tags/$TAG"
git -C "$ROOT/nobilis" push -q origin "refs/tags/$TAG"

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
gitea_release Salastil/nobilis "nobilis $VERSION" "$WORK/nobilis-notes.md" "$PRE" "$WORK"/nobilis/*
echo "done: moho and nobilis $TAG on GitHub and Gitea"
