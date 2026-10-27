/**
 * PUT /api/uploads/<file> —— 后台把上传的商品图写进 KV，传完就上线。
 *
 * 为什么要有它：图片以前是静态资源，后台上传只写到本机 admin/data/uploads/，
 * 必须再跑一次 deploy-cloudflare.sh 才会真正上线。用户看到的现象是「传了新图，
 * 网站和桌面版还是旧图 / 灰块」。现在后台保存商品时顺手把新图 PUT 到这里，
 * 由 /uploads/<file> 直接从 KV 吐出来，和商品数据一样是秒级的。
 *
 * 鉴权与 /api/products 完全一致：Pages secret `CATALOG_TOKEN`，头 `X-Catalog-Token`。
 */
import { json } from "../../_lib.js";
import { TYPES, MAX_IMAGE_BYTES, isSafeImageName, sameSecret } from "../../_catalog-auth.js";

export async function onRequestPut(context) {
  const { env, params, request } = context;

  const expected = env.CATALOG_TOKEN;
  if (!expected) return json({ error: "线上未配置 CATALOG_TOKEN" }, 503);
  if (!sameSecret(request.headers.get("X-Catalog-Token") || "", expected)) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!env.MORU_PRODUCTS) return json({ error: "KV 未绑定 MORU_PRODUCTS" }, 503);

  const name = String(params.name || "");
  if (!isSafeImageName(name)) return json({ error: "文件名不合法" }, 400);

  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_IMAGE_BYTES) return json({ error: "图片超过 8MB" }, 413);

  let buf;
  try {
    buf = await request.arrayBuffer();
  } catch (e) {
    return json({ error: "读取图片数据失败" }, 400);
  }
  if (!buf || buf.byteLength === 0) return json({ error: "空文件" }, 400);
  if (buf.byteLength > MAX_IMAGE_BYTES) return json({ error: "图片超过 8MB" }, 413);

  const ext = name.split(".").pop().toLowerCase();
  await env.MORU_PRODUCTS.put("upload:" + name, buf, {
    metadata: { type: TYPES[ext], size: buf.byteLength, at: new Date().toISOString() },
  });

  return json({ ok: true, name, size: buf.byteLength });
}

/** 顺手支持删图，方便以后清理（当前后台还没调用）。 */
export async function onRequestDelete(context) {
  const { env, params, request } = context;

  const expected = env.CATALOG_TOKEN;
  if (!expected) return json({ error: "线上未配置 CATALOG_TOKEN" }, 503);
  if (!sameSecret(request.headers.get("X-Catalog-Token") || "", expected)) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!env.MORU_PRODUCTS) return json({ error: "KV 未绑定 MORU_PRODUCTS" }, 503);

  const name = String(params.name || "");
  if (!isSafeImageName(name)) return json({ error: "文件名不合法" }, 400);

  await env.MORU_PRODUCTS.delete("upload:" + name);
  return json({ ok: true, name });
}
