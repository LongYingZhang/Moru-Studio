#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Stage a public storefront (no admin secrets) + Pages Functions.
# Directory name must match pages_build_output_dir in wrangler.toml so KV bindings apply.
# NOTE: do NOT `rm -rf` the stage dir here — deleting ~100 files trips the
# bulk-delete guard and aborts the whole deploy. rsync updates it in place instead.
STAGE=".cf-stage"
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

# 站点里删掉的文件，stage 里也要删，否则会一直跟着部署上去
# （只删 download/ 下这一两个文件，避免触发批量删除拦截）
if [[ -d "$STAGE/download" ]]; then
  for f in "$STAGE/download"/*; do
    [[ -e "$f" ]] || continue
    b="$(basename "$f")"
    if [[ ! -e "download/$b" ]]; then
      echo "remove stale: download/$b"
      rm -f "$f"
    fi
  done
fi

# Fresh catalog snapshot for /api/products + Moru
mkdir -p "$STAGE/data"
if [[ -f admin/data/products.json ]]; then
  cp admin/data/products.json "$STAGE/data/products.json"
fi

# Deploy via wrangler.toml (picks up TRAFFIC KV binding)
npx --yes wrangler pages deploy \
  --project-name longying-studio \
  --branch main \
  --commit-dirty=true
