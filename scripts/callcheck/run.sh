#!/usr/bin/env bash
# Two ends of a real call in one page, wired to each other.
#
# The claim this checks is the one that cannot be checked by reading: that a
# camera turned on in a call already running reaches the other end, and that
# turning it off takes it away rather than freezing it. That is an offer, an
# answer, a renegotiation each way and a track arriving on a stream somebody
# else owns - four things no unit test touches, and the renderer has no test
# runner of its own (see #212).
#
# Real RTCPeerConnections over loopback, with a canvas standing in for the
# camera and an oscillator for the microphone, so it needs no hardware and no
# second person. Open the printed URL and read the verdict; the page title
# carries it too.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="${TMPDIR:-/tmp}/moho-callcheck"
mkdir -p "$out"

"$root/node_modules/.bin/esbuild" "$here/loopback.ts" \
  --bundle --format=iife --outfile="$out/harness.js" --log-level=warning

cat > "$out/index.html" <<'HTML'
<!doctype html>
<meta charset="utf-8">
<title>callcheck</title>
<body style="background:#111;color:#ddd;font:13px ui-monospace,monospace;padding:12px">
<pre id="log">starting…</pre>
<script src="harness.js"></script>
HTML

echo "serving $out on http://localhost:8791 - ctrl-c when done"
cd "$out" && exec python3 -m http.server 8791
