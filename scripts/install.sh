#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Gmail Desk"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="${1:-/Applications/${APP_NAME}.app}"
PACKAGED_APP="$ROOT_DIR/release/${APP_NAME}.app"

"$ROOT_DIR/scripts/package.sh"

mkdir -p "$(dirname "$APP_PATH")"
rm -rf "$APP_PATH"
ditto "$PACKAGED_APP" "$APP_PATH"

if [[ "$APP_PATH" == /Applications/* ]]; then
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_PATH" >/dev/null 2>&1 || true
fi

echo "Installed Electron app $APP_PATH"
