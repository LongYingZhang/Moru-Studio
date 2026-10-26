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
