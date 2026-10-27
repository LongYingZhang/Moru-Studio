import { corsHeaders, json, summarize } from "../_traffic.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * 访问统计汇总 —— 公开只读，不需要口令（2026-10-27 按用户要求去掉）。
 *
 * 这里的数据只有：每日 UV / 页面浏览分布 / 设备占比 / 访客城市，
 * 不含任何顾客个人信息，所以公开可读。跨域仍由 functions/api/_middleware.js
 * 的 Origin 白名单兜着（自家域名 + 本机回环 + 私有网段），外站拿不到响应。
 *
 * 订单接口（functions/api/orders.js）的保护没有改动：那边有姓名/电话/地址，
 * 仍然靠 ADMIN_TOKEN。
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.TRAFFIC) {
    return json({ error: "TRAFFIC KV not bound", live: false }, 503);
  }

  const url = new URL(request.url);
  let range = url.searchParams.get("range") || "7";
  if (!["7", "30", "all"].includes(range)) range = "7";

  try {
    const data = await summarize(env, range);
    return json(data);
  } catch (err) {
    return json({ error: String((err && err.message) || err || "read failed") }, 500);
  }
}
