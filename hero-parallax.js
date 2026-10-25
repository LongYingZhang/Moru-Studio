/* 右侧主图跟随鼠标（作品集同款视差）
   - 指针在整个窗口追踪，映射到 hero 自身范围，缓动跟随，手感与作品集一致
   - 放大倍数按区域尺寸动态算，保证位移到极限也不露边
   - 悬浮时轻微再推近（替代原来 CSS 的 :hover scale）
   - 触摸设备 / 关闭动态效果偏好：直接不启用，退回静态轻微放大 */
(function () {
  var MAX_X = 18;            // 水平最大位移 px
  var MAX_Y = 12;            // 垂直最大位移 px
  var EASE = 0.1;            // 缓动系数，与作品集一致
  var HOVER_BONUS = 0.018;   // 悬浮时再推近一点
  var FALLBACK_SCALE = 1.055; // CSS 无 JS 时的兜底放大
  var EPS = 0.01;            // 小于这个变化就不写 DOM

  var hero = null;
  var photo = null;
  var raf = 0;
  var hovering = false;
  var listening = false;

  var pointer = { x: 0, y: 0 };
  var pos = { x: 0, y: 0 };
  var scale = FALLBACK_SCALE;
  var baseScale = FALLBACK_SCALE;

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  /* 位移最多 MAX_X / MAX_Y，放大倍数要保证两边各多出的余量够用，
     否则窄画幅（app 小窗口、竖屏）会从边上露出底色 */
  function computeBaseScale(rect) {
    var needX = 1 + (2 * MAX_X) / Math.max(1, rect.width);
    var needY = 1 + (2 * MAX_Y) / Math.max(1, rect.height);
    return Math.max(1.02, needX, needY) + 0.01;
  }

  function mq(query) {
    return window.matchMedia ? window.matchMedia(query).matches : false;
  }

  function centerPointer() {
    pointer.x = window.innerWidth * 0.5;
    pointer.y = window.innerHeight * 0.5;
  }

  function onPointer(e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  }

  function onLeave() {
    centerPointer();
    hovering = false;
  }

  function paint() {
    photo.style.transform =
      "translate3d(" + pos.x.toFixed(2) + "px," + pos.y.toFixed(2) + "px,0) scale(" + scale.toFixed(4) + ")";
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!hero || !photo) return;
    var rect = hero.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    baseScale = computeBaseScale(rect);
    var cx = rect.left + rect.width * 0.5;
    var cy = rect.top + rect.height * 0.5;
    var nx = clamp((pointer.x - cx) / (rect.width * 0.5), -1, 1);
    var ny = clamp((pointer.y - cy) / (rect.height * 0.5), -1, 1);
    var tx = nx * MAX_X;
    var ty = ny * MAX_Y;
    var ts = hovering ? baseScale + HOVER_BONUS : baseScale;
    var moved = false;
    if (Math.abs(tx - pos.x) > EPS) { pos.x += (tx - pos.x) * EASE; moved = true; }
    if (Math.abs(ty - pos.y) > EPS) { pos.y += (ty - pos.y) * EASE; moved = true; }
    if (Math.abs(ts - scale) > 0.0004) { scale += (ts - scale) * EASE; moved = true; }
    if (moved) paint();
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (listening) {
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      listening = false;
    }
    if (hero) {
      hero.removeEventListener("pointerenter", onEnter);
      hero.removeEventListener("pointerleave", onHoverOut);
    }
    if (photo) photo.style.transform = "";
    pos.x = 0;
    pos.y = 0;
    scale = FALLBACK_SCALE;
    baseScale = FALLBACK_SCALE;
    hovering = false;
  }

  function onEnter() {
    hovering = true;
  }

  function onHoverOut() {
    hovering = false;
  }

  function start() {
    hero = document.getElementById("hero");
    photo = hero ? hero.querySelector(".hero-photo") : null;
    if (!hero || !photo) return;
    if (mq("(prefers-reduced-motion: reduce)") || !mq("(hover: hover)")) return;

    var r = hero.getBoundingClientRect();
    if (r.width > 2 && r.height > 2) {
      baseScale = computeBaseScale(r);
      scale = baseScale;
    }
    centerPointer();
    paint();

    window.addEventListener("pointermove", onPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave, { passive: true });
    hero.addEventListener("pointerenter", onEnter);
    hero.addEventListener("pointerleave", onHoverOut);
    listening = true;
    raf = requestAnimationFrame(loop);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.__heroParallaxStop = stop;
})();
