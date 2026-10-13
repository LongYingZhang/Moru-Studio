#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Stage a public storefront (no admin secrets) + Pages Functions for Moru.
STAGE="$(mktemp -d /tmp/studio-cf.XXXXXX)"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

rsync -a   --exclude '.git'   --exclude '.cursor'   --exclude '.env'   --exclude '.env.*'   --exclude '.venv'   --exclude 'node_modules'   --exclude 'admin'   --exclude '.tmp*'   --exclude '*.command'   --exclude 'server.py'   --exclude 'name_en.py'   --exclude 'package.json'   --exclude 'package-lock.json'   --exclude 'README.md'   ./ "$STAGE/"

# Fresh catalog snapshot for /api/products + Moru
mkdir -p "$STAGE/data"
if [[ -f admin/data/products.json ]]; then
  cp admin/data/products.json "$STAGE/data/products.json"
fi

npx --yes wrangler pages deploy "$STAGE"   --project-name longying-studio   --branch main   --commit-dirty=true
