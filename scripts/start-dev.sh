#!/bin/bash
# Starts local dev (app server + Firestore emulator) — see `npm run dev`.
# Exists as its own file so a double-click, a Shortcuts button, a Dock icon,
# etc. can launch it without anyone needing to remember the npm command or
# the repo's path.
cd "$(dirname "$0")/.." || exit 1

npm run dev &
dev_pid=$!

# Poll instead of a fixed sleep — the server binds almost immediately, but
# opening the tab before it does just shows a connection-refused page.
for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://localhost:8935/" && break
  sleep 0.5
done

# The emulator has no persistence between runs, so if a production data
# export is waiting (see scripts/debug-export-bookmarklet.js), pull it in on
# every start rather than treating it as a one-time setup step — otherwise
# every restart would silently go back to an empty account. `ls -t` + take
# the newest match handles a repeat export landing as "... (1).json" rather
# than overwriting, which is how browsers actually behave; `mv` (not `cp`)
# consumes it so a stale copy can't get re-imported next time by mistake.
export_src=$(ls -t "$HOME/Downloads"/my-words-debug-export*.json 2>/dev/null | head -1)
if [ -n "$export_src" ]; then
  mv "$export_src" ./my-words-debug-export.json
  echo "Found a production data export ($(basename "$export_src")) — importing it."
  open "http://localhost:8935/scripts/debug-import.html"
else
  open "http://localhost:8935/"
fi

# Keeps this script (and the Terminal tab running it) attached to npm run
# dev, so Ctrl+C here still reaches it instead of leaving it orphaned.
wait "$dev_pid"
