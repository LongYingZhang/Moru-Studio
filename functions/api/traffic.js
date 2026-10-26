import { corsHeaders, json, summarize } from "../_traffic.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * 访问统计汇总。
 *
 * 需要口令：`?token=<ADMIN_TOKEN>` 或请求头 `X-Admin-Token`。
 * 不加的话谁都能打开这个 URL 看 UV / 访客城市 / 页面分布，
 * 而且以前响应还带 CORS 星号，任何网站都能用 JS 偷偷读走。
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.TRAFFIC) {
    return json({ error: "TRAFFIC KV not bound", live: false }, 503);
  }

  const url = new URL(request.url);
  const given = url.searchParams.get("token") || request.headers.get("X-Admin-Token") || "";
  const expected = String(env.ADMIN_TOKEN || "").trim();

  if (!expected) {
    return json(
      { error: "还没设置后台口令。请在 Cloudflare 给 Pages 项目配置环境变量 ADMIN_TOKEN。" },
      503
    );
  }
  if (!safeEqual(given, expected)) {
    return json({ error: "口令不对，看不到访问数据" }, 401);
  }

  let range = url.searchParams.get("range") || "7";
  if (!["7", "30", "all"].includes(range)) range = "7";
  try {
    const data = await summarize(env, range);
    return json(data);
  } catch (err) {
    return json({ error: String((err && err.message) || err || "read failed") }, 500);
  }
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
