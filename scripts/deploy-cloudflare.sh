#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Stage a public storefront (no admin secrets) + Pages Functions.
# Directory name must match pages_build_output_dir in wrangler.toml so KV bindings apply.
# NOTE: do NOT `rm -rf` the stage dir here — deleting ~100 files trips the
# bulk-delete guard and aborts the whole deploy. rsync updates it in place instead.
STAGE=".cf-stage"
mkdir -p "$STAGE"

# 商品数据与后台上传图，以「真正跑后台的那台机器」为准。
# 后台跑在 2015（用户就是在那台的 admin 里改商品、传实拍图的），
# 而部署在 M4 上跑；如果直接用 M4 自己的 admin/data，就会把过期数据和
# 缺图带上线——2026-10-26 就是这么踩的：后台换了图，线上几个月都是旧图。
# 所以部署前先把 2015 那份拉过来，连不上才退回本机，并且明确提示。
SHOP_HOST="${MORU_SHOP_HOST:-zhanglongying@zhanglongyingdeMacBook-Air-2015.local}"
SHOP_REMOTE_DIR="${MORU_SHOP_DIR:-/Users/zhanglongying/Sites/LONGYING STUDIO}"
if ssh -o BatchMode=yes -o ConnectTimeout=6 "$SHOP_HOST" true 2>/dev/null; then
  mkdir -p admin/data/uploads
  if ssh -o BatchMode=yes "$SHOP_HOST" "cat '$SHOP_REMOTE_DIR/admin/data/products.json'" \
      > admin/data/products.json.pull 2>/dev/null && [[ -s admin/data/products.json.pull ]]; then
    mv admin/data/products.json.pull admin/data/products.json
    echo "商品数据：已从 $SHOP_HOST 取回"
  else
    rm -f admin/data/products.json.pull
    echo "⚠️  取回商品数据失败，沿用本机这份"
  fi
  if ssh -o BatchMode=yes "$SHOP_HOST" \
      "cd '$SHOP_REMOTE_DIR/admin/data/uploads' && tar cf - ." 2>/dev/null \
      | tar xf - -C admin/data/uploads 2>/dev/null; then
    echo "上传图：已从 $SHOP_HOST 取回，本机共 $(find admin/data/uploads -type f | wc -l | tr -d ' ') 个"
  else
    echo "⚠️  取回上传图失败，沿用本机这份"
  fi
else
  echo "⚠️  连不上 $SHOP_HOST，商品数据与图片用本机这份（可能不是最新的）"
fi

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

# 后台上传的商品图：server.py 存到 admin/data/uploads/，商品数据里的路径是
# /uploads/<hash>.jpg。admin/ 整体被 exclude，所以要单独同步到站点根的 uploads/，
# 否则线上命中不了，Pages 会 SPA fallback 返回 index.html（200 但 text/html）。
if [[ -d admin/data/uploads ]]; then
  mkdir -p "$STAGE/uploads"
  rsync -a --exclude='.*' admin/data/uploads/ "$STAGE/uploads/"
  echo "uploads: $(find "$STAGE/uploads" -type f | wc -l | tr -d ' ') 个文件"
fi

# 线上商品数据里的 /uploads/ 一律补成绝对地址。
# 原因：网页版有 shop.js 的 assetUrl() 兜底，但**已经装好的旧版 app**里没有这段代码，
# 相对路径会去请求 127.0.0.1 上不存在的文件，商品图直接空掉。
# 改成绝对地址后，老版本 app 也能立刻看到后台上传的新图，不必重发 dmg。
if [[ -f "$STAGE/data/products.json" ]]; then
  /usr/bin/python3 - "$STAGE/data/products.json" <<'PY'
import json, sys, pathlib

path = pathlib.Path(sys.argv[1])
BASE = "https://longying-studio.pages.dev"
items = json.loads(path.read_text(encoding="utf-8"))


def absolute(value):
    if isinstance(value, str) and value.startswith("/uploads/"):
        return BASE + value
    return value


for item in items:
    if not isinstance(item, dict):
        continue
    for key in ("image", "cardImage"):
        if key in item:
            item[key] = absolute(item[key])
    for key in ("gallery", "images"):
        if isinstance(item.get(key), list):
            item[key] = [absolute(v) for v in item[key]]

path.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("商品图路径已补成绝对地址")
PY
fi

# Deploy via wrangler.toml (picks up TRAFFIC KV binding)
npx --yes wrangler pages deploy \
  --project-name longying-studio \
  --branch main \
  --commit-dirty=true
