#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Gmail Desk"
APP_BUNDLE_ID="ca.nixc.gmail"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release"
VERSION="$(cd "$ROOT_DIR" && node -p "require('./package.json').version")"

ARCH="${ELECTRON_ARCH:-$(uname -m)}"
case "$ARCH" in
  arm64)
    PACKAGER_ARCH="arm64"
    ;;
  x86_64|x64)
    PACKAGER_ARCH="x64"
    ;;
  universal)
    PACKAGER_ARCH="universal"
    ;;
  *)
    echo "Unsupported Electron arch: $ARCH" >&2
    exit 1
    ;;
esac

for tool in node ditto codesign /usr/libexec/PlistBuddy; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    exit 1
  fi
done

(
  cd "$ROOT_DIR"
  npm run build
)

mkdir -p "$RELEASE_DIR"
rm -rf "$RELEASE_DIR/GCal Desk-darwin-"* "$RELEASE_DIR/GCal Desk.app"
rm -f "$RELEASE_DIR/GCal-Desk-macOS-Electron-"*.zip
rm -rf "$RELEASE_DIR/${APP_NAME}-darwin-${PACKAGER_ARCH}" "$RELEASE_DIR/${APP_NAME}.app"
rm -f "$RELEASE_DIR/Gmail-Desk-macOS-Electron-${PACKAGER_ARCH}.zip"

PACKAGER_ARGS=(
  "$ROOT_DIR"
  "$APP_NAME"
  --platform=darwin
  --arch="$PACKAGER_ARCH"
  --out="$RELEASE_DIR"
  --overwrite
  --app-bundle-id="$APP_BUNDLE_ID"
  --app-version="$VERSION"
  --build-version="$VERSION"
  --extend-info="$ROOT_DIR/build/mac/Info.plist"
  --ignore='^/dist($|/)'
  --ignore='^/release($|/)'
  --ignore='^/build/.*\.iconset($|/)'
  --ignore='^/\.git($|/)'
  --ignore='^/config/.*\.json$'
  --ignore='^/\.env$'
)

(
  cd "$ROOT_DIR"
  node "$ROOT_DIR/node_modules/@electron/packager/bin/electron-packager.mjs" "${PACKAGER_ARGS[@]}"
)

PACKAGED_APP="$RELEASE_DIR/${APP_NAME}-darwin-${PACKAGER_ARCH}/${APP_NAME}.app"

if [[ -f "$ROOT_DIR/assets/gmail-desk.icns" ]]; then
  cp "$ROOT_DIR/assets/gmail-desk.icns" "$PACKAGED_APP/Contents/Resources/gmail-desk.icns"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile gmail-desk.icns" "$PACKAGED_APP/Contents/Info.plist" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string gmail-desk.icns" "$PACKAGED_APP/Contents/Info.plist"
fi

codesign --force --deep --sign - "$PACKAGED_APP" >/dev/null
ditto "$PACKAGED_APP" "$RELEASE_DIR/${APP_NAME}.app"

(
  cd "$RELEASE_DIR"
  ditto -c -k --sequesterRsrc --keepParent "${APP_NAME}.app" "Gmail-Desk-macOS-Electron-${PACKAGER_ARCH}.zip"
)

echo "Packaged $RELEASE_DIR/${APP_NAME}.app"
echo "Packaged $RELEASE_DIR/Gmail-Desk-macOS-Electron-${PACKAGER_ARCH}.zip"
