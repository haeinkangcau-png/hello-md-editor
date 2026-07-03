#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="Hi MD Power"
APP_DIR="$ROOT/release/$APP_NAME.app"
CONTENTS="$APP_DIR/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

cd "$ROOT"
npm run copy:specviewer
npx vite build
swift build -c release --package-path "$ROOT/native/mac"

BIN_DIR="$(swift build -c release --show-bin-path --package-path "$ROOT/native/mac")"

rm -rf "$APP_DIR"
mkdir -p "$MACOS" "$RESOURCES"
cp "$BIN_DIR/HiMDPower" "$MACOS/HiMDPower"
cp -R "$ROOT/dist" "$RESOURCES/dist"

cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>HiMDPower</string>
  <key>CFBundleIdentifier</key>
  <string>com.neurophet.himdpower</string>
  <key>CFBundleName</key>
  <string>Hi MD Power</string>
  <key>CFBundleDisplayName</key>
  <string>Hi MD Power</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP_DIR" >/dev/null
fi

file "$MACOS/HiMDPower"
echo "Built $APP_DIR"
