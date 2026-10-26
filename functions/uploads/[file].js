/**
 * /uploads/<file> —— 后台上传的商品图。
 *
 * 取图优先级：
 *   1) KV `MORU_PRODUCTS` 里的 `upload:<file>` —— 后台传完图立刻写入，所以传完就生效，
 *      不用像以前那样非得跑一次 deploy-cloudflare.sh 才看得见
 *   2) 站点静态资源 —— 历史上随部署上传的那些图（没进 KV，行为与以前一致）
 *
 * 文件名是内容 sha256 的前 32 位，内容不会变，所以可以放心让浏览器缓存一会儿。
 */
import { TYPES, isSafeImageName } from "../_catalog-auth.js";

const KEY_PREFIX = "upload:";
const MAX_AGE = 300;

function typeOf(name) {
  const ext = name.split(".").pop().toLowerCase();
  return TYPES[ext] || "application/octet-stream";
}

export async function onRequest(context) {
  const { env, params, request } = context;
  const method = request.method;

  if (method !== "GET" && method !== "HEAD") {
    return env.ASSETS.fetch(request);
  }

  const name = String(params.file || "");
  if (env.MORU_PRODUCTS && isSafeImageName(name)) {
    try {
      const buf = await env.MORU_PRODUCTS.get(KEY_PREFIX + name, "arrayBuffer");
      if (buf && buf.byteLength > 0) {
        return new Response(method === "HEAD" ? null : buf, {
          status: 200,
          headers: {
            "Content-Type": typeOf(name),
            "Cache-Control": `public, max-age=${MAX_AGE}`,
            "X-Image-Source": "kv",
          },
        });
      }
    } catch (e) {
      // KV 抖动不要紧，下面继续走静态资源
    }
  }

  return env.ASSETS.fetch(request);
}
