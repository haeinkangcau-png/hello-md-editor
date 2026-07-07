#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="Hi MD Power"
APP_DIR="$ROOT/release/$APP_NAME.app"
SIGNED_ZIP="$ROOT/release/Hi-MD-Power-macos-arm64-signed.zip"
FINAL_ZIP="$ROOT/release/Hi-MD-Power-macos-arm64-notarized.zip"

IDENTITY="${DEVELOPER_ID_APPLICATION:-}"
NOTARY_PROFILE="${NOTARY_KEYCHAIN_PROFILE:-}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "Missing app bundle: $APP_DIR" >&2
  echo "Run: bash native/scripts/build-mac-native-app.sh" >&2
  exit 1
fi

if [[ -z "$IDENTITY" ]]; then
  echo "Set DEVELOPER_ID_APPLICATION to your Developer ID Application identity." >&2
  echo "Example: export DEVELOPER_ID_APPLICATION='Developer ID Application: Your Name (TEAMID)'" >&2
  security find-identity -v -p codesigning || true
  exit 1
fi

if [[ -z "$NOTARY_PROFILE" ]]; then
  echo "Set NOTARY_KEYCHAIN_PROFILE to an xcrun notarytool keychain profile." >&2
  echo "Create one with:" >&2
  echo "  xcrun notarytool store-credentials <profile-name> --apple-id <email> --team-id <TEAMID> --password <app-specific-password>" >&2
  exit 1
fi

echo "Signing $APP_DIR"
codesign --force --deep --options runtime --timestamp --sign "$IDENTITY" "$APP_DIR"
codesign --verify --deep --strict --verbose=2 "$APP_DIR"

rm -f "$SIGNED_ZIP" "$FINAL_ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$SIGNED_ZIP"

echo "Submitting to Apple notary service"
xcrun notarytool submit "$SIGNED_ZIP" --keychain-profile "$NOTARY_PROFILE" --wait

echo "Stapling notarization ticket"
xcrun stapler staple "$APP_DIR"
xcrun stapler validate "$APP_DIR"

echo "Assessing with Gatekeeper"
spctl --assess --type execute --verbose=4 "$APP_DIR"

ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$FINAL_ZIP"
echo "Notarized zip: $FINAL_ZIP"
