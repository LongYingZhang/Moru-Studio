/**
 * Public product catalog for the storefront.
 *
 * 数据来源优先级：
 *   1) KV `MORU_PRODUCTS.catalog` —— 后台保存商品时直接写入，改完不必重新部署
 *   2) 随部署上传的 /data/products.json —— KV 还没写入时的兜底快照
 *
 * KV 是最终一致的：写入后当前节点立刻能读到，其他节点最长约 60 秒。
 * 所以「后台点一下 → 网页/桌面版看到」一般十几秒，最坏一分钟出头。
 */
const SITE_ORIGIN = "https://longying-studio.pages.dev";

// 后台存的是 /uploads/xxx.jpg 这种相对路径；已经装好的旧版 app 里没有
// assetUrl() 兜底，会去请求 127.0.0.1 上不存在的文件，图直接空掉。
// 所以出口统一补成绝对地址（幂等，已经绝对化的不会再动）。
function absolutize(body) {
  let items;
  try {
    items = JSON.parse(body);
  } catch (e) {
    return body;
  }
  if (!Array.isArray(items)) return body;

  const fix = (value) =>
    typeof value === "string" && value.startsWith("/uploads/") ? SITE_ORIGIN + value : value;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    for (const key of ["image", "cardImage"]) {
      if (key in item) item[key] = fix(item[key]);
    }
    for (const key of ["gallery", "images"]) {
      if (Array.isArray(item[key])) item[key] = item[key].map(fix);
    }
  }
  return JSON.stringify(items);
}

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

export async function onRequestGet(context) {
  const { env, request } = context;

  if (env.MORU_PRODUCTS) {
    try {
      const stored = await env.MORU_PRODUCTS.get("catalog");
      if (stored) {
        return new Response(absolutize(stored), { status: 200, headers: HEADERS });
      }
    } catch (e) {
      // KV 出问题时不要挡住店铺，继续走静态兜底
    }
  }

  const url = new URL(request.url);
  const asset = await env.ASSETS.fetch(new URL("/data/products.json", url.origin));
  if (!asset.ok) {
    return json({ error: "products unavailable" }, 500);
  }
  return new Response(absolutize(await asset.text()), { status: 200, headers: HEADERS });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// 定长比较，避免逐字符提前返回泄漏口令长度/前缀
function sameSecret(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string") return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 后台保存商品后，把整份目录写进 KV。
 *
 * 真正跑店铺的是另一台 Mac（2015），它没有 Cloudflare 登录态、也未必有 node，
 * 所以写入口做成这里：只要带上 CATALOG_TOKEN 就能推，不受 OAuth 8 小时过期影响。
 * 口令是 Pages 的 secret（`wrangler pages secret put CATALOG_TOKEN`），
 * 同时写在跑店铺那台机器的 .env 里（MORU_CATALOG_TOKEN）。
 */
export async function onRequestPut(context) {
  const { env, request } = context;

  const expected = env.CATALOG_TOKEN;
  if (!expected) return json({ error: "线上未配置 CATALOG_TOKEN" }, 503);
  if (!sameSecret(request.headers.get("X-Catalog-Token") || "", expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  if (!env.MORU_PRODUCTS) return json({ error: "KV 未绑定 MORU_PRODUCTS" }, 503);

  let items;
  try {
    items = JSON.parse(await request.text());
  } catch (e) {
    return json({ error: "JSON 解析失败" }, 400);
  }
  if (!Array.isArray(items) || items.length === 0) {
    return json({ error: "商品数据必须是非空数组" }, 400);
  }
  if (items.length > 500) {
    return json({ error: "商品数量超出上限" }, 413);
  }

  await env.MORU_PRODUCTS.put("catalog", JSON.stringify(items));
  return json({ ok: true, count: items.length, updatedAt: new Date().toISOString() });
}

