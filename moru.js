/* Moru floating assistant — inspired by ryOS Rover (drag + bubble + /api/chat) */
(function () {
  if (window.__moruMounted) return;
  window.__moruMounted = true;

  const POS_KEY = "ly-moru-pos";
  const TAKEOVER_KEY = "ly-moru-takeover";
  const TAKEOVER_TTL = 20000;
  const THINK_LABEL = "正在思考...";
  const TAKEOVER_LABEL = "正在接管LONGYING-STUDIO...";
  const SIZE = () => (window.matchMedia("(max-width: 560px)").matches ? 46 : 50);
  const CLICK_SLOP = 6;
  const MARGIN = 10;

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
        <video class="moru-video moru-video-idle" src="assets/moru/orb.mp4" autoplay muted loop playsinline preload="auto"></video>
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
  const videoIdle = root.querySelector(".moru-video-idle");
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
      if (videoIdle) videoIdle.pause();
      playVideo(videoThink);
    } else {
      if (videoThink) videoThink.pause();
      playVideo(videoIdle);
    }
  }

  playVideo(videoIdle);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncOrbVideo();
  });

  const messages = [];
  let busy = false;
  let greeted = false;

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

  function setOpen(open, focus = true) {
    root.classList.toggle("is-open", open);
    if (open) {
      placeBubble();
      if (!greeted) greeted = true;
      root.classList.toggle("has-chat", messages.length > 0);
      if (focus) setTimeout(() => input.focus(), 40);
    }
  }

  /* ---- 接管态：Moru 自动操作网站时，聊天框四周白光呼吸 ---- */
  let takeoverSummary = "";

  function setTakeover(on) {
    root.classList.toggle("is-takeover", on);
    root.classList.toggle("is-thinking", on);
    thinkLabel.textContent = on ? TAKEOVER_LABEL : THINK_LABEL;
    sendBtn.disabled = on;
    input.disabled = on;
    if (on) {
      setOpen(true, false);
      root.classList.add("has-chat");
    }
    syncOrbVideo();
  }

  function pagePath(href) {
    try {
      return new URL(href, location.href).pathname.split("/").pop() || "index.html";
    } catch (_) {
      return "";
    }
  }

  function clearTakeover() {
    try {
      sessionStorage.removeItem(TAKEOVER_KEY);
    } catch (_) {}
  }

  // expect：Moru 接下来会依次打开的页面；只有落在这些页面上才延续接管态
  function saveTakeover(expect) {
    try {
      sessionStorage.setItem(
        TAKEOVER_KEY,
        JSON.stringify({ t: Date.now(), summary: takeoverSummary, expect }),
      );
    } catch (_) {}
  }

  function endTakeover() {
    clearTakeover();
    if (!root.classList.contains("is-takeover")) return;
    setTakeover(false);
    const summary = takeoverSummary || "搞定啦～";
    messages.push({ role: "assistant", content: summary });
    setReply(summary);
    root.classList.add("has-chat");
  }

  // 页面加载条消失后再停留一下才收尾；最多等 8 秒，避免卡在接管态
  function endTakeoverWhenLoaded(dwell, startedAt = Date.now()) {
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
        return `${productName(id)} 的详情在这儿啦～`;
      case "openTerms":
        return "购物须知在这儿，慢慢看～";
      case "openHome":
        return "带你回首页啦～";
      default:
        return "";
    }
  }

  function resumeTakeover() {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(TAKEOVER_KEY));
    } catch (_) {}
    const expect = saved && Array.isArray(saved.expect) ? saved.expect : [];
    // 过期、或这一页不是 Moru 要去的那页（比如用户自己点回首页）：不接管
    if (
      !saved ||
      Date.now() - Number(saved.t) > TAKEOVER_TTL ||
      expect[0] !== pagePath(location.href)
    ) {
      clearTakeover();
      return;
    }
    takeoverSummary = String(saved.summary || "");
    setTakeover(true);
    const rest = expect.slice(1);
    if (rest.length) saveTakeover(rest);
    else endTakeoverWhenLoaded(900);
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
    return {
      path: location.pathname.split("/").pop() || "index.html",
      href: location.href,
      title: document.title,
    };
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
  };

  function planTools(tools) {
    const shop = window.Shop;
    const plan = [];
    tools.forEach((tool) => {
      const name = tool && tool.name;
      const args = (tool && tool.args) || {};
      const qty = Math.max(1, Math.min(9, Number(args.qty) || 1));
      if (name === "addToCart") {
        const id = resolveProductId(args);
        if (id == null || !shop || typeof shop.addToCart !== "function") return;
        plan.push({ name, args, id, qty });
      } else if (name === "buyAndCheckout") {
        // 打开商品详情 → 自动点「确认支付」→ 结算填地址
        const id = resolveProductId(args);
        if (id == null) return;
        const href =
          "product.html?id=" + encodeURIComponent(id) + "&moruBuy=1&qty=" + encodeURIComponent(qty);
        plan.push({ name, args, id, href });
      } else if (name === "openProduct") {
        const id = resolveProductId(args);
        if (id != null) plan.push({ name, args, id, href: "product.html?id=" + encodeURIComponent(id) });
      } else if (PAGE_TOOLS[name]) {
        plan.push({ name, args, href: PAGE_TOOLS[name] });
      }
    });
    return plan;
  }

  function runClientTools(tools) {
    if (!Array.isArray(tools) || !tools.length) return;
    const plan = planTools(tools);
    if (!plan.length) return;
    const shop = window.Shop;

    const lines = plan.map((step) => summarize(step.name, step.args, step.id)).filter(Boolean);
    takeoverSummary =
      lines.length > 1 ? lines[0].replace(/[～~！!。]*$/, "，") + lines[lines.length - 1] : lines[0] || "";
    setTakeover(true);

    let navigateTo = null;
    plan.forEach((step) => {
      if (step.name === "addToCart") {
        shop.addToCart(step.id, step.qty);
        if (typeof shop.addedNotice === "function") shop.addedNotice();
        else if (typeof shop.refreshCount === "function") shop.refreshCount();
      } else if (step.href) {
        navigateTo = step.href;
      }
    });

    if (!navigateTo) {
      setTimeout(endTakeover, 1600);
      return;
    }
    const expect = [pagePath(navigateTo)];
    // 详情页代购会自己跳去结算，接管态延续到结算页
    if (/[?&]moruBuy=1(?:&|$)/.test(navigateTo)) expect.push("checkout.html");
    saveTakeover(expect);
    setTimeout(() => {
      if (shop && typeof shop.navigate === "function") shop.navigate(navigateTo);
      else location.href = navigateTo;
    }, 900);
  }

  async function sendMessage(text) {
    const content = String(text || "").trim();
    if (!content || busy || root.classList.contains("is-takeover")) return;
    busy = true;
    sendBtn.disabled = true;
    logEl.innerHTML = "";
    root.classList.add("has-chat", "is-thinking");
    syncOrbVideo();
    messages.push({ role: "user", content });
    let replyEl = null;

    try {
      const res = await fetch("/api/moru/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.slice(-16),
          pageContext: pageContext(),
        }),
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
      if (!full) {
        setReply("嗯……我这会儿没想出话，再问一次试试？");
      } else {
        if (replyEl) replyEl.textContent = full;
        else setReply(full);
        messages.push({ role: "assistant", content: full });
        if (tools.length) {
          setTimeout(() => runClientTools(tools), 900);
        }
      }
    } catch (err) {
      setReply("连不上助手服务：" + (err.message || err));
    } finally {
      busy = false;
      root.classList.remove("is-thinking");
      syncOrbVideo();
      sendBtn.disabled = false;
      input.focus();
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = "";
    sendMessage(text);
  });

  resumeTakeover();
})();
