#!/usr/bin/env bash
# Package a static site as a real Mac desktop app (own window, own Dock icon,
# no browser chrome) and wrap it in a .dmg.
#
# Usage: build-mac-app.sh "App Name" /path/to/source /path/to/out.dmg [icon.png]
#
# How it works:
#   Contents/MacOS/<App>   Swift binary: NSWindow + WKWebView (scripts/app/main.swift)
#   Contents/Resources/server.py  serves the bundled site on 127.0.0.1
#   Contents/Resources/site/      the static site
# The binary reads the port server.py prints, then loads it in the window.
#
# Note: the binary is arm64 only (Apple silicon). The Command Line Tools on
# this machine ship no x86_64 Swift runtime, so Intel Macs can't be targeted
# from here — they keep using the browser-based scripts/build-mac-dmg.sh.
set -euo pipefail

APP_NAME="$1"
SRC="$2"
OUT_DMG="$3"
ICON_PNG="${4:-$SRC/assets/icon-512.png}"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SWIFT_SRC="$REPO/scripts/app/main.swift"
SERVER_SRC="$REPO/scripts/app/server.py"
APP_SAFE=$(echo "$APP_NAME" | tr ' ' '-')
BUNDLE_ID="com.moru.$(echo "$APP_SAFE" | tr '[:upper:]' '[:lower:]' | tr '-' '.')"

BUILD="/tmp/app-build-$$"
APP="$BUILD/$APP_NAME.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RES="$CONTENTS/Resources"
SITE="$RES/site"

mkdir -p "$MACOS" "$RES"

# ---- site -------------------------------------------------------------
rsync -a \
  --exclude '.git' --exclude '.cf-stage' --exclude '.cursor' --exclude '.wrangler' \
  --exclude '.workbuddy' --exclude 'functions' --exclude 'admin' \
  --exclude 'admin.html' --exclude 'admin.js' --exclude 'admin.css' \
  --exclude 'server.py' --exclude 'server.mjs' --exclude 'node_modules' \
  --exclude '.env' --exclude '.env.*' --exclude 'wrangler.toml' --exclude 'wrangler.json' \
  --exclude '__pycache__' --exclude '.DS_Store' --exclude '*.command' \
  --exclude 'name_en.py' --exclude 'HANDOVER.md' --exclude 'DEPLOY.md' \
  --exclude 'MORU-SHOP-HANDOFF.md' --exclude 'README.md' \
  --exclude 'package.json' --exclude '.tmp-*.png' \
  "$SRC/" "$SITE/"
cp "$SERVER_SRC" "$RES/server.py"

# ---- icon --------------------------------------------------------------
if [[ -f "$ICON_PNG" ]]; then
  ICONSET="$BUILD/icon.iconset"
  mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z "$s" "$s" "$ICON_PNG" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1
    d=$((s * 2))
    sips -z "$d" "$d" "$ICON_PNG" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null 2>&1
  done
  iconutil -c icns "$ICONSET" -o "$RES/AppIcon.icns" 2>/dev/null || true
fi

# ---- binary ------------------------------------------------------------
SDK="$(xcrun --show-sdk-path)"
swiftc -O -target arm64-apple-macos12.0 -sdk "$SDK" "$SWIFT_SRC" -o "$MACOS/$APP_NAME"

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
  <key>CFBundleExecutable</key><string>$APP_NAME</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

# ---- sign + package ---------------------------------------------------
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "warning: codesign failed"
hdiutil create -volname "$APP_NAME" -srcfolder "$APP" -ov -format UDZO "$OUT_DMG" >/dev/null 2>&1
codesign --force --sign - "$OUT_DMG" >/dev/null 2>&1 || echo "warning: dmg codesign failed"
xattr -dr com.apple.quarantine "$OUT_DMG" 2>/dev/null || true

rm -rf "$BUILD"
echo "BUILT: $OUT_DMG ($(du -h "$OUT_DMG" | cut -f1))"
