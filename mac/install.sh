#!/bin/bash
# Cockpit: Mac-Statistik einrichten
# Aufruf: curl -fsSL https://partykellercmky.github.io/Cockpit/mac/install.sh | bash -s DEIN-SCHLUESSEL
# Legt ein kleines Skript an, das alle 15 Minuten die Nutzungszeiten aus ActivityWatch
# zusammenfasst und an Cockpit schickt. Entfernen: bash ~/.cockpit/uninstall.sh
set -e
TOKEN="$1"
if [ -z "$TOKEN" ]; then echo "Bitte den Kalender-Schluessel mit angeben."; exit 1; fi
DIR="$HOME/.cockpit"; PLIST="$HOME/Library/LaunchAgents/de.cockpit.macstats.plist"
mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
printf '%s' "$TOKEN" > "$DIR/token"; chmod 600 "$DIR/token"

cat > "$DIR/mac-stats.sh" <<'SCRIPT'
#!/bin/bash
# Fasst die App-Nutzung der letzten 7 Tage aus ActivityWatch zusammen und schickt sie an Cockpit.
URL="https://txucqslsykzfhwugdolt.supabase.co/functions/v1/cockpit-stats"
KEY="sb_publishable_60QG69Q7CZ6Ai0qrGePH6w_sMXGaSdT"
TOKEN="$(cat "$HOME/.cockpit/token")"
off() { if [ "$1" -ge 0 ]; then echo "+$1"; else echo "$1"; fi; }
iso() { date -v"$(off "$1")"d +%Y-%m-%dT00:00:00%z | sed -E 's/([+-][0-9]{2})([0-9]{2})$/\1:\2/'; }
day() { date -v"$(off "$1")"d +%Y-%m-%d; }
P=""; D=""
for i in 6 5 4 3 2 1 0; do
  P="$P\"$(iso $((0-i)))/$(iso $((1-i)))\","; D="$D\"$(day $((0-i)))\","
done
P="[${P%,}]"; D="[${D%,}]"
Q='["events = flood(query_bucket(find_bucket(\"aw-watcher-window_\")));","not_afk = flood(query_bucket(find_bucket(\"aw-watcher-afk_\")));","not_afk = filter_keyvals(not_afk, \"status\", [\"not-afk\"]);","events = filter_period_intersect(events, not_afk);","events = merge_events_by_keys(events, [\"app\"]);","events = sort_by_duration(events);","RETURN = events;"]'
RES=$(curl -s -m 30 -X POST "http://localhost:5600/api/0/query/" -H "Content-Type: application/json" -d "{\"timeperiods\":$P,\"query\":$Q}")
case "$RES" in \[*) ;; *) echo "ActivityWatch nicht erreichbar"; exit 0;; esac
curl -s -m 30 -X POST "$URL?token=$TOKEN" -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"updated\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"days\":$D,\"results\":$RES}" > /dev/null
SCRIPT
chmod 700 "$DIR/mac-stats.sh"

cat > "$DIR/uninstall.sh" <<UNINST
#!/bin/bash
launchctl unload "$PLIST" 2>/dev/null; rm -f "$PLIST"; rm -rf "$DIR"; echo "Mac-Statistik fuer Cock entfernt."
UNINST

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>de.cockpit.macstats</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/mac-stats.sh</string></array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
bash "$DIR/mac-stats.sh" && echo "Fertig. Cock zeigt die Mac-Nutzung in wenigen Minuten an."
