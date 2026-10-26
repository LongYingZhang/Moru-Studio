/* Minimal service worker so the shop can install as a standalone app.
 *
 * ⚠️ fetch 处理器故意为空（不接管任何请求）。
 * 以前是 `respondWith(fetch(event.request))` —— 纯转发、零收益，但只要任意一个
 * 被接管的请求失败（跨域 CORS 被拦、请求被中断、离线），WebKit 就会抛
 * "FetchEvent.respondWith received an error: TypeError: Load failed"。
 * 保留空的 fetch 监听只是为了满足 PWA 可安装条件。
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {});
