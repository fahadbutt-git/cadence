#!/bin/bash
# Builds the macOS app. Requires Xcode command line tools.
#
#   bash scripts/build-macos-app.sh            Development build: "Cadence Studio.app" in the project
#                                              folder, runs the server from this folder.
#   BUNDLE=1 NODE_DIR=/path/to/node bash ...   Release build: "dist/Cadence.app" with the server,
#                                              its dependencies and a Node runtime packed inside.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ "${BUNDLE:-0}" = "1" ]; then
  mkdir -p "$ROOT_DIR/dist"
  APP_BUNDLE="$ROOT_DIR/dist/Cadence.app"
  rm -rf "$APP_BUNDLE"
else
  APP_BUNDLE="$ROOT_DIR/Cadence Studio.app"
fi
CONTENTS="$APP_BUNDLE/Contents"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version" 2>/dev/null || echo 3.0.0)"

mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>CadenceStudio</string>
  <key>CFBundleIdentifier</key><string>com.fahadbutt.cadence</string>
  <key>CFBundleName</key><string>Cadence</string>
  <key>CFBundleDisplayName</key><string>Cadence</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Cadence listens when you press Speak so you can give editing instructions by voice.</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>Cadence turns your spoken instructions into text so it can edit your document.</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

cp "$ROOT_DIR/macos/assets/AppIcon.icns" "$CONTENTS/Resources/AppIcon.icns"

if [ "${BUNDLE:-0}" = "1" ]; then
  echo "Packing server and dependencies..."
  APP_RES="$CONTENTS/Resources/app"
  mkdir -p "$APP_RES"
  cp -R "$ROOT_DIR/server.js" "$ROOT_DIR/package.json" "$ROOT_DIR/src" "$ROOT_DIR/public" "$APP_RES/"
  [ -d "$ROOT_DIR/node_modules" ] || (cd "$ROOT_DIR" && npm ci --omit=dev)
  cp -R "$ROOT_DIR/node_modules" "$APP_RES/node_modules"
  # The grammar checker ships several builds; the server only loads binary.js with harper_wasm_bg.wasm.
  rm -f "$APP_RES/node_modules/harper.js/dist/"*Inlined.js "$APP_RES/node_modules/harper.js/dist/harper_wasm_slim_bg.wasm"
  if [ -n "${NODE_DIR:-}" ]; then
    mkdir -p "$CONTENTS/Resources/node/bin"
    cp "$NODE_DIR/bin/node" "$CONTENTS/Resources/node/bin/node"
    chmod +x "$CONTENTS/Resources/node/bin/node"
  fi
fi

echo "Compiling..."
/usr/bin/swiftc -O "$ROOT_DIR/macos/CadenceApp.swift" \
  -o "$CONTENTS/MacOS/CadenceStudio" \
  -framework Cocoa -framework WebKit -framework Speech -framework AVFoundation -framework UniformTypeIdentifiers

chmod +x "$CONTENTS/MacOS/CadenceStudio"
# Ad hoc signature so macOS remembers microphone and speech permissions between launches.
codesign --force --sign - "$APP_BUNDLE" || echo "codesign skipped"
# Refresh the Dock and Finder icon cache for this bundle.
touch "$APP_BUNDLE"
echo "Built $APP_BUNDLE"
