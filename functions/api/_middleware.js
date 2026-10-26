/**
 * 只作用于 /api/* 的跨域中间件。
 *
 * 为什么要它：桌面版 app 用内置服务跑在 http://127.0.0.1:<随机端口>，
 * 它自己不带后端，所以 /api/* 一律返回 404。前端因此改成把请求发到线上
 * https://longying-studio.pages.dev，这就变成跨域请求 —— 需要这里放行。
 *
 * 只放行「我们自己的域名」和「本机回环地址」，不用 * ，
 * 免得任何网站都能白嫖 /api/moru/chat 的模型额度。
 */
const ALLOWED =
  /^https:\/\/([\w-]+\.)?longying-studio\.pages\.dev$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED.test(origin)) return true;
  // 本机：任意端口都算（app 的端口是随机的）
  if (/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) return true;
  // 局域网后台：2015 那台固定在 192.168.x.x:8787，或从本机用 *.local 访问。
  // 仅放开私有网段，数据仍由 ADMIN_TOKEN 口令保护，不会裸奔。
  if (/^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) return true;
  if (/^http:\/\/[\w-]+\.local(:\d+)?$/.test(origin)) return true;
  return false;
}

export async function onRequest(context) {
  const origin = context.request.headers.get("Origin") || "";
  const extra = {};

  if (isAllowedOrigin(origin)) {
    extra["Access-Control-Allow-Origin"] = origin;
    extra["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    extra["Access-Control-Allow-Headers"] = "Content-Type";
    extra["Access-Control-Max-Age"] = "86400";
    extra["Vary"] = "Origin";
  }

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: extra });
  }

  const response = await context.next();
  const out = new Response(response.body, response);
  for (const key of Object.keys(extra)) out.headers.set(key, extra[key]);
  return out;
}
