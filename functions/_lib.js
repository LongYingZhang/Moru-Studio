/**
 * Functions 内部共用的 JSON 响应助手。
 *
 * 以前 json() 在 products / orders / chat / uploads 四个文件里各抄了一遍，
 * 现在统一收口到这里。以下划线开头的文件不会被 Pages Functions 当成路由，
 * 只放纯函数。
 */
export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
