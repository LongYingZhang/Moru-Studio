#!/usr/bin/env bash
# Build a self-contained macOS .dmg for a static site.
# Usage: build-mac-dmg.sh "App Name" /path/to/source /path/to/out.dmg PORT
#
# The bundle is ad-hoc signed (codesign -s -). That is NOT a Developer ID
# signature, so Gatekeeper still shows "unidentified developer" the first
# time — but it stops macOS from refusing to open the image outright with
# the "damaged / cannot check for malware" error that a completely unsigned
# image gets. Right-click → Open (first run only) is enough.
#
# If a machine still refuses to open it, run:
#   xattr -dr com.apple.quarantine /path/to/App.dmg
set -euo pipefail

APP_NAME="$1"
SRC="$2"
OUT_DMG="$3"
PORT="$4"
APP_SAFE=$(echo "$APP_NAME" | tr ' ' '-')
BUNDLE_ID="com.moru.$(echo "$APP_SAFE" | tr '[:upper:]' '[:lower:]' | tr '-' '.')"

BUILD="/tmp/dmg-build-$$"
APP="$BUILD/$APP_NAME.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RES="$CONTENTS/Resources"
SITE="$RES/site"

mkdir -p "$MACOS" "$RES"

# Copy the public static site, excluding backend/infra files.
rsync -a \
  --exclude '.git' --exclude '.cf-stage' --exclude '.cursor' --exclude '.wrangler' \
  --exclude '.workbuddy' --exclude 'functions' --exclude 'admin' \
  --exclude 'admin.html' --exclude 'admin.js' --exclude 'admin.css' \
  --exclude 'server.py' --exclude 'server.mjs' --exclude 'node_modules' \
  --exclude '.env' --exclude '.env.*' --exclude 'wrangler.toml' --exclude 'wrangler.json' \
  --exclude '__pycache__' --exclude '.DS_Store' --exclude '*.command' \
  --exclude 'name_en.py' --exclude 'HANDOVER.md' --exclude 'DEPLOY.md' \
  --exclude 'MORU-SHOP-HANDOFF.md' --exclude 'MORU-SHOP-HANDOFF' --exclude 'README.md' \
  --exclude 'package.json' --exclude '.tmp-*.png' --exclude 'install-auto-pull.command' \
  "$SRC/" "$SITE/"

# Launcher: serve the bundled site on localhost and open it in the browser.
cat > "$MACOS/launch" <<PY
#!/usr/bin/env python3
import http.server, socketserver, webbrowser, os, sys, subprocess

BASE_PORT = $PORT
site = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Resources", "site"))
os.chdir(site)

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

httpd = None
port = None
for p in range(BASE_PORT, BASE_PORT + 8):
    try:
        httpd = socketserver.TCPServer(("127.0.0.1", p), H)
        port = p
        break
    except OSError:
        continue

if httpd is None:
    sys.stderr.write("Moru: no free port near %d\n" % BASE_PORT)
    sys.exit(1)

url = "http://127.0.0.1:%d/index.html" % port
if not webbrowser.open(url):
    subprocess.Popen(["open", url])

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    sys.exit(0)
PY
chmod +x "$MACOS/launch"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# Ad-hoc sign the bundle so macOS does not treat it as "damaged".
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || \
  echo "warning: ad-hoc codesign failed (app will still run, but macOS may complain)"

hdiutil create -volname "$APP_NAME" -srcfolder "$APP" -ov -format UDZO "$OUT_DMG" >/dev/null

# Ad-hoc sign the disk image too, and make sure no quarantine bit is baked in.
codesign --force --sign - "$OUT_DMG" >/dev/null 2>&1 || \
  echo "warning: ad-hoc codesign of the dmg failed"
xattr -dr com.apple.quarantine "$OUT_DMG" 2>/dev/null || true

rm -rf "$BUILD"
echo "BUILT: $OUT_DMG ($(du -h "$OUT_DMG" | cut -f1))"
