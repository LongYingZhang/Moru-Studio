#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Stage a public storefront (no admin secrets) + Pages Functions.
# Directory name must match pages_build_output_dir in wrangler.toml so KV bindings apply.
STAGE=".cf-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"

rsync -a \
  --exclude '.git' \
  --exclude '.cursor' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.venv' \
  --exclude 'node_modules' \
  --exclude 'admin' \
  --exclude '.tmp*' \
  --exclude '.cf-stage' \
  --exclude '*.command' \
  --exclude 'server.py' \
  --exclude 'name_en.py' \
  --exclude 'package.json' \
  --exclude 'package-lock.json' \
  --exclude 'README.md' \
  --exclude 'wrangler.toml' \
  ./ "$STAGE/"

# Fresh catalog snapshot for /api/products + Moru
mkdir -p "$STAGE/data"
if [[ -f admin/data/products.json ]]; then
  cp admin/data/products.json "$STAGE/data/products.json"
fi

# Deploy via wrangler.toml (picks up TRAFFIC KV binding)
npx --yes wrangler pages deploy \
  --project-name moru-shop \
  --branch main \
  --commit-dirty=true
