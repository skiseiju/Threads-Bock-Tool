#!/bin/bash

# Extract version from src/config.js
VERSION=$(grep -oE "VERSION: '[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+)?'" src/config.js | awk -F"'" '{print $2}')
TAG_NAME="v$VERSION"

echo "📦 Currently detected version in src/config.js: $TAG_NAME"

# Check if git is clean
if [[ -n $(git status -s) ]]; then
    echo "⚠️ Working directory is not clean. Committing remaining changes..."
    git add .
    git commit -m "chore: auto-commit before push and release $TAG_NAME"
fi

# Push main branch
echo "🚀 Pushing main branch to github..."
git push origin main

# Check if tag already exists locally
if git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
    echo "ℹ️ Tag $TAG_NAME already exists locally."
else
    echo "🏷️ Creating new tag: $TAG_NAME..."
    git tag "$TAG_NAME"
fi

# Push tags to trigger GitHub Action release
echo "🚀 Pushing tags to trigger GitHub Release..."
git push origin "$TAG_NAME"

echo "✅ Done! Check your GitHub Actions tab to see the release progress."
