#!/bin/bash

# Resolve Script Directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

SRC_DIR="$SCRIPT_DIR/src"
DIST_DIR="$SCRIPT_DIR/dist"
OUT_FILE="$DIST_DIR/threads_block_tool.user.js"

mkdir -p "$DIST_DIR"

# Build Temp Bundle (Logic Only)
TEMP_BUNDLE="$DIST_DIR/temp_bundle.js"

OLD_VERSION="$(grep -oE "VERSION:\s*'[^']+'" "$SRC_DIR/config.js" | cut -d "'" -f 2 | tr -d '\r')"

if [[ "$1" == "--release" ]]; then
    # Drop beta tag if it exists (e.g., 2.0.6-beta1 -> 2.0.6)
    if [[ "$OLD_VERSION" == *"-beta"* ]]; then
        APP_VERSION=$(echo "$OLD_VERSION" | sed -E 's/-beta.*//')
    else
        # Otherwise, bump the patch version string (e.g. 2.0.6 -> 2.0.7)
        APP_VERSION=$(echo "$OLD_VERSION" | awk -F. '{$NF = $NF + 1;} 1' | sed 's/ /./g')
    fi
elif [[ "$1" == "--no-bump" ]]; then
    # Keep the current version
    APP_VERSION="$OLD_VERSION"
else
    # Bump or add beta tag
    if [[ "$OLD_VERSION" == *"-beta"* ]]; then
        BASE=$(echo "$OLD_VERSION" | sed -E 's/-beta.*//')
        BETA_NUM=$(echo "$OLD_VERSION" | grep -oE '-beta[0-9]+' | grep -oE '[0-9]+' | tr -d '\n\r ')
        APP_VERSION="$BASE-beta$((BETA_NUM + 1))"
    else
        # E.g. 2.0.6 -> 2.0.7-beta1
        BASE=$(echo "$OLD_VERSION" | awk -F. '{$NF = $NF + 1;} 1' | sed 's/ /./g')
        APP_VERSION="$BASE-beta1"
    fi
fi

if [[ "$APP_VERSION" != "$OLD_VERSION" ]]; then
    echo "Version Bumping: $OLD_VERSION -> $APP_VERSION"
    # Write the new version back to config.js
    sed -i '' -E "s/VERSION: '$OLD_VERSION'/VERSION: '$APP_VERSION'/" "$SRC_DIR/config.js"
else
    echo "Building current version: $APP_VERSION"
fi

echo "(function() {" > "$TEMP_BUNDLE"
echo "    'use strict';" >> "$TEMP_BUNDLE"
echo "    console.log('[HegeBlock] Content Script Injected, Version: $APP_VERSION');" >> "$TEMP_BUNDLE"

FILES=(
    "config.js"
    "utils.js"
    "storage.js"
    "ui.js"
    "core.js"
    "worker.js"
    "main.js"
)

for file in "${FILES[@]}"; do
    echo "// --- $file ---" >> "$TEMP_BUNDLE"
    sed -E 's/^import .*//g' "$SRC_DIR/$file" | sed -E 's/export const/const/g' | sed -E 's/export default//g' >> "$TEMP_BUNDLE"
    echo "" >> "$TEMP_BUNDLE"
done

echo "})();" >> "$TEMP_BUNDLE"


# 1. UserScript Build
cat <<EOF > "$OUT_FILE"
// ==UserScript==
// @name         留友封 (Threads 封鎖工具)
// @namespace    http://tampermonkey.net/
// @version      ${APP_VERSION}
// @description  Modular Refactor Build
// @author       海哥
// @match        https://www.threads.net/*
// @match        https://threads.net/*
// @match        https://www.threads.com/*
// @match        https://threads.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=threads.net
// @grant        none
// ==/UserScript==

EOF

cat "$TEMP_BUNDLE" >> "$OUT_FILE"
echo "UserScript Build complete: $OUT_FILE"


# 2. Chrome Extension Build
EXT_DIR="$DIST_DIR/extension"
mkdir -p "$EXT_DIR"

# Copy Logic (as content.js)
cp "$TEMP_BUNDLE" "$EXT_DIR/content.js"

# Copy Manifest
if [ -f "$SRC_DIR/manifest.json" ]; then
    cp "$SRC_DIR/manifest.json" "$EXT_DIR/manifest.json"
    sed -i '' -E "s/\"version\": \"[^\"]+\"/\"version\": \"$APP_VERSION\"/" "$EXT_DIR/manifest.json"
else
    echo "Warning: src/manifest.json not found."
fi

# Copy Icon
if [ -f "$SRC_DIR/icon.png" ]; then
    cp "$SRC_DIR/icon.png" "$EXT_DIR/icon.png"
elif [ -f "$SCRIPT_DIR/icon.png" ]; then
    cp "$SCRIPT_DIR/icon.png" "$EXT_DIR/icon.png"
else 
    # Fallback dummy
    touch "$EXT_DIR/icon.png"
fi

# Cleanup
rm "$TEMP_BUNDLE"

echo "Extension Build complete: $EXT_DIR"

# 3. Safari UserScript Deployment
SAFARI_PATH="/Users/skiseiju/Library/Mobile Documents/com~apple~CloudDocs/userscripts/threads-block.js"
SAFARI_DIR=$(dirname "$SAFARI_PATH")

if [ -d "$SAFARI_DIR" ]; then
    cp "$OUT_FILE" "$SAFARI_PATH"
    echo "Safari Build deployed: $SAFARI_PATH"
else
    echo "Warning: Safari Userscripts directory not found: $SAFARI_DIR"
fi
