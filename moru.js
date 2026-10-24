/* Moru floating assistant — inspired by ryOS Rover (drag + bubble + /api/chat) */
(function () {
  if (window.__moruMounted) return;
  window.__moruMounted = true;

  const POS_KEY = "ly-moru-pos";
  const TAKEOVER_KEY = "ly-moru-takeover";
  const TAKEOVER_TTL = 20000;
  const THINK_LABEL = "正在思考...";
  const TAKEOVER_LABEL = "正在接管 Moru Studio...";
  const SIZE = () => (window.matchMedia("(max-width: 560px)").matches ? 46 : 50);
  const CLICK_SLOP = 6;
  const MARGIN = 10;

  // 新版本公告：读取线上 manifest，跨域 script（免 CORS），站点和 .dmg 内都可用
  const RELEASE_JS_URL = "https://longying-studio.pages.dev/assets/moru/release.js";
  const RELEASE_SEEN_KEY = "moru.release.seen";

  const root = document.createElement("div");
  root.className = "moru-root";
  root.innerHTML = `
    <div class="moru-bubble" data-side="above" role="dialog" aria-label="Moru 助手">
      <div class="moru-shell moru-shell-open" data-src="assets/moru/chat-open.svg" aria-hidden="true"></div>
      <div class="moru-shell moru-shell-think" data-src="assets/moru/chat-thinking.svg" aria-hidden="true"></div>
      <div class="moru-thinking-label" aria-hidden="true">正在思考...</div>
      <div class="moru-log" id="moruLog"></div>
      <form class="moru-form" id="moruForm">
        <input id="moruInput" type="text" maxlength="500" placeholder="问Moru任何问题" autocomplete="off" aria-label="问Moru任何问题" />
        <button type="submit" id="moruSend" class="moru-send" aria-label="发送"></button>
      </form>
    </div>
    <button class="moru-avatar" type="button" aria-label="打开 Moru 助手" title="Moru">
      <span class="moru-orb" aria-hidden="true">
        <video class="moru-video moru-video-idle moru-video-idle-a" src="assets/moru/orb.mp4" autoplay muted playsinline preload="auto"></video>
        <video class="moru-video moru-video-idle moru-video-idle-b" src="assets/moru/orb-idle-2.mp4" muted playsinline preload="auto"></video>
        <video class="moru-video moru-video-think" src="assets/moru/orb-thinking.mp4" muted loop playsinline preload="auto"></video>
      </span>
    </button>
  `;
  document.body.appendChild(root);

  const bubble = root.querySelector(".moru-bubble");
  const logEl = root.querySelector("#moruLog");
  const form = root.querySelector("#moruForm");
  const input = root.querySelector("#moruInput");
  const sendBtn = root.querySelector("#moruSend");
  const avatar = root.querySelector(".moru-avatar");
  const idleVideos = [
    root.querySelector(".moru-video-idle-a"),
    root.querySelector(".moru-video-idle-b"),
  ].filter(Boolean);
  let idleIndex = 0;
  let videoIdle = idleVideos[0];
  const videoThink = root.querySelector(".moru-video-think");
  const shellThink = root.querySelector(".moru-shell-think");
  const thinkLabel = root.querySelector(".moru-thinking-label");

  // 内联 SVG；思考态标题改用 HTML 扫光，去掉 SVG 里那行静态字形以免叠字
  root.querySelectorAll(".moru-shell[data-src]").forEach((el) => {
    fetch(el.dataset.src)
      .then((r) => r.text())
      .then((svg) => {
        el.innerHTML = svg;
        if (el === shellThink) {
          el.querySelectorAll('path[fill*="paint0_linear"]').forEach((p) => p.remove());
          el.querySelectorAll("linearGradient[id*='paint0_linear']").forEach((g) => g.remove());
          // 停止键改由 HTML 绘制，去掉 SVG 里的发送圆钮和灰箭头，避免叠成两个圆
          el.querySelectorAll('path[fill="#8E9192"], path[fill="#8e9192"]').forEach((p) => p.remove());
          el.querySelectorAll("rect").forEach((r) => {
            const w = Number(r.getAttribute("width"));
            const h = Number(r.getAttribute("height"));
            const rx = Number(r.getAttribute("rx"));
            if (w === 22 && h === 22 && rx === 11) r.remove();
          });
        }
      })
      .catch(() => {});
  });

  function playVideo(el) {
    if (!el) return;
    el.muted = true;
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  function syncOrbVideo() {
    const thinking = root.classList.contains("is-thinking");
    if (thinking) {
      idleVideos.forEach((v) => v.pause());
      playVideo(videoThink);
    } else {
      if (videoThink) videoThink.pause();
      idleVideos.forEach((v) => {
        if (v !== videoIdle) v.pause();
      });
      playVideo(videoIdle);
    }
  }

  // 两段正常态动画交替：一段播完，从头播另一段，再切换显示
  function swapIdleVideo() {
    if (idleVideos.length < 2) {
      if (videoIdle) {
        videoIdle.currentTime = 0;
        if (!root.classList.contains("is-thinking")) playVideo(videoIdle);
      }
      return;
    }
    const prev = videoIdle;
    idleIndex = (idleIndex + 1) % idleVideos.length;
    videoIdle = idleVideos[idleIndex];
    try {
      videoIdle.currentTime = 0;
    } catch (_) {}
    root.classList.toggle("is-idle-b", idleIndex === 1);
    if (!root.classList.contains("is-thinking")) playVideo(videoIdle);
    if (prev && prev !== videoIdle) prev.pause();
  }

  idleVideos.forEach((v) => {
    v.addEventListener("ended", () => {
      if (v === videoIdle) swapIdleVideo();
    });
  });

  playVideo(videoIdle);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncOrbVideo();
  });

  const messages = [];
  let busy = false;
  let greeted = false;
  let chatAbort = null;
  let driveTimer = null;
  let toolsTimer = null;

  function clampPos(x, y) {
    const s = SIZE();
    const maxX = Math.max(MARGIN, window.innerWidth - s - MARGIN);
    const maxY = Math.max(MARGIN, window.innerHeight - s - MARGIN);
    return {
      x: Math.min(maxX, Math.max(MARGIN, x)),
      y: Math.min(maxY, Math.max(MARGIN, y)),
    };
  }

  function loadPos() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.x === "number" && typeof p.y === "number") return clampPos(p.x, p.y);
      }
    } catch (_) {}
    const s = SIZE();
    return clampPos(window.innerWidth - s - 18, window.innerHeight - s - 28);
  }

  function savePos(pos) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch (_) {}
  }

  function applyPos(pos) {
    root.style.left = pos.x + "px";
    root.style.top = pos.y + "px";
    root.style.right = "auto";
    root.style.bottom = "auto";
  }

  function placeBubble() {
    const rect = root.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceLeft = rect.left;
    let side = "above";
    if (spaceAbove < 280 && spaceBelow > spaceAbove) side = "below";
    if (spaceLeft < 320 && rect.right + 320 < window.innerWidth) side = "right";
    else if (spaceLeft >= 320 && spaceAbove < 200 && spaceBelow < 200) side = "left";
    bubble.dataset.side = side;
  }

  let pos = loadPos();
  applyPos(pos);

  // 聊天框只显示当前这一条回答；下一条出来时替换上一条
  function setReply(text) {
    logEl.innerHTML = "";
    const el = document.createElement("div");
    el.className = "moru-msg is-assistant";
    el.textContent = text;
    logEl.appendChild(el);
    logEl.scrollTop = 0;
    return el;
  }

  /* ---- 新版本公告：商店一更新，助手就提示「有新版本，点击链接去下载」 ---- */
  function cmpVersion(a, b) {
    const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  function showUpdateBanner(rel) {
    if (root.querySelector(".moru-update")) return;
    const el = document.createElement("div");
    el.className = "moru-update";
    el.setAttribute("role", "status");

    const text = document.createElement("div");
    text.className = "moru-update-text";
    text.textContent = `🆕 上新啦 v${rel.version}：${rel.note || "点右边下载最新版"}`;

    const link = document.createElement("a");
    link.className = "moru-update-link";
    link.href = rel.dmgUrl || "#";
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "下载新版";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "moru-update-close";
    close.setAttribute("aria-label", "关闭更新提示");
    close.textContent = "×";

    el.appendChild(text);
    el.appendChild(link);
    el.appendChild(close);

    // 放在聊天记录上方；setReply 只清 logEl，不会误删这条公告
    logEl.parentNode.insertBefore(el, logEl);
    root.classList.add("is-update"); // 悬浮球上显示小红点

    const dismiss = () => {
      el.remove();
      root.classList.remove("is-update");
      try { localStorage.setItem(RELEASE_SEEN_KEY, rel.version); } catch (_) {}
    };
    link.addEventListener("click", dismiss);
    close.addEventListener("click", dismiss);
  }

  function checkForUpdate() {
    const s = document.createElement("script");
    s.src = RELEASE_JS_URL + "?t=" + Date.now();
    s.async = true;
    s.onload = () => {
      const rel = window.__MORU_RELEASE__;
      if (!rel || !rel.version) return;
      let seen = null;
      try { seen = localStorage.getItem(RELEASE_SEEN_KEY); } catch (_) {}
      if (!seen) {
        // 第一次来：记下当前版本，不弹（已经是新的）
        try { localStorage.setItem(RELEASE_SEEN_KEY, rel.version); } catch (_) {}
        return;
      }
      if (cmpVersion(rel.version, seen) > 0) showUpdateBanner(rel);
    };
    s.onerror = () => {};
    document.head.appendChild(s);
  }

  function setOpen(open, focus = true) {
    root.classList.toggle("is-open", open);
    if (open) {
      placeBubble();
      if (!greeted) greeted = true;
      // 有对话记录时保持 has-chat；不要在打开时误清掉（终止回复会因此变回问候壳）
      if (messages.length > 0 || (logEl && logEl.textContent.trim())) {
        root.classList.add("has-chat");
      }
      if (focus) setTimeout(() => input.focus(), 40);
    }
  }

  /* ---- 接管态：只在 Moru 前进打开的页面上；一离开最后一页立刻恢复正常 ---- */
  let takeoverSummary = "";
  let moruNavigating = false; // true = 接下来这一跳是 Moru 自己开的

  function syncActionButton() {
    const stopping =
      root.classList.contains("is-thinking") || root.classList.contains("is-takeover");
    sendBtn.disabled = false;
    sendBtn.type = stopping ? "button" : "submit";
    sendBtn.setAttribute("aria-label", stopping ? "停止" : "发送");
    sendBtn.title = stopping ? "停止" : "发送";
  }

  function setTakeover(on) {
    root.classList.toggle("is-takeover", on);
    root.classList.toggle("is-thinking", on);
    thinkLabel.textContent = on ? TAKEOVER_LABEL : THINK_LABEL;
    input.disabled = on;
    if (on) {
      setOpen(true, false);
      root.classList.add("has-chat");
    }
    syncActionButton();
    syncOrbVideo();
  }

  function pagePath(href) {
    try {
      return new URL(href, location.href).pathname.split("/").pop() || "index.html";
    } catch (_) {
      return "";
    }
  }

  function readTakeover() {
    try {
      return JSON.parse(sessionStorage.getItem(TAKEOVER_KEY));
    } catch (_) {
      return null;
    }
  }

  function writeTakeover(state) {
    try {
      sessionStorage.setItem(TAKEOVER_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function clearTakeover() {
    try {
      sessionStorage.removeItem(TAKEOVER_KEY);
    } catch (_) {}
  }

  // remaining：Moru 还要依次打开的页面；sealed 后任何页都不再接管
  function saveTakeover(remaining) {
    writeTakeover({
      t: Date.now(),
      summary: takeoverSummary,
      remaining: remaining || [],
      last: (remaining && remaining.length ? remaining[remaining.length - 1] : pagePath(location.href)),
      sealed: false,
    });
  }

  function sealTakeover(summary) {
    const s = summary || takeoverSummary || "";
    takeoverSummary = s;
    writeTakeover({ t: Date.now(), summary: s, remaining: [], last: "", sealed: true });
    clearPendingAction();
  }

  // 需要先跳页再执行的页面内操作（改购物袋、选支付方式等）
  const PENDING_KEY = "ly-moru-pending";

  function readPendingAction() {
    try {
      return JSON.parse(sessionStorage.getItem(PENDING_KEY));
    } catch (_) {
      return null;
    }
  }

  function writePendingAction(page, tool) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ page, tool }));
    } catch (_) {}
  }

  function clearPendingAction() {
    try {
      sessionStorage.removeItem(PENDING_KEY);
    } catch (_) {}
  }

  function showTakeoverSummary() {
    const summary = takeoverSummary || "搞定啦～";
    if (!messages.length || messages[messages.length - 1].content !== summary) {
      messages.push({ role: "assistant", content: summary });
    }
    setReply(summary);
    root.classList.add("is-open", "has-chat");
    root.classList.remove("is-thinking", "is-takeover");
    try {
      sessionStorage.setItem("ly-moru-last-reply", summary);
    } catch (_) {}
  }

  function endTakeover() {
    sealTakeover(takeoverSummary);
    if (!root.classList.contains("is-takeover")) {
      root.classList.remove("is-thinking");
      syncOrbVideo();
      return;
    }
    setTakeover(false);
    showTakeoverSummary();
  }

  function markStopped() {
    window.__moruStopped = true;
    window.__moruDriving = false;
    moruNavigating = false;
    try {
      sessionStorage.setItem("ly-moru-stopped", "1");
    } catch (_) {}
    if (window.__moruBuyTimer) {
      clearTimeout(window.__moruBuyTimer);
      window.__moruBuyTimer = null;
    }
  }

  function clearStopped() {
    window.__moruStopped = false;
    try {
      sessionStorage.removeItem("ly-moru-stopped");
    } catch (_) {}
  }

  // 用户离开 Moru 路线 / 点终止：立刻停在当前页并同步回复
  function abortTakeover(forcedSummary) {
    if (driveTimer) {
      clearTimeout(driveTimer);
      driveTimer = null;
    }
    if (toolsTimer) {
      clearTimeout(toolsTimer);
      toolsTimer = null;
    }
    markStopped();
    const saved = readTakeover();
    const text =
      forcedSummary ||
      (saved && saved.summary) ||
      takeoverSummary ||
      "已终止任务";
    takeoverSummary = String(text);
    sealTakeover(takeoverSummary);
    // 先写回复再关接管态，避免中间帧回到问候壳
    input.disabled = false;
    root.classList.remove("is-takeover", "is-thinking");
    showTakeoverSummary();
    syncActionButton();
    syncOrbVideo();
    // 若 Shop 已画出跳页黑屏，立刻收掉，留在本页
    if (window.Shop && typeof Shop.hideBoot === "function") {
      try {
        Shop.hideBoot();
      } catch (_) {}
    }
  }

  function stopThinking() {
    if (chatAbort) {
      try {
        chatAbort.abort();
      } catch (_) {}
      chatAbort = null;
    }
    if (toolsTimer) {
      clearTimeout(toolsTimer);
      toolsTimer = null;
    }
    busy = false;
    root.classList.remove("is-thinking");
    syncActionButton();
    syncOrbVideo();
    input.disabled = false;
    sendBtn.disabled = false;
  }

  function stopAction() {
    // 接管中（含等待跳结算）：立刻终止，停在本页并回复
    const saved = readTakeover();
    if (root.classList.contains("is-takeover") || (saved && !saved.sealed)) {
      abortTakeover("已终止任务");
      return;
    }
    if (busy || root.classList.contains("is-thinking")) {
      stopThinking();
    }
  }

  // 页面加载条消失后再停留一下才收尾；最多等 8 秒
  function endTakeoverWhenLoaded(dwell, startedAt = Date.now()) {
    const cur = readTakeover();
    if (cur && cur.sealed) {
      endTakeover();
      return;
    }
    const boot = document.getElementById("boot");
    const loading =
      (boot && !boot.classList.contains("is-out")) ||
      document.documentElement.classList.contains("is-booting");
    if (loading && Date.now() - startedAt < 8000) {
      setTimeout(() => endTakeoverWhenLoaded(dwell, startedAt), 120);
      return;
    }
    setTimeout(endTakeover, dwell);
  }

  function whenPageLoaded(fn, startedAt = Date.now()) {
    const boot = document.getElementById("boot");
    const loading =
      (boot && !boot.classList.contains("is-out")) ||
      document.documentElement.classList.contains("is-booting");
    if (loading && Date.now() - startedAt < 8000) {
      setTimeout(() => whenPageLoaded(fn, startedAt), 120);
      return;
    }
    setTimeout(fn, 500);
  }

  function clickPortfolioWhenLoaded() {
    whenPageLoaded(() => clickPortfolioCard());
  }

  function productName(id) {
    const list = window.Shop && Array.isArray(Shop.products) ? Shop.products : [];
    const hit = list.find((p) => String(p.id) === String(id));
    return hit ? hit.name : "这件宝贝";
  }

  function summarize(name, args, id) {
    const qty = Math.max(1, Math.min(9, Number(args.qty) || 1));
    switch (name) {
      case "buyAndCheckout":
        return `搞定！${productName(id)} ×${qty} 已经带你到结算页，填好地址就能下单～`;
      case "addToCart":
        return `${productName(id)} ×${qty} 已经塞进购物袋啦～`;
      case "openCart":
        return "购物袋给你打开啦，看看还缺点啥？";
      case "openCheckout":
        return "结算页到啦，填好地址就能下单～";
      case "openProduct":
        return `带你去看 ${productName(id)} 啦～`;
      case "openTerms":
        return "购物须知在这儿，慢慢看～";
      case "openHome":
        return "带你回首页啦～";
      case "openPortfolio":
        return "珑瀛的作品集给你打开啦，慢慢逛～";
      case "openOrder":
        return "你最近的订单在这儿～";
      case "showPhoto":
        return "换好图啦，看看喜不喜欢～";
      case "openGallery":
        return "全屏画册打开啦，左右翻着看～";
      case "setCartQty":
        return `${productName(id)} 改成 ${Math.max(0, Number(args.qty) || 0)} 件啦～`;
      case "removeCartItem":
        return `${productName(id)} 已经从购物袋拿掉啦～`;
      case "clearCart":
        return "购物袋清空啦，干干净净～";
      case "choosePayment":
        return `已经帮你选好${args.method === "alipay" ? "支付宝" : "微信支付"}～`;
      case "scrollPage":
        return args.dir === "top" ? "回到顶部啦～" : args.dir === "bottom" ? "到底啦～" : "翻好啦～";
      case "refreshPage":
        return "刷新好啦～";
      case "goBack":
        return "回到上一页啦～";
      default:
        return "";
    }
  }

  // Moru 自己跳下一页时调用，避免 pagehide / shop.navigate 把任务封掉
  function markMoruNavigation(nextRemaining) {
    clearStopped();
    moruNavigating = true;
    window.__moruDriving = true;
    if (Array.isArray(nextRemaining)) saveTakeover(nextRemaining);
    setTimeout(() => {
      window.__moruDriving = false;
    }, 2000);
  }

  function resumeTakeover(fromCache) {
    const saved = readTakeover();
    const here = pagePath(location.href);

    // 已结束 / 过期 / 用户离开过：强制正常态；若有终止回复则补上
    if (!saved || saved.sealed || Date.now() - Number(saved.t) > TAKEOVER_TTL) {
      let last = "";
      try {
        last = sessionStorage.getItem("ly-moru-last-reply") || "";
      } catch (_) {}
      if (saved && saved.summary) takeoverSummary = String(saved.summary);
      else if (last) takeoverSummary = last;
      root.classList.remove("is-takeover", "is-thinking");
      input.disabled = false;
      if (takeoverSummary) {
        showTakeoverSummary();
      } else {
        syncOrbVideo();
        syncActionButton();
      }
      if (saved && (saved.sealed || Date.now() - Number(saved.t) > TAKEOVER_TTL)) {
        // 保留 last-reply，只清接管队列
        clearTakeover();
      }
      return;
    }

    const remaining = Array.isArray(saved.remaining) ? saved.remaining : [];
    // 已在 Moru 的最后一页（load 与 pageshow 会各进一次）：保持接管，等收尾
    if (!remaining.length && saved.last === here) {
      takeoverSummary = String(saved.summary || takeoverSummary || "");
      if (!root.classList.contains("is-takeover")) setTakeover(true);
      return;
    }
    // 只有队列头对得上才推进；对不上时要区分「正在等下一跳」还是「用户跑偏了」
    if (!remaining.length || remaining[0] !== here) {
      // 刚吃掉 product、队列还剩 checkout：pageshow 会再进一次，不能当成失败封存
      // 否则详情页 750ms 后的自动去结算会被 sealed 拦住
      if (remaining.length && (root.classList.contains("is-takeover") || saved.summary)) {
        if (!root.classList.contains("is-takeover")) {
          takeoverSummary = String(saved.summary || "");
          setTakeover(true);
        }
        return;
      }
      abortTakeover();
      return;
    }

    takeoverSummary = String(saved.summary || "");
    setTakeover(true);
    const rest = remaining.slice(1);
    if (rest.length) {
      // 还要继续前进：更新队列，等 Moru 自己再跳（如详情 → 结算）
      writeTakeover({
        t: Date.now(),
        summary: takeoverSummary,
        remaining: rest,
        last: rest[rest.length - 1],
        sealed: false,
      });
    } else {
      // 已到 Moru 点开的最后一页：加载完就结束并封存
      writeTakeover({
        t: Date.now(),
        summary: takeoverSummary,
        remaining: [],
        last: here,
        sealed: false,
      });
      if (location.search.includes(PORTFOLIO_FLAG)) {
        try {
          history.replaceState(history.state, "", location.pathname + location.hash);
        } catch (_) {}
        clickPortfolioWhenLoaded();
        return;
      }
      const pending = readPendingAction();
      if (pending && pending.page === here && pending.tool) {
        clearPendingAction();
        whenPageLoaded(() => runPageAction(pending.tool));
        return;
      }
      endTakeoverWhenLoaded(fromCache ? 400 : 900);
    }
  }

  /* ---- drag ---- */
  let tracking = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let moved = 0;

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    tracking = true;
    dragging = false;
    moved = 0;
    startX = e.clientX;
    startY = e.clientY;
    originX = pos.x;
    originY = pos.y;
    avatar.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!tracking) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    moved = Math.max(moved, Math.hypot(dx, dy));
    if (!dragging && moved > CLICK_SLOP) {
      dragging = true;
      root.classList.add("is-dragging");
      setOpen(false);
    }
    if (dragging) {
      pos = clampPos(originX + dx, originY + dy);
      applyPos(pos);
      e.preventDefault();
    }
  }

  function onPointerUp(e) {
    if (!tracking) return;
    tracking = false;
    if (dragging) {
      dragging = false;
      root.classList.remove("is-dragging");
      savePos(pos);
      placeBubble();
    } else if (moved <= CLICK_SLOP) {
      setOpen(!root.classList.contains("is-open"));
    }
  }

  avatar.addEventListener("pointerdown", onPointerDown);
  avatar.addEventListener("pointermove", onPointerMove);
  avatar.addEventListener("pointerup", onPointerUp);
  avatar.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", () => {
    pos = clampPos(pos.x, pos.y);
    applyPos(pos);
    if (root.classList.contains("is-open")) placeBubble();
  });

  function pageContext() {
    const ctx = {
      path: location.pathname.split("/").pop() || "index.html",
      href: location.href,
      title: document.title,
    };
    const shop = window.Shop;
    if (!shop) return ctx;
    try {
      ctx.cart = shop.cartLines().map(({ product, qty, subtotal }) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        qty,
        subtotal,
      }));
      ctx.cartTotal = shop.cartTotal();
      const order = typeof shop.lastOrder === "function" ? shop.lastOrder() : null;
      if (order && order.no) {
        ctx.lastOrder = {
          no: order.no,
          total: order.total,
          method: (shop.paymentLabels && shop.paymentLabels[order.method]) || order.method,
          createdAt: order.createdAt,
          items: (order.items || []).map((i) => `${i.name}×${i.qty}`),
        };
      }
      const id = Number(new URLSearchParams(location.search).get("id"));
      if ((ctx.path === "index.html" || ctx.path === "product.html") && Number.isFinite(id)) {
        ctx.productId = id;
      }
    } catch (_) {}
    return ctx;
  }

  function resolveProductId(args) {
    if (!args || typeof args !== "object") return null;
    if (args.id != null && args.id !== "") {
      const n = Number(args.id);
      return Number.isFinite(n) ? n : null;
    }
    const q = String(args.name || args.query || "").trim();
    if (!q || !window.Shop || !Array.isArray(Shop.products)) return null;
    const low = q.toLowerCase();
    const hit = Shop.products.find((p) => {
      const name = String(p.name || "");
      const en = String(p.nameEn || "").toLowerCase();
      return name.includes(q) || en.includes(low);
    });
    return hit ? hit.id : null;
  }

  const PAGE_TOOLS = {
    openCart: "cart.html",
    openTerms: "terms.html",
    openCheckout: "checkout.html",
    openHome: "index.html",
    openOrder: "order.html",
  };

  // 页面内操作：值为必须所在的页面；null = 当前页即可
  const PAGE_ACTIONS = {
    showPhoto: null,
    openGallery: "index.html",
    setCartQty: "cart.html",
    removeCartItem: "cart.html",
    clearCart: "cart.html",
    choosePayment: "checkout.html",
    scrollPage: null,
    refreshPage: null,
    goBack: null,
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 接管态下「按」一下页面上的按钮：先滚到可见、亮一下，再点击
  async function pressEl(el) {
    if (!el || isStopped()) return false;
    try {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    } catch (_) {}
    await wait(260);
    if (isStopped()) return false;
    el.classList.add("is-moru-press");
    await wait(260);
    el.classList.remove("is-moru-press");
    if (isStopped()) return false;
    el.click();
    return true;
  }

  function scrollTarget() {
    const candidates = [
      document.getElementById("cards"),
      document.querySelector(".page"),
      document.querySelector("main"),
    ];
    for (const el of candidates) {
      if (!el) continue;
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 10) return el;
    }
    return document.scrollingElement || document.documentElement;
  }

  async function runPageAction(tool) {
    const name = tool.name;
    const args = tool.args || {};
    const id = tool.id != null ? tool.id : resolveProductId(args);
    const here = pagePath(location.href);
    if (isStopped()) return;
    setTakeover(true);

    if (name === "refreshPage") {
      endTakeover();
      setTimeout(() => location.reload(), 300);
      return;
    }
    if (name === "goBack") {
      endTakeover();
      setTimeout(() => {
        if (history.length > 1) history.back();
        else if (window.Shop) Shop.navigate("index.html");
      }, 300);
      return;
    }

    if (name === "showPhoto") {
      const prev = args.dir === "prev";
      const steps = Math.max(1, Math.min(9, Number(args.steps) || 1));
      let btn = null;
      if (here === "index.html") {
        const lightbox = document.getElementById("lightbox");
        if (lightbox && !lightbox.classList.contains("open")) {
          await pressEl(document.getElementById("hero"));
          await wait(450);
        }
        btn = document.getElementById(prev ? "lbPrev" : "lbNext");
      }
      for (let i = 0; i < steps && btn; i++) {
        if (!(await pressEl(btn))) return;
        await wait(380);
      }
    } else if (name === "openGallery") {
      if (id != null) {
        const card = document.querySelector(`.card[data-id="${id}"]`);
        if (card) {
          await pressEl(card);
          await wait(450);
        }
      }
      await pressEl(document.getElementById("hero"));
    } else if (name === "setCartQty") {
      const target = Math.max(0, Math.min(99, Math.round(Number(args.qty) || 0)));
      const line = window.Shop && Shop.cartLines().find((l) => l.product.id === id);
      if (!line) {
        takeoverSummary = `购物袋里还没有${productName(id)}哦～`;
      } else if (target === 0) {
        await pressEl(document.querySelector(`[data-action="remove"][data-id="${id}"]`));
      } else {
        let guard = 0;
        while (guard++ < 99) {
          const cur = Shop.cartLines().find((l) => l.product.id === id);
          if (!cur || cur.qty === target) break;
          const action = cur.qty < target ? "inc" : "dec";
          const ok = await pressEl(document.querySelector(`[data-action="${action}"][data-id="${id}"]`));
          if (!ok) return;
          await wait(120);
        }
      }
    } else if (name === "removeCartItem") {
      const btn = document.querySelector(`[data-action="remove"][data-id="${id}"]`);
      if (btn) await pressEl(btn);
      else takeoverSummary = `购物袋里没有${productName(id)}哦～`;
    } else if (name === "clearCart") {
      const btn = document.getElementById("clear");
      if (window.Shop && Shop.cartLines().length && btn) await pressEl(btn);
      else takeoverSummary = "购物袋本来就是空的哦～";
    } else if (name === "choosePayment") {
      const method = args.method === "alipay" ? "alipay" : "wechat";
      await pressEl(document.querySelector(`.pay[data-method="${method}"]`));
    } else if (name === "scrollPage") {
      const el = scrollTarget();
      const isRoot = el === document.scrollingElement || el === document.documentElement;
      const view = isRoot ? window.innerHeight : el.clientHeight;
      const opts = { behavior: "smooth" };
      if (args.dir === "top") el.scrollTo({ top: 0, ...opts });
      else if (args.dir === "bottom") el.scrollTo({ top: el.scrollHeight, ...opts });
      else el.scrollBy({ top: (args.dir === "up" ? -1 : 1) * view * 0.8, ...opts });
    }

    await wait(700);
    if (!isStopped()) endTakeover();
  }

  const PORTFOLIO_URL = (window.Shop && window.Shop.portfolioUrl) || "https://zhanglongying.pages.dev";
  const PORTFOLIO_FLAG = "moruOpen=portfolio";

  function portfolioCard() {
    return document.querySelector('a.card[href*="zhanglongying"]');
  }

  function isStopped() {
    return window.__moruStopped || sessionStorage.getItem("ly-moru-stopped") === "1";
  }

  // 接管态下滚到作品集卡片、按下它，再打开作品集
  function clickPortfolioCard(startedAt = Date.now()) {
    if (isStopped()) return;
    const card = portfolioCard();
    if (!card) {
      if (Date.now() - startedAt < 6000) {
        setTimeout(() => clickPortfolioCard(startedAt), 150);
      } else {
        openExternal(PORTFOLIO_URL);
      }
      return;
    }
    card.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    setTimeout(() => {
      if (isStopped()) return;
      card.classList.add("is-moru-press");
      setTimeout(() => {
        card.classList.remove("is-moru-press");
        if (isStopped()) return;
        openExternal(card.href || PORTFOLIO_URL);
      }, 420);
    }, 650);
  }

  // 站外页面没有 Moru：先收尾接管再打开；新标签被拦就在本页跳
  function openExternal(url) {
    endTakeover();
    let win = null;
    try {
      win = window.open(url, "_blank");
    } catch (_) {}
    if (win) {
      try {
        win.opener = null;
      } catch (_) {}
    } else {
      location.href = url;
    }
  }

  function planTools(tools) {
    const shop = window.Shop;
    const plan = [];
    tools.forEach((tool) => {
      const name = tool && tool.name;
      const args = (tool && tool.args) || {};
      const qty = Math.max(1, Math.min(9, Number(args.qty) || 1));
      if (name === "addToCart" || name === "buyAndCheckout") {
        const id = resolveProductId(args);
        if (id == null || !shop || typeof shop.addToCart !== "function") return;
        const step = { name, args, id, qty };
        if (name === "buyAndCheckout") step.href = "checkout.html";
        plan.push(step);
      } else if (name === "openProduct") {
        const id = resolveProductId(args);
        if (id != null) {
          plan.push({
            name,
            args,
            id,
            href: "index.html?id=" + encodeURIComponent(id),
          });
        }
      } else if (PAGE_TOOLS[name]) {
        plan.push({ name, args, href: PAGE_TOOLS[name] });
      } else if (name === "openPortfolio") {
        // 本页有作品集卡片就直接点；否则先回首页再点
        if (portfolioCard()) plan.push({ name, args, portfolio: true });
        else plan.push({ name, args, href: "index.html?" + PORTFOLIO_FLAG });
      } else if (Object.prototype.hasOwnProperty.call(PAGE_ACTIONS, name)) {
        const id = resolveProductId(args);
        const here = pagePath(location.href);
        let page = PAGE_ACTIONS[name];
        let href = page;
        if (name === "showPhoto" && here !== "index.html") {
          // 不在首页：有指定商品就回首页画册翻图
          if (id == null) return;
          page = "index.html";
          href = "index.html?id=" + encodeURIComponent(id);
        }
        if ((name === "setCartQty" || name === "removeCartItem") && id == null) return;
        plan.push({ name, args, id, action: true, page: page && page !== here ? page : null, href });
      }
    });
    return plan;
  }

  function runClientTools(tools) {
    if (!Array.isArray(tools) || !tools.length) return false;
    const plan = planTools(tools);
    if (!plan.length) return false;
    const shop = window.Shop;

    const lines = plan.map((step) => summarize(step.name, step.args, step.id)).filter(Boolean);
    takeoverSummary =
      lines.length > 1 ? lines[0].replace(/[～~！!。]*$/, "，") + lines[lines.length - 1] : lines[0] || "";
    setTakeover(true);

    let navigateTo = null;
    let portfolioHere = false;
    let actionStep = null;
    plan.forEach((step) => {
      if (step.name === "addToCart" || step.name === "buyAndCheckout") {
        shop.addToCart(step.id, step.qty);
        if (step.name === "addToCart") {
          if (typeof shop.addedNotice === "function") shop.addedNotice();
          else if (typeof shop.refreshCount === "function") shop.refreshCount();
        }
        if (step.href) navigateTo = step.href;
      } else if (step.portfolio) {
        portfolioHere = true;
      } else if (step.action) {
        if (!actionStep) actionStep = step;
      } else if (step.href) {
        navigateTo = step.href;
      }
    });

    if (actionStep && actionStep.name === "choosePayment" && shop && !shop.cartLines().length) {
      takeoverSummary = "购物袋还是空的，先挑点东西再结算吧～";
      driveTimer = setTimeout(endTakeover, 900);
      return true;
    }

    if (actionStep) {
      clearStopped();
      const tool = { name: actionStep.name, args: actionStep.args, id: actionStep.id };
      if (!actionStep.page) {
        saveTakeover([]);
        driveTimer = setTimeout(() => {
          driveTimer = null;
          runPageAction(tool);
        }, 500);
        return true;
      }
      // 先跳到需要的页面，落地后由 resumeTakeover 接着执行
      writePendingAction(actionStep.page, tool);
      navigateTo = actionStep.href;
    }

    if (portfolioHere) {
      clearStopped();
      saveTakeover([]);
      driveTimer = setTimeout(() => {
        driveTimer = null;
        clickPortfolioCard();
      }, 500);
      return true;
    }

    if (!navigateTo) {
      driveTimer = setTimeout(endTakeover, 1600);
      return true;
    }
    const remaining = [pagePath(navigateTo)];
    markMoruNavigation(remaining);
    driveTimer = setTimeout(() => {
      driveTimer = null;
      if (window.__moruStopped || sessionStorage.getItem("ly-moru-stopped") === "1") return;
      const st = readTakeover();
      if (st && st.sealed) return;
      if (shop && typeof shop.navigate === "function") shop.navigate(navigateTo);
      else location.href = navigateTo;
    }, 900);
    return true;
  }

  const PRODUCT_WORDS = ["香片", "帆布袋", "马克杯", "帆布帽", "雪梨纸"];
  const CN_DIGITS = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

  function mentionedProductId(text) {
    const list = (window.Shop && Shop.products) || [];
    const low = text.toLowerCase();
    const hits = list.filter((p) => {
      const name = String(p.name || "");
      const en = String(p.nameEn || "").toLowerCase();
      return PRODUCT_WORDS.some((w) => text.includes(w) && name.includes(w)) || (en.length > 2 && low.includes(en));
    });
    return hits.length === 1 ? hits[0].id : null;
  }

  function parseCount(text) {
    const d = text.match(/(\d+)\s*(?:个|件|份|只|顶|张|包)?/);
    if (d) return Number(d[1]);
    const cn = text.match(/(?:改成|改为|变成|换成|留)\s*([零一两二三四五六七八九十])/);
    return cn ? CN_DIGITS[cn[1]] : null;
  }

  // 只认意思很明确的操作口令；其余交给大模型
  function localIntent(text) {
    const t = text.replace(/\s+/g, "");
    const id = mentionedProductId(t);
    if (/^(帮我|请|麻烦)?刷新(一下|页面)?/.test(t)) return { name: "refreshPage" };
    if (/^(帮我)?(返回|回到)?上一页|^返回$/.test(t)) return { name: "goBack" };
    if (/回到顶部|回顶部|到顶部/.test(t)) return { name: "scrollPage", args: { dir: "top" } };
    if (/(滑|翻|拉)到底|到最底|最下面/.test(t)) return { name: "scrollPage", args: { dir: "bottom" } };
    if (/^(帮我)?(往下|向下)(翻|滑|滚)/.test(t)) return { name: "scrollPage", args: { dir: "down" } };
    if (/^(帮我)?(往上|向上)(翻|滑|滚)/.test(t)) return { name: "scrollPage", args: { dir: "up" } };
    if (/清空(一下)?(购物袋|购物车)|(购物袋|购物车)(全部)?清空/.test(t)) return { name: "clearCart" };
    if (/(删掉|删除|去掉|拿掉|移除|不要了)/.test(t) && /(购物袋|购物车|删|拿掉|去掉|移除)/.test(t) && id != null) {
      return { name: "removeCartItem", args: { id } };
    }
    const count = parseCount(t);
    if (/(改成|改为|变成|换成)/.test(t) && id != null && count != null && /(个|件|份|只|顶|张|包|\d)/.test(t)) {
      return { name: "setCartQty", args: { id, qty: count } };
    }
    if (/(用|选|换成|改成|切换)/.test(t) && /支付宝/.test(t)) return { name: "choosePayment", args: { method: "alipay" } };
    if (/(用|选|换成|改成|切换)/.test(t) && /微信/.test(t)) return { name: "choosePayment", args: { method: "wechat" } };
    if (/^(打开|看看?)?(全屏)?画册|全屏(看|打开)/.test(t)) return { name: "openGallery", args: id != null ? { id } : {} };
    if (/^(下一张|上一张)$|换(一)?张图/.test(t)) {
      return { name: "showPhoto", args: { dir: t.includes("上一张") ? "prev" : "next" } };
    }
    return null;
  }

  async function sendMessage(text) {
    const content = String(text || "").trim();
    if (!content || busy || root.classList.contains("is-takeover")) return;
    busy = true;
    logEl.innerHTML = "";
    root.classList.add("has-chat", "is-thinking");
    syncActionButton();
    syncOrbVideo();
    messages.push({ role: "user", content });
    let replyEl = null;
    let stopped = false;
    chatAbort = typeof AbortController !== "undefined" ? new AbortController() : null;

    // 明确的操作口令直接在前端执行，不让大模型「推脱」
    const direct = localIntent(content);
    if (direct) {
      const signal = chatAbort && chatAbort.signal;
      await wait(450);
      if (signal && signal.aborted) {
        if (messages.length && messages[messages.length - 1].role === "user") messages.pop();
        return;
      }
      if (runClientTools([direct])) {
        messages.push({ role: "assistant", content: takeoverSummary || "好～" });
        busy = false;
        chatAbort = null;
        syncActionButton();
        return;
      }
    }

    try {
      const res = await fetch("/api/moru/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.slice(-16),
          pageContext: pageContext(),
        }),
        signal: chatAbort ? chatAbort.signal : undefined,
      });
      const contentType = res.headers.get("content-type") || "";
      // 限流等：JSON { message }，不走 SSE
      if (contentType.includes("application/json") || !res.ok) {
        const err = await res.json().catch(() => ({}));
        const tip = err.message || err.error || ("HTTP " + res.status);
        setReply(tip);
        // 限流提示不算一次成功对话进历史
        if (messages.length && messages[messages.length - 1].role === "user") {
          messages.pop();
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      let tools = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          let evt;
          try {
            evt = JSON.parse(payload);
          } catch (_) {
            continue;
          }
          if (evt.type === "text" && evt.text) {
            if (!replyEl) replyEl = setReply("");
            full += evt.text;
            replyEl.textContent = full;
          } else if (evt.type === "tools" && Array.isArray(evt.tools)) {
            tools = evt.tools;
          } else if (evt.type === "error") {
            throw new Error(evt.error || "对话失败");
          }
        }
      }

      full = full.replace(/(?:^|\n)TOOL\s+\[[\s\S]*$/m, "").trim();
      // 大模型偶尔只答话不出 TOOL：用户明确要看作品集时前端补上
      if (
        !tools.length &&
        /作品集|珑瀛|portfolio/i.test(content) &&
        /打开|点开|看|去|带|进|open|show/i.test(content)
      ) {
        tools = [{ name: "openPortfolio" }];
      }
      if (full) messages.push({ role: "assistant", content: full });
      // 有操作：思考态直接切到接管态，不露出中间的回答；结束时再给总结
      if (tools.length && runClientTools(tools)) {
        logEl.innerHTML = "";
      } else if (!full) {
        setReply("嗯……我这会儿没想出话，再问一次试试？");
      } else if (replyEl) {
        replyEl.textContent = full;
      } else {
        setReply(full);
      }
    } catch (err) {
      if (err && (err.name === "AbortError" || /abort/i.test(String(err.message || "")))) {
        stopped = true;
        if (messages.length && messages[messages.length - 1].role === "user") {
          messages.pop();
        }
        logEl.innerHTML = "";
        root.classList.remove("has-chat");
      } else {
        setReply("连不上助手服务：" + (err.message || err));
      }
    } finally {
      busy = false;
      chatAbort = null;
      if (!root.classList.contains("is-takeover")) {
        root.classList.remove("is-thinking");
      }
      syncActionButton();
      syncOrbVideo();
      if (!stopped) input.focus();
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (
      root.classList.contains("is-thinking") ||
      root.classList.contains("is-takeover") ||
      busy
    ) {
      stopAction();
      return;
    }
    const text = input.value;
    input.value = "";
    sendMessage(text);
  });

  sendBtn.addEventListener("click", (e) => {
    if (
      root.classList.contains("is-thinking") ||
      root.classList.contains("is-takeover") ||
      busy
    ) {
      e.preventDefault();
      e.stopPropagation();
      stopAction();
    }
  });

  // 用户一点返回/离开：先封存任务，离开最后一页后任何页面都不再接管
  window.addEventListener("popstate", abortTakeover);
  window.addEventListener("pagehide", () => {
    if (moruNavigating) {
      moruNavigating = false;
      return;
    }
    const saved = readTakeover();
    if (root.classList.contains("is-takeover") || (saved && !saved.sealed)) {
      abortTakeover();
    }
  });
  window.addEventListener("pageshow", (e) => resumeTakeover(!!e.persisted));

  // 给店铺返回键 / 代购跳转用
  window.__moruAbortTakeover = abortTakeover;
  window.__moruDriveTo = function (nextPage) {
    const saved = readTakeover();
    const next = pagePath(nextPage);
    const rest = saved && Array.isArray(saved.remaining) ? saved.remaining.slice() : [];
    // 队列头若已是下一页就原样前进；否则补成只含下一页（最后一跳）
    const remaining = rest[0] === next ? rest : [next];
    markMoruNavigation(remaining);
  };

  // 打开页面时检查新版本，有更新就让助手弹出「下载新版」
  checkForUpdate();

  resumeTakeover(false);
})();
