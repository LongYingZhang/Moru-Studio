(function () {
  const DEFAULT_PRODUCTS = [
    {
      id: 0,
      no: "NO. 01",
      name: "Moru香片",
      nameEn: "MORU SACHET",
      detailEn: "Moru sachet",
      price: 38,
      desc: "粗野主义哑光黑色陶瓷小雕塑，尖锐折角与多孔矿物肌理静置，香气四溢",
      dimension: "320 × 180 × 420 毫米",
      material: "纯黑多孔陶土 / 天然石墨黑曜岩",
      weight: "8.40 千克 // 限量 08 件（手工雕凿）",
      lineSpec: "哑光碳树脂 / 标准版",
      image: "assets/sachet.jpg",
      cardBg: "#F1F1F1",
      cardImage: "assets/cards/01.jpg",
      cardPhoto: "left:27.7182%;top:0%;width:72.2818%;height:100%",
      heroPosition: "center 20%"
    },
    {
      id: 1,
      no: "NO. 02",
      name: "Moru帆布袋",
      nameEn: "CANVAS BAG",
      price: 38,
      dimension: "480 × 520 × 140 毫米",
      material: "24安重磅原胚棉帆布 / 四本针立体包缝",
      image: "assets/tote.jpg",
      cardBg: "#F8F7F5",
      cardImage: "assets/cards/02.jpg",
      cardPhoto: "left:27.7901%;top:-44.9294%;width:74.5337%;height:184.7484%",
      heroPosition: "center center"
    },
    {
      id: 2,
      no: "NO. 03",
      name: "Moru马克杯",
      nameEn: "MORU MUG",
      price: 38,
      image: "assets/mug.jpg",
      cardBg: "#F3F3F1",
      cardImage: "assets/cards/03.jpg",
      cardPhoto: "left:20.8359%;top:-9.0098%;width:82.5843%;height:114.2532%",
      heroPosition: "center center"
    },
    {
      id: 3,
      no: "NO. 04",
      name: "Moru帆布帽",
      nameEn: "MORU CANVASCAP",
      price: 38,
      image: "assets/cap.jpg",
      cardBg: "#F7F7F7",
      cardImage: "assets/cards/04.jpg",
      cardPhoto: "left:23.1178%;top:-6.3643%;width:76.8820%;height:106.3644%",
      heroPosition: "center center"
    },
    {
      id: 4,
      no: "NO. 05",
      name: "Moru雪梨纸",
      nameEn: "MORU TISSUE PAPER",
      price: 38,
      image: "assets/tissue.jpg",
      cardBg: "#141414",
      cardInk: "light",
      cardImage: "assets/cards/05.jpg",
      cardPhoto: "left:0%;top:-126.9500%;width:100%;height:247.8723%",
      heroPosition: "center center"
    }
  ];

  const PRODUCTS_KEY = "ly-shop-products-v1";
  const CART_KEY = "ly-shop-cart";
  const MAX_QTY = 99;

  const PAYMENT_LABELS = { wechat: "微信支付", alipay: "支付宝", card: "银联 / 卡" };
  // 留空时，页面上所有联系方式行都会隐藏
  const CONTACT = "";
  const LAST_ORDER_KEY = "ly-shop-last-order";

  function read(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function normalizeProduct(product, index) {
    const id = Number(product.id);
    const image = product.image || "";
    const preset = !product.cardFace && DEFAULT_PRODUCTS.find((p) => p.id === id);
    if (preset && (!product.cardImage || product.cardImage === preset.cardImage)) {
      product = {
        ...product,
        cardBg: preset.cardBg,
        cardImage: preset.cardImage,
        cardFace: preset.cardFace,
        cardPhoto: preset.cardPhoto
      };
    }
    return {
      ...product,
      id: Number.isFinite(id) ? id : index,
      no: product.no || "NO. " + String(index + 1).padStart(2, "0"),
      name: product.name || "未命名商品",
      nameEn: product.nameEn || "LONGYING OBJECT",
      detailEn: product.detailEn || product.nameEn || "Longying object",
      price: Number(product.price) || 0,
      desc: product.desc || product.description || "",
      dimension: product.dimension || product.dimensions || "",
      material: product.material || "",
      status: product.status === "inactive" ? "inactive" : "active",
      image,
      images: [image]
        .concat(Array.isArray(product.gallery) ? product.gallery : [])
        .filter((src) => typeof src === "string" && src)
        .slice(0, 4),
      cardBg: product.cardBg || "#F3F3F1",
      cardInk: product.cardInk === "light" || product.cardInk === "dark" ? product.cardInk : "",
      cardImage: product.cardImage || image,
      cardFace: product.cardFace || "",
      cardPhoto:
        product.cardPhoto ||
        "left:0%;top:0%;width:100%;height:100%;background-size:cover",
      heroPosition: product.heroPosition || "center center"
    };
  }

  const PRODUCTS_API = "/api/products";
  const PORTFOLIO_URL = "https://zhanglongying.pages.dev";
  let serverSnapshot = null;

  function parseProducts(text) {
    try {
      const value = JSON.parse(text);
      return Array.isArray(value) ? value : null;
    } catch (e) {
      return null;
    }
  }

  function remember(value) {
    serverSnapshot = JSON.stringify(value);
    try {
      localStorage.setItem(PRODUCTS_KEY, serverSnapshot);
    } catch (e) {
      try { localStorage.removeItem(PRODUCTS_KEY); } catch (_) {}
    }
  }

  function checkServerProducts() {
    if (document.hidden) return;
    fetch(PRODUCTS_API, { cache: "no-cache" })
      .then((response) => (response.ok ? response.text() : null))
      .then((text) => {
        const value = parseProducts(text);
        if (!value || JSON.stringify(value) === serverSnapshot) return;
        remember(value);
        location.reload();
      })
      .catch(() => {});
  }

  function watchServerProducts() {
    if (serverSnapshot == null) return;
    checkServerProducts();
    setInterval(checkServerProducts, 20000);
  }

  function loadProducts() {
    let cachedText = null;
    try { cachedText = localStorage.getItem(PRODUCTS_KEY); } catch (e) {}
    const cached = parseProducts(cachedText);
    if (cached) {
      serverSnapshot = JSON.stringify(cached);
      return cached.map(normalizeProduct);
    }
    serverSnapshot = JSON.stringify(DEFAULT_PRODUCTS);
    return DEFAULT_PRODUCTS.map(normalizeProduct);
  }

  function saveProducts(nextProducts) {
    write(PRODUCTS_KEY, nextProducts.map(normalizeProduct));
  }

  const ALL_PRODUCTS = loadProducts();
  const PRODUCTS = ALL_PRODUCTS.filter((product) => product.status === "active");

  function getProduct(id) {
    return PRODUCTS.find((p) => p.id === Number(id)) || null;
  }

  function getCart() {
    const cart = read(CART_KEY, []);
    if (!Array.isArray(cart)) return [];
    return cart.filter((line) => getProduct(line.id) && line.qty > 0);
  }

  function saveCart(cart) {
    write(CART_KEY, cart);
    refreshCount();
  }

  function addToCart(id, qty) {
    const cart = getCart();
    const line = cart.find((l) => l.id === Number(id));
    const amount = qty || 1;
    if (line) line.qty = Math.min(MAX_QTY, line.qty + amount);
    else cart.push({ id: Number(id), qty: Math.min(MAX_QTY, amount) });
    saveCart(cart);
  }

  function setQty(id, qty) {
    const cart = getCart();
    const line = cart.find((l) => l.id === Number(id));
    if (!line) return;
    line.qty = Math.max(1, Math.min(MAX_QTY, qty));
    saveCart(cart);
  }

  function removeFromCart(id) {
    saveCart(getCart().filter((l) => l.id !== Number(id)));
  }

  function clearCart() {
    saveCart([]);
  }

  function cartLines() {
    return getCart().map((line) => {
      const product = getProduct(line.id);
      return { product, qty: line.qty, subtotal: product.price * line.qty };
    });
  }

  function cartCount() {
    return getCart().reduce((sum, l) => sum + l.qty, 0);
  }

  function cartTotal() {
    return cartLines().reduce((sum, l) => sum + l.subtotal, 0);
  }

  function formatPrice(amount, withDecimals) {
    return "¥" + amount.toLocaleString("zh-CN", {
      minimumFractionDigits: withDecimals ? 2 : 0,
      maximumFractionDigits: withDecimals ? 2 : 0
    });
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function refreshCount() {
    const count = pad(cartCount());
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = count;
    });
  }

  function lineSpec(product) {
    return product.lineSpec || product.material || product.nameEn || "";
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  let addedTimer = 0;
  function addedNotice() {
    const toast = document.getElementById("addedToast");
    if (!toast) return;
    toast.textContent = "已加入购物袋 // 共 " + pad(cartCount()) + " 件";
    toast.setAttribute("aria-hidden", "false");
    const staying = toast.classList.contains("is-on");
    toast.classList.add("is-on");
    clearTimeout(addedTimer);
    addedTimer = setTimeout(() => {
      toast.classList.remove("is-on");
      toast.setAttribute("aria-hidden", "true");
    }, staying ? 2000 : 2400);
  }

  function saveLastOrder(order) {
    try { sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(order)); } catch (_) {}
  }

  function lastOrder() {
    try { return JSON.parse(sessionStorage.getItem(LAST_ORDER_KEY)); } catch (_) { return null; }
  }

  function fillContact() {
    document.querySelectorAll("[data-contact]").forEach((el) => { el.textContent = CONTACT; });
    document.querySelectorAll("[data-contact-row]").forEach((el) => { el.hidden = !CONTACT; });
  }

  window.addEventListener("storage", (event) => {
    if (event.key === PRODUCTS_KEY) {
      location.reload();
      return;
    }
    refreshCount();
  });
  document.addEventListener("DOMContentLoaded", refreshCount);
  document.addEventListener("DOMContentLoaded", fillContact);
  watchServerProducts();

  const BOOT_HTML =
    '<div class="boot" id="boot" aria-live="polite" aria-label="加载中">' +
      '<div class="boot-stage">' +
        '<div class="boot-track"><div class="boot-bar" id="bootBar"></div></div>' +
      "</div>" +
    "</div>";
  const NAV_BOOT_KEY = "ly-nav-boot";

  let bootHiding = false;
  let pendingNav = null;

  function isSplash() {
    return document.documentElement.classList.contains("is-splash");
  }

  function bootNodes() {
    return {
      root: document.getElementById("boot"),
      bar: document.getElementById("bootBar")
    };
  }

  function readNavBoot() {
    try {
      const raw = sessionStorage.getItem(NAV_BOOT_KEY);
      sessionStorage.removeItem(NAV_BOOT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeNavBoot(state) {
    try { sessionStorage.setItem(NAV_BOOT_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function ensureBoot(options) {
    const opts = options || {};
    let { root } = bootNodes();
    if (!root) {
      document.body.insertAdjacentHTML("afterbegin", BOOT_HTML);
      root = document.getElementById("boot");
    }
    root.classList.remove("is-out");
    root.classList.toggle("is-nav", !!opts.nav);
    if (opts.nav) document.documentElement.classList.remove("is-splash");
    document.documentElement.classList.add("is-booting");
    document.documentElement.style.background = "#000";
    const { bar } = bootNodes();
    if (bar && opts.bar != null) {
      bar.style.transform = "scaleX(" + opts.bar + ")";
    }
    return bootNodes();
  }

  function hideBoot() {
    const { root } = bootNodes();
    if (!root || bootHiding) return;
    bootHiding = true;
    pendingNav = null;
    root.classList.add("is-out");
    root.classList.remove("is-nav");
    document.documentElement.classList.remove("is-booting");
    document.documentElement.style.background = "";
    setTimeout(() => {
      if (root.parentNode) root.remove();
      document.documentElement.classList.remove("is-splash");
      bootHiding = false;
    }, 280);
  }

  function pageLoadProgress(floor) {
    const images = Array.prototype.slice.call(document.images || []);
    const imgRatio = images.length
      ? images.filter((img) => img.complete).length / images.length
      : 1;
    let base = 0.12;
    if (document.readyState === "interactive") base = 0.45;
    if (document.readyState === "complete") base = 0.8;
    const mixed = base + (1 - base) * imgRatio * (document.readyState === "complete" ? 1 : 0.55);
    const min = floor != null ? floor : 0.04;
    if (document.readyState !== "complete" || imgRatio < 1) {
      return Math.max(min, Math.min(0.96, mixed));
    }
    return 1;
  }

  function runBootProgress(navState) {
    const continuing = !!(navState && navState.startedAt);
    const floor = continuing ? Math.max(0.12, Number(navState.bar) || 0.12) : 0.04;
    const { root, bar } = ensureBoot({
      resetVideo: !continuing,
      bar: floor,
      nav: false
    });
    if (!root || !bar) return;
    bootHiding = false;
    let shown = floor;
    bar.style.transform = "scaleX(" + shown.toFixed(4) + ")";

    function frame() {
      if (!document.getElementById("boot")) return;
      const target = pageLoadProgress(floor);
      const pageDone = target >= 1;
      shown += (target - shown) * (pageDone ? 0.3 : 0.14);
      if (pageDone) shown = Math.max(shown, 0.98);
      bar.style.transform = "scaleX(" + Math.max(floor, Math.min(1, shown)).toFixed(4) + ")";
      if (pageDone && (shown > 0.995 || isSplash())) {
        bar.style.transform = "scaleX(1)";
        hideBoot();
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function isSoftNav(url) {
    try {
      const u = new URL(url, location.href);
      return u.searchParams.get("enter") === "left" || u.searchParams.get("soft") === "1";
    } catch (_) {
      return /[?&]enter=left(?:&|$)/.test(String(url || "")) || /[?&]soft=1(?:&|$)/.test(String(url || ""));
    }
  }

  function navigate(url, replace) {
    if (!url) return;
    const moruDrive = !!window.__moruDriving;
    const moruStopped = () =>
      !!(
        window.__moruStopped ||
        (typeof sessionStorage !== "undefined" &&
          sessionStorage.getItem("ly-moru-stopped") === "1")
      );
    // 仅拦截 Moru 代购跳转；用户自己点链接不受影响
    if (moruDrive && moruStopped()) {
      window.__moruDriving = false;
      hideBoot();
      return;
    }
    // 层间滑动进场（如 3→4）不走 boot，避免盖住过渡动画
    if (isSoftNav(url)) {
      if (replace) location.replace(url);
      else location.assign(url);
      return;
    }
    // 用户或系统跳页前：若不是 Moru 自己在开页，先结束接管，避免加载页上还亮着白光
    if (!moruDrive && typeof window.__moruAbortTakeover === "function") {
      window.__moruAbortTakeover();
    }
    const startedAt = Date.now();
    pendingNav = { startedAt: startedAt, bar: 0.12, href: url };
    writeNavBoot(pendingNav);
    ensureBoot({ resetVideo: true, bar: 0.12, nav: true });
    requestAnimationFrame(() => {
      if (moruDrive && moruStopped()) {
        window.__moruDriving = false;
        hideBoot();
        return;
      }
      if (replace) location.replace(url);
      else location.assign(url);
    });
  }

  function isInternalHref(href) {
    if (!href || href.charAt(0) === "#" || href.indexOf("mailto:") === 0 || href.indexOf("tel:") === 0 || href.indexOf("javascript:") === 0) {
      return false;
    }
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return false;
      if (url.pathname === location.pathname && url.search === location.search && url.hash) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function isInternalNav(anchor) {
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return false;
    return isInternalHref(anchor.getAttribute("href"));
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button != null && event.button !== 0) return;
      const anchor = event.target.closest("a[href]");
      if (!isInternalNav(anchor)) return;
      if (isSoftNav(anchor.href)) return;
      if (typeof window.__moruAbortTakeover === "function") window.__moruAbortTakeover();
      const startedAt = Date.now();
      pendingNav = { startedAt: startedAt, bar: 0.1, href: anchor.href };
      writeNavBoot(pendingNav);
      ensureBoot({ resetVideo: true, startedAt: startedAt, bar: 0.1, nav: true });
    },
    true
  );

  document.addEventListener(
    "pointerup",
    (event) => {
      if (!pendingNav) return;
      const anchor = event.target.closest("a[href]");
      // 松手仍在同一链接上：等 click 跳转；否则取消
      if (anchor && anchor.href === pendingNav.href) return;
      try { sessionStorage.removeItem(NAV_BOOT_KEY); } catch (_) {}
      pendingNav = null;
      hideBoot();
    },
    true
  );

  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = event.target.closest("a[href]");
      const href = (anchor && isInternalNav(anchor) && anchor.href) || (pendingNav && pendingNav.href);
      if (!href || !isInternalHref(href)) return;
      if (isSoftNav(href)) return;
      event.preventDefault();
      event.stopPropagation();
      const startedAt = pendingNav && pendingNav.href === href ? pendingNav.startedAt : Date.now();
      pendingNav = { startedAt: startedAt, bar: 0.14, href: href };
      writeNavBoot(pendingNav);
      ensureBoot({ resetVideo: false, startedAt: startedAt, bar: 0.14, nav: true });
      location.assign(href);
    },
    true
  );

  // 软进场（enter=left）不显示 boot，避免盖住层间滑动
  if (document.documentElement.classList.contains("is-soft-enter")) {
    const bootEl = document.getElementById("boot");
    if (bootEl) bootEl.remove();
    document.documentElement.classList.remove("is-booting");
  } else {
    runBootProgress(readNavBoot());
  }

  // history.back 可能从 bfcache 恢复「还在加载」的旧页面，把卡住的黑屏进度条关掉
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    try { sessionStorage.removeItem(NAV_BOOT_KEY); } catch (_) {}
    bootHiding = false;
    pendingNav = null;
    const boot = document.getElementById("boot");
    if (boot && boot.parentNode) boot.remove();
    document.documentElement.classList.remove("is-booting", "is-splash");
    document.documentElement.style.background = "";
  });

  function goBackOr(fallback) {
    // 离开 Moru 最后一页：立刻结束接管，返回途中的加载页不再出现接管态
    if (typeof window.__moruAbortTakeover === "function") window.__moruAbortTakeover();
    let fromHere = false;
    try {
      fromHere = !!document.referrer && new URL(document.referrer).origin === location.origin;
    } catch (_) {}
    if (fromHere && history.length > 1) history.back();
    else navigate(fallback, true);
  }

  // 竖屏统一返回手势：手指从左往右滑，页面跟手右移，松手过阈值滑出并返回上一页
  function bindSwipeBack(target, onExit, isActive) {
    if (!target) return;
    const portrait = () => window.matchMedia("(orientation: portrait)").matches && window.innerWidth <= 980;
    let tracking = false;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let startAt = 0;

    target.addEventListener("touchstart", (e) => {
      if (!portrait() || e.touches.length !== 1) return;
      if (isActive && !isActive()) return;
      if (e.target.closest("button, a, input, textarea, select, label")) return;
      const t = e.touches[0];
      tracking = true;
      dragging = false;
      startX = t.clientX;
      startY = t.clientY;
      dx = 0;
      startAt = performance.now();
    }, { passive: true });

    target.addEventListener("touchmove", (e) => {
      if (!tracking || e.touches.length !== 1) return;
      const t = e.touches[0];
      const adx = t.clientX - startX;
      const ady = t.clientY - startY;
      if (!dragging) {
        if (Math.abs(ady) > 12 && Math.abs(ady) > Math.abs(adx)) {
          tracking = false;
          return;
        }
        if (adx < 10) return;
        dragging = true;
        target.style.transition = "none";
      }
      dx = adx;
      target.style.transform = "translateX(" + Math.max(0, dx) + "px)";
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    function finish() {
      if (!tracking && !dragging) return;
      const width = target.offsetWidth || window.innerWidth;
      const velocity = dx / Math.max(1, performance.now() - startAt);
      const shouldExit = dragging && (dx > Math.min(72, width * 0.18) || velocity > 0.45);
      const wasDragging = dragging;
      tracking = false;
      dragging = false;
      dx = 0;
      if (!wasDragging) return;
      if (shouldExit) {
        target.style.transition = "transform .28s ease";
        target.style.transform = "translateX(100%)";
        window.setTimeout(onExit, 260);
      } else {
        target.style.transition = "transform .25s ease";
        target.style.transform = "";
        window.setTimeout(() => { target.style.transition = ""; }, 260);
      }
    }
    target.addEventListener("touchend", finish);
    target.addEventListener("touchcancel", finish);

    // 返回后再前进（bfcache 恢复）时，页面不能停在滑出的位置
    window.addEventListener("pageshow", (e) => {
      if (!e.persisted) return;
      target.style.transition = "";
      target.style.transform = "";
    });
  }

  window.Shop = {
    goBackOr,
    bindSwipeBack,
    portfolioUrl: PORTFOLIO_URL,
    products: PRODUCTS,
    allProducts: ALL_PRODUCTS,
    productsKey: PRODUCTS_KEY,
    defaultProducts: DEFAULT_PRODUCTS.map(normalizeProduct),
    saveProducts,
    paymentLabels: PAYMENT_LABELS,
    getProduct,
    addToCart,
    setQty,
    removeFromCart,
    clearCart,
    cartLines,
    cartCount,
    cartTotal,
    formatPrice,
    pad,
    refreshCount,
    addedNotice,
    lineSpec,
    escapeHtml,
    contact: CONTACT,
    saveLastOrder,
    lastOrder,
    navigate,
    showBoot: ensureBoot,
    hideBoot
  };

  // 访问打点：只统计 Cloudflare 公网；本机 / 局域网不计
  (function trackTraffic() {
    const HIT = "https://moru-shop.pages.dev/api/traffic/hit";
    const SID_KEY = "ly-traffic-sid";
    const PAGES = {
      "index.html": 1,
      "product.html": 1,
      "cart.html": 1,
      "checkout.html": 1,
      "order.html": 1,
      "terms.html": 1,
    };

    function isPublicHost() {
      const h = (location.hostname || "").toLowerCase();
      if (!h || h === "localhost" || h === "127.0.0.1" || h === "[::1]") return false;
      if (h.endsWith(".local")) return false;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
      if (h === "moru-shop.pages.dev" || h.endsWith(".moru-shop.pages.dev")) {
        return true;
      }
      return location.protocol === "https:";
    }

    if (!isPublicHost()) return;

    function pageName() {
      const raw = (location.pathname || "/").split("/").pop() || "index.html";
      if (raw === "" || raw === "/") return "index.html";
      return PAGES[raw] ? raw : "index.html";
    }

    function deviceType() {
      const ua = navigator.userAgent || "";
      if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return "tablet";
      if (/Mobi|Android|iPhone|iPod|Phone/i.test(ua)) return "mobile";
      const w = Math.min(window.innerWidth || 9999, screen.width || 9999);
      if (w >= 768 && w <= 1024 && "ontouchstart" in window) return "tablet";
      if (w < 768) return "mobile";
      return "desktop";
    }

    function sid() {
      try {
        let id = localStorage.getItem(SID_KEY);
        if (id && /^[A-Za-z0-9_-]{8,64}$/.test(id)) return id;
        const bytes = new Uint8Array(16);
        if (crypto.getRandomValues) crypto.getRandomValues(bytes);
        else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
        id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        localStorage.setItem(SID_KEY, id);
        return id;
      } catch {
        return "anon" + String(Date.now()).slice(-10);
      }
    }

    function post(body, keepalive) {
      const payload = JSON.stringify(body);
      const sameOrigin = location.origin === "https://moru-shop.pages.dev";
      if (sameOrigin && keepalive && navigator.sendBeacon) {
        try {
          const blob = new Blob([payload], { type: "application/json" });
          if (navigator.sendBeacon(HIT, blob)) return;
        } catch {}
      }
      fetch(HIT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: !!keepalive,
        cache: "no-store",
      }).catch(() => {});
    }

    const base = { sid: sid(), path: pageName(), device: deviceType() };
    post(base, false);

    let timer = 0;
    function beat() {
      if (document.visibilityState === "hidden") return;
      post({ ...base, ping: true }, false);
    }
    function start() {
      window.clearInterval(timer);
      timer = window.setInterval(beat, 60000);
    }
    start();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        beat();
        start();
      }
    });
    window.addEventListener("pagehide", () => {
      post({ ...base, ping: true }, true);
    });
  })();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
})();
