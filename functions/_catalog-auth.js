/**
 * 写线上商品/图片共用的校验工具。
 *
 * 只给 Functions 内部 import，以下划线开头的文件不会被当成路由。
 */
export const TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

// 后台上传的是网页用的商品图，8MB 已经很宽松；KV 单个值上限是 25MB。
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// 与 server.py 生成的文件名（sha256 前 32 位 + 扩展名）保持一致。
// 只放行这个形状，避免 ../ 之类的路径穿越拿别的 key。
export function isSafeImageName(name) {
  if (typeof name !== "string") return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(name)) return false;
  const ext = name.split(".").pop().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TYPES, ext);
}

/** 定长比较，避免逐字符提前返回泄漏口令长度/前缀。 */
export function sameSecret(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string") return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
