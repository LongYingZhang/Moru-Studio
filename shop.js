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
      cardFace: "assets/cards/01-ui.svg",
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
      cardFace: "assets/cards/02-ui.svg",
      cardPhoto: "left:27.7901%;top:-44.9294%;width:74.5337%;height:184.7484%",
      heroPosition: "center center"
    },
    {
      id: 2,
      no: "NO. 03",
      name: "Moru帆布袋",
      nameEn: "MORU MUG",
      price: 38,
      image: "assets/mug.jpg",
      cardBg: "#F3F3F1",
      cardImage: "assets/cards/03.jpg",
      cardFace: "assets/cards/03-ui.svg",
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
      cardFace: "assets/cards/04-ui.svg",
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
      cardBg: "#F3F3F1",
      cardImage: "assets/cards/05.jpg",
      cardFace: "assets/cards/05-ui.svg",
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
    if (preset) {
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
      cardImage: product.cardImage || image,
      cardFace: product.cardFace || "",
      cardPhoto:
        product.cardPhoto ||
        "left:0%;top:0%;width:100%;height:100%;background-size:cover",
      heroPosition: product.heroPosition || "center center"
    };
  }

  const PRODUCTS_API = "/api/products";
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

  function fetchServerProducts() {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", PRODUCTS_API, false);
      xhr.send();
      return xhr.status === 200 ? parseProducts(xhr.responseText) : null;
    } catch (e) {
      return null;
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
    const fromServer = fetchServerProducts();
    if (fromServer) {
      remember(fromServer);
      return fromServer.map(normalizeProduct);
    }
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
        '<div class="boot-video-wrap">' +
          '<video class="boot-video" id="bootVideo" autoplay muted loop playsinline preload="auto" poster="assets/loader/moru-loop-poster.png">' +
            '<source src="assets/loader/moru-loop.mp4" type="video/mp4">' +
          "</video>" +
        "</div>" +
        '<div class="boot-track"><div class="boot-bar" id="bootBar"></div></div>' +
      "</div>" +
    "</div>";
  const NAV_BOOT_KEY = "ly-nav-boot";
  const VIDEO_SRC = "assets/loader/moru-loop.mp4";

  let bootHiding = false;

  function bootNodes() {
    return {
      root: document.getElementById("boot"),
      bar: document.getElementById("bootBar"),
      video: document.getElementById("bootVideo")
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

  function syncVideoToClock(video, startedAt) {
    if (!video || !startedAt) return;
    const apply = () => {
      const duration = video.duration;
      if (!duration || !isFinite(duration)) return;
      const t = ((Date.now() - startedAt) / 1000) % duration;
      try {
        video.currentTime = t;
      } catch (_) {}
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener("loadedmetadata", apply, { once: true });
  }

  function ensureBoot(options) {
    const opts = options || {};
    let { root } = bootNodes();
    if (!root) {
      document.body.insertAdjacentHTML("afterbegin", BOOT_HTML);
      root = document.getElementById("boot");
    }
    root.classList.remove("is-out");
    document.documentElement.classList.add("is-booting");
    document.documentElement.style.background = "#000";
    const { video, bar } = bootNodes();
    if (bar && opts.bar != null) {
      bar.style.transform = "scaleX(" + opts.bar + ")";
    }
    if (video) {
      try {
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        if (opts.startedAt) syncVideoToClock(video, opts.startedAt);
        else if (opts.resetVideo) video.currentTime = 0;
        const play = video.play();
        if (play && play.catch) play.catch(() => {});
      } catch (_) {}
    }
    return bootNodes();
  }

  function hideBoot() {
    const { root } = bootNodes();
    if (!root || bootHiding) return;
    bootHiding = true;
    root.classList.add("is-out");
    document.documentElement.classList.remove("is-booting");
    document.documentElement.style.background = "";
    setTimeout(() => {
      if (root.parentNode) root.remove();
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
    const { root, bar, video } = ensureBoot({
      resetVideo: !continuing,
      startedAt: continuing ? navState.startedAt : null,
      bar: floor
    });
    if (!root || !bar) return;
    bootHiding = false;
    let shown = floor;
    bar.style.transform = "scaleX(" + shown.toFixed(4) + ")";
    if (video && !continuing) {
      try {
        video.currentTime = 0;
        const play = video.play();
        if (play && play.catch) play.catch(() => {});
      } catch (_) {}
    }

    function frame() {
      if (!document.getElementById("boot")) return;
      const target = pageLoadProgress(floor);
      const done = target >= 1;
      shown += (target - shown) * (done ? 0.3 : 0.14);
      if (done) shown = Math.max(shown, 0.98);
      bar.style.transform = "scaleX(" + Math.max(floor, Math.min(1, shown)).toFixed(4) + ")";
      if (done && shown > 0.995) {
        bar.style.transform = "scaleX(1)";
        hideBoot();
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function navigate(url, replace) {
    if (!url) return;
    const startedAt = Date.now();
    writeNavBoot({ startedAt: startedAt, bar: 0.12, href: url });
    ensureBoot({ resetVideo: true, startedAt: startedAt, bar: 0.12 });
    // 先画出并开始播放，下一帧再跳转，目标页按同一时间轴接着播
    requestAnimationFrame(() => {
      if (replace) location.replace(url);
      else location.assign(url);
    });
  }

  function isInternalNav(anchor) {
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return false;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
      return false;
    }
    try {
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin) return false;
      if (url.pathname === location.pathname && url.search === location.search && url.hash) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button != null && event.button !== 0) return;
      const anchor = event.target.closest("a[href]");
      if (!isInternalNav(anchor)) return;
      // 按下瞬间就铺黑并开播，跳转后按同一时间轴接着播
      const startedAt = Date.now();
      writeNavBoot({ startedAt: startedAt, bar: 0.1, href: anchor.href });
      ensureBoot({ resetVideo: true, startedAt: startedAt, bar: 0.1 });
    },
    true
  );

  document.addEventListener(
    "pointerup",
    (event) => {
      try {
        const raw = sessionStorage.getItem(NAV_BOOT_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || !parsed.href) return;
        const anchor = event.target.closest("a[href]");
        if (anchor && anchor.href === parsed.href) return;
        sessionStorage.removeItem(NAV_BOOT_KEY);
        hideBoot();
      } catch (_) {}
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
      if (!isInternalNav(anchor)) return;
      event.preventDefault();
      let startedAt = Date.now();
      try {
        const raw = sessionStorage.getItem(NAV_BOOT_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && parsed.href === anchor.href && parsed.startedAt) startedAt = parsed.startedAt;
      } catch (_) {}
      writeNavBoot({ startedAt: startedAt, bar: 0.14, href: anchor.href });
      ensureBoot({ resetVideo: false, startedAt: startedAt, bar: 0.14 });
      requestAnimationFrame(() => {
        location.assign(anchor.href);
      });
    },
    true
  );

  // 提前把循环视频暖进缓存，点击时能立刻出画
  try {
    const warm = document.createElement("video");
    warm.preload = "auto";
    warm.muted = true;
    warm.playsInline = true;
    warm.src = VIDEO_SRC;
    warm.load();
  } catch (_) {}

  runBootProgress(readNavBoot());

  window.Shop = {
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
})();
