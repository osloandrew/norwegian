#!/bin/bash
# Re-encode every .m4a under the given directories to AAC-LC, mono, native sample rate, 64kbps.
# Skips files already at or below the target bitrate (idempotent / safe to re-run).
#
# Usage: scripts/shrink-audio.sh <dir> [<dir> ...]
# Typical use: point it at ~/Downloads right after running the "Norwegian - multiple M/F"
# Shortcut, before moving the new .m4a files into Resources/Words or Resources/Sentences.
set -uo pipefail

TARGET_BPS=64000
SKIP_THRESHOLD=75000   # allow mux/encoder overhead on very short clips

# Recent macOS versions can list the m4a container in afconvert while exposing no
# AAC encoder for it. Prefer FFmpeg when available, including Krita's bundled copy.
if command -v ffmpeg >/dev/null 2>&1; then
  FFMPEG=$(command -v ffmpeg)
elif [[ -x /Applications/krita.app/Contents/MacOS/ffmpeg ]]; then
  FFMPEG=/Applications/krita.app/Contents/MacOS/ffmpeg
else
  echo "ERROR: No usable FFmpeg binary found." >&2
  exit 1
fi

process_one() {
  f="$1"
  br=$(/usr/bin/afinfo "$f" 2>/dev/null | awk -F': ' '/bit rate/ {print $2}' | awk '{print $1}')
  if [[ -n "$br" && "$br" -le "$SKIP_THRESHOLD" ]]; then
    echo "SKIP already-small: $f ($br bps)"
    return 0
  fi
  tmp="${f%.m4a}.__shrink_tmp__.m4a"
  err="/tmp/shrink_err_${BASHPID:-$$}"
  if "$FFMPEG" -hide_banner -loglevel error -y -i "$f" -vn -map_metadata 0 \
      -ac 1 -c:a aac -profile:a aac_low -b:a "$TARGET_BPS" "$tmp" 2>"$err"; then
    mv -f "$tmp" "$f"
    echo "OK: $f"
  else
    echo "FAIL: $f -- $(cat "$err")"
    rm -f "$tmp"
  fi
  rm -f "$err"
}
export -f process_one
export TARGET_BPS SKIP_THRESHOLD FFMPEG

for dir in "$@"; do
  echo "=== Processing $dir ==="
  find "$dir" -iname "*.m4a" ! -name '*.__shrink_tmp__.m4a' -print0 \
    | xargs -0 -P8 -n1 bash -c 'process_one "$1"' _
done
