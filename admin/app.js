(() => {
  "use strict";

  if (
    (window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "localhost") &&
    window.location.port === "4173"
  ) {
    window.location.replace(
      `http://127.0.0.1:8787/admin/${window.location.hash || "#/products"}`,
    );
    return;
  }

  const STORAGE_KEY = "ly-shop-products-v1";
  const PRODUCTS_API = "/api/products";
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
      status: "active",
      stock: "in-stock",
      image: "/assets/sachet.jpg",
      cardBg: "#F1F1F1",
      cardImage: "assets/cards/01.jpg",
      cardPhoto: "left:27.7182%;top:0%;width:72.2818%;height:100%",
      heroPosition: "center 20%",
    },
    {
      id: 1,
      no: "NO. 02",
      name: "Moru帆布袋",
      nameEn: "CANVAS BAG",
      detailEn: "Canvas bag",
      price: 38,
      desc: "",
      dimension: "480 × 520 × 140 毫米",
      material: "24安重磅原胚棉帆布 / 四本针立体包缝",
      status: "active",
      stock: "in-stock",
      image: "/assets/tote.jpg",
      cardBg: "#F8F7F5",
      cardImage: "assets/cards/02.jpg",
      cardPhoto: "left:27.7901%;top:-44.9294%;width:74.5337%;height:184.7484%",
      heroPosition: "center center",
    },
    {
      id: 2,
      no: "NO. 03",
      name: "Moru马克杯",
      nameEn: "MORU MUG",
      detailEn: "Moru mug",
      price: 38,
      desc: "",
      dimension: "",
      material: "",
      status: "active",
      stock: "in-stock",
      image: "/assets/mug.jpg",
      cardBg: "#F3F3F1",
      cardImage: "assets/cards/03.jpg",
      cardPhoto: "left:20.8359%;top:-9.0098%;width:82.5843%;height:114.2532%",
      heroPosition: "center center",
    },
    {
      id: 3,
      no: "NO. 04",
      name: "Moru帆布帽",
      nameEn: "MORU CANVASCAP",
      detailEn: "Moru canvas cap",
      price: 38,
      desc: "",
      dimension: "",
      material: "",
      status: "active",
      stock: "in-stock",
      image: "/assets/cap.jpg",
      cardBg: "#F7F7F7",
      cardImage: "assets/cards/04.jpg",
      cardPhoto: "left:23.1178%;top:-6.3643%;width:76.8820%;height:106.3644%",
      heroPosition: "center center",
    },
    {
      id: 4,
      no: "NO. 05",
      name: "Moru雪梨纸",
      nameEn: "MORU TISSUE PAPER",
      detailEn: "Moru tissue paper",
      price: 38,
      desc: "",
      dimension: "",
      material: "",
      status: "active",
      stock: "in-stock",
      image: "/assets/tissue.jpg",
      cardBg: "#141414",
      cardInk: "light",
      cardImage: "assets/cards/05.jpg",
      cardPhoto: "left:0%;top:-126.9500%;width:100%;height:247.8723%",
      heroPosition: "center center",
    },
  ];

  const ORDERS_API = "/api/orders";
  const AUTH_API = "/api/auth";
  // 公网统计在 Cloudflare KV；后台从公网读，本机访问不计。
  // 这个接口要口令（Pages 环境变量 ADMIN_TOKEN），口令只存在本机 localStorage。
  const TRAFFIC_API = "https://longying-studio.pages.dev/api/traffic";
  const TRAFFIC_TOKEN_KEY = "ly-admin-traffic-token";
  const SHOTS_MAX = 4;
  const ORDER_STATUS = {
    pending: { label: "待确认收款", action: "处理收款" },
    paid: { label: "待发货", action: "去发货" },
    shipped: { label: "已发货", action: "查看订单" },
  };
  const PAYMENT_LABELS = { wechat: "微信支付", alipay: "支付宝", card: "银联 / 卡" };

  const app = document.getElementById("app");
  const toast = document.getElementById("toast");
  const navLinks = [...document.querySelectorAll("[data-nav]")];
  let products = loadProducts();
  let orders = [];
  let orderTab = "pending";
  let trafficRange = "7";
  let trafficCache = null;
  let trafficPoll = 0;
  let auth = { setup: true, authed: false };
  let toastTimer = 0;
  let orderPoll = 0;

  let bootHiding = false;
  let bootStartedAt = performance.now();
  let bootProgressRaf = 0;
  let bootGen = 0;

  function isSplash() {
    return document.documentElement.classList.contains("is-splash");
  }

  function bootNodes() {
    return {
      root: document.getElementById("boot"),
      bar: document.getElementById("bootBar"),
    };
  }

  function setBootBar(ratio) {
    const { bar } = bootNodes();
    if (!bar) return;
    const value = Math.max(0.02, Math.min(1, ratio));
    bar.style.transform = `scaleX(${value.toFixed(4)})`;
  }

  const BOOT_HTML =
    '<div class="boot" id="boot" aria-live="polite" aria-label="加载中">' +
      '<div class="boot-stage">' +
        '<div class="boot-track"><div class="boot-bar" id="bootBar"></div></div>' +
      "</div>" +
    "</div>";

  function showBoot(options = {}) {
    let { root } = bootNodes();
    if (!root) {
      document.body.insertAdjacentHTML("afterbegin", BOOT_HTML);
      ({ root } = bootNodes());
    }
    bootHiding = false;
    bootStartedAt = performance.now();
    root.classList.remove("is-out");
    document.documentElement.classList.add("is-booting");
    document.documentElement.style.background = "#000";
    setBootBar(options.bar != null ? options.bar : 0.08);
  }

  function hideBoot() {
    const { root } = bootNodes();
    if (!root || bootHiding) return;
    bootHiding = true;
    if (bootProgressRaf) {
      cancelAnimationFrame(bootProgressRaf);
      bootProgressRaf = 0;
    }
    setBootBar(1);
    root.classList.add("is-out");
    document.documentElement.classList.remove("is-booting");
    document.documentElement.style.background = "";
    setTimeout(() => {
      if (root.parentNode) root.remove();
      document.documentElement.classList.remove("is-splash");
      bootHiding = false;
    }, 280);
  }

  function finishBootWhenReady(readyPromise) {
    const gen = ++bootGen;
    showBoot({ reset: true, bar: 0.1 });
    let shown = 0.1;
    if (bootProgressRaf) cancelAnimationFrame(bootProgressRaf);
    const tick = () => {
      if (gen !== bootGen || !document.getElementById("boot")) return;
      const elapsed = performance.now() - bootStartedAt;
      const target = Math.min(0.92, 0.12 + elapsed / 1800);
      shown += (target - shown) * 0.12;
      setBootBar(shown);
      bootProgressRaf = requestAnimationFrame(tick);
    };
    bootProgressRaf = requestAnimationFrame(tick);

    Promise.resolve(readyPromise)
      .catch(() => {})
      .then(() => {
        if (gen !== bootGen) return;
        const close = () => {
          if (gen !== bootGen) return;
          const finish = () => {
            if (gen !== bootGen) return;
            shown = Math.max(shown, 0.98);
            setBootBar(1);
            hideBoot();
          };
          finish();
        };
        close();
      });
  }

  const icons = {
    arrow: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12h14M14 7l5 5-5 5"></path>
      </svg>`,
    edit: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M10 14v6"></path>
      </svg>`,
    upload: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 17.5V6.8A1.8 1.8 0 0 1 5.8 5h12.4A1.8 1.8 0 0 1 20 6.8v10.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.2Z"></path>
        <circle cx="9" cy="10" r="1.5"></circle>
        <path d="m5 17 4.5-4 3.2 2.8 2.1-2 4.2 3.7M17 3v5M14.5 5.5h5"></path>
      </svg>`,
    plus: `
      <svg viewBox="0 0 13.49 13.49" aria-hidden="true">
        <rect x="0" y="6.045" width="13.49" height="1.4"></rect>
        <rect x="6.045" y="0" width="1.4" height="13.49"></rect>
      </svg>`,
    close: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 6 12 12M18 6 6 18"></path>
      </svg>`,
    arrowOut: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 16 16 8M9 8h7v7"></path>
      </svg>`,
    back: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 12H5M10 7l-5 5 5 5"></path>
      </svg>`,
    copy: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="8" width="11" height="11" rx="2"></rect>
        <path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15"></path>
      </svg>`,
    check: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5"></path>
      </svg>`,
  };

  function cloneDefaults() {
    return DEFAULT_PRODUCTS.map((product) => ({ ...product }));
  }

  function validProducts(list) {
    return list.filter(
      (product) =>
        product &&
        (typeof product.id === "string" || typeof product.id === "number") &&
        typeof product.name === "string" &&
        Number.isFinite(Number(product.price)),
    );
  }

  function loadProducts() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return cloneDefaults();

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return cloneDefaults();

      return validProducts(parsed);
    } catch {
      return cloneDefaults();
    }
  }

  function saveLocal(nextProducts) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProducts));
    } catch {}
  }

  async function pushToServer(nextProducts) {
    const response = await fetch(PRODUCTS_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextProducts),
    });
    if (response.status === 401) {
      lockOut();
      throw new Error("登录已过期，请重新登录。");
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // 服务端会把「有没有推上线上 KV」一起回过来
    return await response.json().catch(() => ({}));
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401 && !url.startsWith(AUTH_API)) {
      lockOut();
      throw new Error("登录已过期，请重新登录。");
    }
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  }

  function lockOut() {
    auth.authed = false;
    window.clearInterval(orderPoll);
    stopTrafficPoll();
    render();
  }

  async function loadOrders() {
    try {
      const list = await api(ORDERS_API);
      if (Array.isArray(list)) orders = list;
      return true;
    } catch (error) {
      if (auth.authed) showToast("无法读取订单，请确认网站服务正在运行。", true);
      return false;
    }
  }

  async function syncFromServer() {
    try {
      const response = await fetch(PRODUCTS_API, { cache: "no-store" });
      if (response.status === 404) {
        await pushToServer(products);
        return;
      }
      if (!response.ok) return;
      const remote = await response.json();
      if (!Array.isArray(remote)) return;
      products = validProducts(remote);
      saveLocal(products);
      render();
    } catch {
      showToast("无法连接商品服务器，改动暂时只保存在本浏览器。", true);
    }
  }

  function commitProducts(nextProducts) {
    // 先改界面再存盘的话，一旦 PUT 失败，后台会显示「已改」但服务端还是旧数据，
    // 前台和 app 当然不会变。所以失败必须回滚，别让人误以为存上了。
    const previous = products;
    products = nextProducts;
    saveLocal(nextProducts);
    pushToServer(nextProducts)
      .then((result) => {
        // 本机存上了、线上没推上去：不能装作没事，否则又会出现
        // 「后台显示缺货、网站和 app 还是现货」的假象。
        if (result && result.cloud === false) {
          showToast(
            "本机已保存，但没同步到线上：" + (result.message || "请检查网络后重点一次"),
            true,
          );
        }
      })
      .catch((error) => {
        products = previous;
        saveLocal(previous);
        renderProducts();
        const reason = error && error.message ? error.message : "请确认网站服务正在运行。";
        showToast("保存失败，改动已撤回：" + reason, true);
      });
    return true;
  }

  function escapeHTML(value = "") {
    return String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[character],
    );
  }

  function safeImageSource(value) {
    const source = String(value || "");
    const isLocalAsset =
      /^\/?assets\/[\w./-]+\.(?:jpe?g|png|webp|gif)$/i.test(source) ||
      /^\/uploads\/[0-9a-f]{32}\.(?:jpg|png|webp|gif)$/.test(source);
    const isUploadedImage =
      /^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(source);

    return escapeHTML(
      isLocalAsset || isUploadedImage ? source : "/assets/sachet.jpg",
    );
  }

  function makeId() {
    const numericIds = products
      .map((product) => Number(product.id))
      .filter(Number.isFinite);
    return numericIds.length ? Math.max(...numericIds) + 1 : 0;
  }

  function formatPrice(value) {
    return new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: 2,
      minimumFractionDigits: Number(value) % 1 === 0 ? 0 : 2,
    }).format(Number(value));
  }

  function showToast(message, isError = false) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle("is-error", isError);
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2600);
  }

  function readRoute() {
    const route = window.location.hash.replace(/^#\/?/, "");
    const [name, id] = route.split("/");

    if (name === "new") return { name: "new" };
    if (name === "edit" && id) {
      return { name: "edit", id: decodeURIComponent(id) };
    }
    if (name === "products") return { name: "products" };
    if (name === "traffic") return { name: "traffic" };
    if (name === "orders" && id) {
      return { name: "order", id: decodeURIComponent(id) };
    }
    return { name: "orders" };
  }

  function setActiveNavigation(routeName) {
    const activeName =
      routeName === "new"
        ? "new"
        : routeName === "traffic"
          ? "traffic"
          : routeName.startsWith("order")
            ? "orders"
            : routeName === "products" || routeName === "edit"
              ? "products"
              : "orders";
    navLinks.forEach((link) => {
      if (link.dataset.nav === activeName) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function productCard(product) {
    const isActive = product.status === "active";
    const isPreorder = product.stock === "pre-order";
    const id = escapeHTML(product.id);
    const description = product.desc || product.description;
    const descriptionMarkup = description
      ? `<p class="product-description">${escapeHTML(description)}</p>`
      : "";

    return `
      <article class="product-card${isActive ? "" : " is-inactive"}" data-product-id="${id}">
        <div class="product-main">
          <img
            class="product-image"
            src="${safeImageSource(product.image)}"
            alt="${escapeHTML(product.name)}"
          />
          <div class="product-copy">
            <h2><span class="product-name">${escapeHTML(product.name)}</span><button
              class="stock-chip${isPreorder ? " is-out" : ""}"
              type="button"
              data-action="stock"
              data-id="${id}"
              title="${isPreorder ? "点一下改回现货" : "点一下标记为缺货（顾客仍可下单，按预付款处理）"}"
            >${isPreorder ? "缺货" : "现货"}</button></h2>
            <p class="product-meta">${escapeHTML(product.dimension || product.dimensions || "未填写尺寸")}${product.material ? ` · ${escapeHTML(product.material)}` : ""}</p>
            ${descriptionMarkup}
            <p class="price">¥${formatPrice(product.price)}</p>
          </div>
        </div>
        <div class="card-side">
          <button
            class="icon-button"
            type="button"
            data-action="edit"
            data-id="${id}"
            aria-label="编辑${escapeHTML(product.name)}"
            title="编辑"
          >
            ${icons.edit}
          </button>
          <button
            class="toggle-button${isActive ? " is-unlist" : ""}"
            type="button"
            data-action="toggle"
            data-id="${id}"
            aria-label="${isActive ? "下架" : "上架"}${escapeHTML(product.name)}"
          >
            ${isActive ? "下架" : "上架"}
          </button>
        </div>
      </article>`;
  }

  function renderProducts() {
    const cards = products.map(productCard).join("");

    document.title = "商品管理 · Studio Admin";
    app.innerHTML = `
      <section class="page" aria-label="商品管理">
        ${
          products.length
            ? `<div class="product-list">${cards}</div>`
            : `
              <div class="empty-state">
                <h2>还没有商品</h2>
                <p>录入第一件商品，开始建立你的物象档案。</p>
              </div>`
        }
        <a class="primary-button" href="#/new">
          <span>上架新商品</span>
          ${icons.arrow}
        </a>
      </section>`;
  }

  function renderForm(existingProduct = null) {
    const isEditing = Boolean(existingProduct);
    const product = existingProduct || {
      name: "",
      price: "",
      dimension: "",
      material: "",
      desc: "",
      status: "active",
      stock: "in-stock",
      image: "",
    };

    document.title = `${isEditing ? "编辑商品" : "上架新商品"} · Studio Admin`;
    app.innerHTML = `
      <section class="page form-page${isEditing ? " is-editing" : ""}" aria-label="${isEditing ? "编辑商品" : "上架新商品"}">
        <form class="product-form" id="product-form">
          <div class="form-panel">
            <div class="field">
              <span class="field-label" id="image-label">商品展示图</span>
              <div class="shots" id="shots" aria-labelledby="image-label"></div>
            </div>

            <div class="field">
              <label for="product-name">商品名字</label>
              <input
                id="product-name"
                name="name"
                type="text"
                maxlength="60"
                value="${escapeHTML(product.name)}"
                placeholder="输入商品名字"
                autocomplete="off"
                required
              />
            </div>

            <div class="field">
              <span class="field-label">前台卡片</span>
              <div class="card-editor" id="card-editor"></div>
            </div>

            <div class="field-row">
              <div class="field">
                <label for="product-price">商品定价</label>
                <div class="price-input">
                  <span>¥</span>
                  <input
                    id="product-price"
                    name="price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value="${escapeHTML(product.price)}"
                    placeholder="输入售价"
                    required
                  />
                </div>
              </div>
              <div class="field">
                <label for="product-dimensions">商品尺寸</label>
                <input
                  id="product-dimensions"
                  name="dimension"
                  type="text"
                  maxlength="80"
                  value="${escapeHTML(product.dimension || product.dimensions || "")}"
                  placeholder="例如：90×90×120毫米"
                />
              </div>
            </div>

            <div class="field">
              <label for="product-material">商品材质</label>
              <input
                id="product-material"
                name="material"
                type="text"
                maxlength="80"
                value="${escapeHTML(product.material)}"
                placeholder="例如：天然玄石"
              />
            </div>

            <div class="field">
              <label for="product-description">商品简介</label>
              <textarea
                id="product-description"
                name="desc"
                maxlength="300"
                rows="4"
                placeholder="输入商品简介，简明叙述设计与工艺"
              >${escapeHTML(product.desc || product.description || "")}</textarea>
            </div>

            <div class="field">
              <span class="field-label">库存状态</span>
              <div class="stock-switch" id="stock-switch" role="radiogroup" aria-label="库存状态">
                <button type="button" class="stock-option" data-stock="in-stock" role="radio" aria-checked="false">现货</button>
                <button type="button" class="stock-option" data-stock="pre-order" role="radio" aria-checked="false">缺货</button>
              </div>
              <p class="field-note">标成缺货后顾客照样能下单，但在购物袋点「前往结算」时会先弹出预付款说明，确认后才进付款页。</p>
            </div>
          </div>

          <button class="primary-button" id="submit-product" type="submit">
            <span>${isEditing ? "保存商品修改" : "确认并上架商品"}</span>
            ${icons.arrow}
          </button>
        </form>
      </section>`;

    setupProductForm(existingProduct);
  }

  function setupProductForm(existingProduct) {
    const form = document.getElementById("product-form");
    const shotsBox = document.getElementById("shots");
    const submitButton = document.getElementById("submit-product");
    let shots = [existingProduct?.image]
      .concat(Array.isArray(existingProduct?.gallery) ? existingProduct.gallery : [])
      .filter(Boolean)
      .slice(0, SHOTS_MAX);
    const status = existingProduct?.status === "inactive" ? "inactive" : "active";
    let stock = existingProduct?.stock === "pre-order" ? "pre-order" : "in-stock";
    let processingImage = false;
    const accept = "image/png,image/jpeg,image/webp,image/gif";

    const stockSwitch = document.getElementById("stock-switch");
    const stockOptions = [...stockSwitch.querySelectorAll("[data-stock]")];
    function paintStock() {
      stockOptions.forEach((button) => {
        const on = button.dataset.stock === stock;
        button.classList.toggle("is-on", on);
        button.setAttribute("aria-checked", on ? "true" : "false");
      });
    }
    stockSwitch.addEventListener("click", (event) => {
      const button = event.target.closest("[data-stock]");
      if (!button) return;
      stock = button.dataset.stock;
      paintStock();
    });
    paintStock();

    const nameInput = document.getElementById("product-name");
    const savedName = existingProduct?.name || "";
    const englishFor = (name) =>
      existingProduct && name === savedName && existingProduct.nameEn !== "LONGYING OBJECT"
        ? existingProduct.nameEn || ""
        : "";
    const cardEditor = window.CardEditor
      ? window.CardEditor.create(document.getElementById("card-editor"), {
          src: existingProduct ? existingProduct.cardImage || existingProduct.image : "",
          photo: existingProduct?.cardPhoto,
          bg: existingProduct?.cardBg,
          ink: existingProduct?.cardInk,
          no: existingProduct?.no || `NO. ${String(makeId() + 1).padStart(2, "0")}`,
          name: nameInput.value.trim(),
          en: englishFor(nameInput.value.trim()),
        })
      : null;
    let cardCover = existingProduct?.image || "";
    nameInput.addEventListener("input", () => {
      const name = nameInput.value.trim();
      cardEditor?.setName(name, englishFor(name));
    });

    function renderShots() {
      const left = SHOTS_MAX - shots.length;
      shotsBox.classList.toggle("is-empty", !shots.length);
      if ((shots[0] || "") !== cardCover) {
        cardCover = shots[0] || "";
        cardEditor?.setImage(cardCover);
      }

      if (!shots.length) {
        shotsBox.innerHTML = `
          <label class="upload-zone">
            <input type="file" multiple accept="${accept}" data-shot-input aria-label="添加商品图" />
            <span class="upload-plus">${icons.plus}</span>
          </label>`;
        return;
      }

      const tile = (src, index) => `
        <div class="shot${index === 0 ? " is-cover" : ""}">
          <img src="${safeImageSource(src)}" alt="商品图 ${index + 1}" />
          ${index === 0
            ? `<span class="shot-tag">封面</span>`
            : `<button class="shot-tag shot-make-cover" type="button" data-cover-shot="${index}">设为封面</button>`}
          <button class="remove-image" type="button" data-remove-shot="${index}" aria-label="移除第 ${index + 1} 张">
            ${icons.close}
          </button>
        </div>`;
      const adder = left
        ? `<label class="shot shot-add">
            <input type="file" multiple accept="${accept}" data-shot-input />
            <span class="upload-icon">${icons.upload}</span>
            <strong>继续添加</strong>
            <small>还可添加 ${left} 张</small>
          </label>`
        : "";
      const rest = shots.slice(1).map((src, i) => tile(src, i + 1)).join("") + adder;
      shotsBox.innerHTML = tile(shots[0], 0) + (rest ? `<div class="shot-row">${rest}</div>` : "");
    }

    async function addFiles(fileList) {
      const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
      if (!files.length) {
        showToast("请选择 PNG、JPG、WEBP 或 GIF 图片。", true);
        return;
      }
      const room = SHOTS_MAX - shots.length;
      if (room <= 0) {
        showToast(`最多 ${SHOTS_MAX} 张图片，请先移除一张。`, true);
        return;
      }
      processingImage = true;
      submitButton.disabled = true;
      submitButton.style.opacity = "0.55";
      shotsBox.classList.add("is-busy");
      let added = 0;
      try {
        for (const file of files.slice(0, room)) {
          shots = [...shots, await compressImage(file)];
          added += 1;
          renderShots();
        }
        const skipped = files.length - room;
        showToast(skipped > 0
          ? `已添加 ${added} 张，最多 ${SHOTS_MAX} 张，多出的 ${skipped} 张未添加。`
          : `已添加 ${added} 张图片。`, skipped > 0);
      } catch {
        showToast("有图片无法读取，请换一张后重试。", true);
      } finally {
        processingImage = false;
        submitButton.disabled = false;
        submitButton.style.opacity = "";
        shotsBox.classList.remove("is-busy");
        renderShots();
      }
    }

    shotsBox.addEventListener("change", (event) => {
      if (event.target.matches("[data-shot-input]")) addFiles(event.target.files);
    });

    shotsBox.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-shot]");
      const cover = event.target.closest("[data-cover-shot]");
      if (!remove && !cover) return;
      event.preventDefault();
      if (remove) {
        shots = shots.filter((_, index) => index !== Number(remove.dataset.removeShot));
      } else {
        const index = Number(cover.dataset.coverShot);
        shots = [shots[index], ...shots.filter((_, i) => i !== index)];
      }
      renderShots();
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      shotsBox.addEventListener(eventName, (event) => {
        event.preventDefault();
        shotsBox.classList.add("is-dragging");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      shotsBox.addEventListener(eventName, (event) => {
        event.preventDefault();
        if (eventName === "dragleave" && shotsBox.contains(event.relatedTarget)) return;
        shotsBox.classList.remove("is-dragging");
      });
    });

    shotsBox.addEventListener("drop", (event) => {
      addFiles(event.dataTransfer?.files);
    });

    renderShots();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (processingImage) return;
      if (!shots.length) {
        showToast("请先添加至少一张商品图。", true);
        shotsBox.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      const image = shots[0];
      const gallery = shots.slice(1);

      const formData = new FormData(form);
      const price = Number(formData.get("price"));
      if (!Number.isFinite(price) || price <= 0) {
        showToast("请输入正确的商品价格。", true);
        return;
      }

      const id = existingProduct?.id ?? makeId();
      const nextProduct = {
        ...(existingProduct || {
          id,
          no: `NO. ${String(id + 1).padStart(2, "0")}`,
          nameEn: "LONGYING OBJECT",
          detailEn: "Longying object",
          cardBg: "#F3F3F1",
          heroPosition: "center center",
        }),
        id,
        name: String(formData.get("name") || "").trim(),
        price,
        dimension: String(formData.get("dimension") || "").trim(),
        material: String(formData.get("material") || "").trim(),
        desc: String(formData.get("desc") || "").trim(),
        status,
        stock,
        image,
        gallery,
        updatedAt: new Date().toISOString(),
      };

      if (!existingProduct || image !== existingProduct.image) {
        nextProduct.cardImage = image;
        nextProduct.cardFace = "";
        nextProduct.cardPhoto =
          "left:0%;top:0%;width:100%;height:100%;background-size:cover";
        nextProduct.heroPosition = "center center";
      }
      const cardLayout = cardEditor?.value();
      if (cardLayout && cardLayout.cardImage === image) {
        Object.assign(nextProduct, cardLayout, { cardFace: "" });
      } else if (cardLayout && existingProduct && image === existingProduct.image) {
        Object.assign(nextProduct, cardLayout);
      }

      const nextProducts = existingProduct
        ? products.map((product) =>
            product.id === existingProduct.id ? nextProduct : product,
          )
        : [...products, nextProduct];

      if (!commitProducts(nextProducts)) return;

      window.location.hash = "#/products";
      showToast(existingProduct ? "商品修改已同步到前台。" : "商品已同步到前台。");
    });

  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => reject(new Error("read-failed"));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("decode-failed"));
        image.onload = () => {
          const maximumEdge = 1400;
          const scale = Math.min(1, maximumEdge / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          canvas.width = width;
          canvas.height = height;
          context.fillStyle = "#1c1b1b";
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        image.src = String(reader.result);
      };

      reader.readAsDataURL(file);
    });
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function orderItemImage(item) {
    const product = products.find((candidate) => String(candidate.id) === String(item.id));
    return safeImageSource(item.image || product?.image);
  }

  function renderLogin() {
    const isSetup = !auth.setup;
    document.title = `${isSetup ? "设置后台密码" : "管理员登录"} · Studio Admin`;
    app.innerHTML = `
      <section class="login-page" aria-label="${isSetup ? "设置后台密码" : "管理员登录"}">
        <div class="login-wrap">
          <form class="login-card" id="login-form" novalidate>
            <div class="login-brand">
              <img class="login-mascot" src="./assets/moru.png" alt="" />
              ${isSetup ? `<div class="login-copy"><h1>设置后台密码</h1><p>第一次使用，请设置管理员账号和密码。密码至少 8 位。</p></div>` : ""}
            </div>
            <div class="field">
              <label for="login-username">管理员账号</label>
              <input id="login-username" name="username" type="text" maxlength="40" placeholder="输入管理员账号" autocomplete="username" required />
            </div>
            <div class="field">
              <div class="field-head">
                <label for="login-password">登录密码</label>
                <button class="text-button" type="button" data-login="reveal">显示</button>
              </div>
              <input id="login-password" name="password" type="password" placeholder="输入密码" autocomplete="${isSetup ? "new-password" : "current-password"}" required />
            </div>
            ${
              isSetup
                ? `<div class="field">
                    <label for="login-confirm">确认密码</label>
                    <input id="login-confirm" name="confirm" type="password" placeholder="再次输入密码" autocomplete="new-password" required />
                  </div>`
                : ""
            }
            <p class="form-error" id="login-error" role="alert"></p>
            <button class="primary-button login-submit" id="login-submit" type="submit">
              <span>${isSetup ? "完成设置并进入后台" : "登录后台"}</span>
              ${icons.arrowOut}
            </button>
            <p class="login-foot">仅限店铺管理员使用</p>
          </form>
        </div>
      </section>`;

    const form = document.getElementById("login-form");
    const error = document.getElementById("login-error");
    const submit = document.getElementById("login-submit");
    const password = document.getElementById("login-password");
    document.getElementById("login-username").focus();

    form.querySelector('[data-login="reveal"]').addEventListener("click", (event) => {
      const showing = password.type === "text";
      password.type = showing ? "password" : "text";
      event.currentTarget.textContent = showing ? "显示" : "隐藏";
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const username = String(data.get("username") || "").trim();
      const pass = String(data.get("password") || "");
      error.textContent = "";
      if (!username || !pass) {
        error.textContent = "请输入账号和密码。";
        return;
      }
      if (isSetup && pass.length < 8) {
        error.textContent = "密码至少需要 8 位。";
        return;
      }
      if (isSetup && pass !== data.get("confirm")) {
        error.textContent = "两次输入的密码不一致。";
        return;
      }
      submit.disabled = true;
      try {
        await api(`${AUTH_API}/${isSetup ? "setup" : "login"}`, {
          method: "POST",
          body: JSON.stringify({ username, password: pass }),
        });
        auth = { setup: true, authed: true };
        await loadOrders();
        startOrderPoll();
        render();
        syncFromServer();
        showToast(isSetup ? "后台密码已设置。" : "已登录。");
      } catch (loginError) {
        error.textContent = loginError.message;
        submit.disabled = false;
      }
    });
  }

  function orderRow(order) {
    const no = escapeHTML(order.no);
    return `
      <a class="order-row" href="#/orders/${encodeURIComponent(order.no)}">
        <div class="order-id">
          <b>单号${no}</b>
          <small>${escapeHTML(formatTime(order.createdAt))}</small>
        </div>
        <div class="order-meta">
          <small>收件人</small>
          <span>${escapeHTML(order.name)}</span>
        </div>
        <div class="order-meta">
          <small>金额</small>
          <span class="order-amount">¥${formatPrice(order.total)}</span>
        </div>
        <div class="order-side">
          <span class="order-go">${escapeHTML(ORDER_STATUS[order.status]?.action || "查看订单")}${icons.arrow}</span>
        </div>
      </a>`;
  }

  function emptyTraffic() {
    return {
      today: 0,
      yesterday: 0,
      week: 0,
      online: 0,
      todayDelta: 0,
      weekDelta: 0,
      days: Array.from({ length: 7 }, (_, i) => ({
        label: i === 6 ? "今" : "—",
        value: 0,
        today: i === 6,
      })),
      devices: [
        { label: "手机", pct: 0 },
        { label: "电脑", pct: 0 },
        { label: "平板", pct: 0 },
      ],
      pages: [],
      regions: [],
      live: false,
    };
  }

  /**
   * 取访问统计的口令。第一次用会弹一次输入框，之后存在本机。
   * 传 force=true 表示把已存的清掉重新问（口令换了或输错时用）。
   */
  function trafficToken(force = false) {
    let token = "";
    try {
      if (force) localStorage.removeItem(TRAFFIC_TOKEN_KEY);
      else token = localStorage.getItem(TRAFFIC_TOKEN_KEY) || "";
    } catch (_) {
      token = "";
    }
    if (token) return token;

    const input = window.prompt(
      "访问监控需要后台口令（填一次就存在本机，不用每次填）。\n口令就是设置 Cloudflare ADMIN_TOKEN 时用的那串。"
    );
    token = String(input || "").trim();
    if (token) {
      try {
        localStorage.setItem(TRAFFIC_TOKEN_KEY, token);
      } catch (_) {}
    }
    return token;
  }

  async function loadTraffic(range = trafficRange, allowRetry = true) {
    const token = trafficToken(false);
    if (!token) {
      throw new Error("需要后台口令才能看访问数据。退出这一页再进来会重新问你一次。");
    }
    const qs = new URLSearchParams({ range, token });
    const response = await fetch(`${TRAFFIC_API}?${qs}`, {
      cache: "no-store",
    });
    if (response.status === 401 && allowRetry) {
      // 口令不对：清掉本地存的，重问一次
      trafficToken(true);
      return loadTraffic(range, false);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    trafficCache = data;
    trafficRange = range;
    return data;
  }

  function paintTraffic(data, { loading = false, error = "" } = {}) {
    const safe = data && Array.isArray(data.days) ? data : emptyTraffic();
    const max = Math.max(...safe.days.map((d) => d.value), 1);
    const todayLabel = new Date().toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });
    const bars = safe.days
      .map((day) => {
        const height = Math.max(4, Math.round((day.value / max) * 100));
        return `
          <div class="traffic-bar${day.today ? " is-today" : ""}">
            <span class="bar-val">${day.value}</span>
            <span class="bar" style="height: ${height}%"></span>
            <span class="bar-day">${escapeHTML(day.label)}</span>
          </div>`;
      })
      .join("");
    const devices = (safe.devices || [])
      .map(
        (row) => `
          <div class="split-row">
            <span>${escapeHTML(row.label)}</span>
            <div class="meter" aria-hidden="true"><i style="width: ${row.pct}%"></i></div>
            <b>${row.pct}%</b>
          </div>`,
      )
      .join("");
    const pages = (safe.pages || []).length
      ? safe.pages
          .map(
            (row, index) => `
          <div class="page-row">
            <span class="page-no">${String(index + 1).padStart(2, "0")}</span>
            <span>${escapeHTML(row.label)}</span>
            <b>${row.views}</b>
          </div>`,
          )
          .join("")
      : `<div class="page-row"><span class="page-no">—</span><span>暂无页面数据</span><b>0</b></div>`;
    const regions = (safe.regions || []).length
      ? safe.regions
          .map(
            (row) => `
          <div class="geo-row">
            <div class="geo-name">
              <b>${escapeHTML(row.label)}</b>
              ${row.detail ? `<span>${escapeHTML(row.detail)}</span>` : ""}
            </div>
            <div class="geo-num"><span>${row.count} 人</span><b>${row.pct}%</b></div>
            <div class="meter" aria-hidden="true"><i style="width: ${row.pct}%"></i></div>
          </div>`,
          )
          .join("")
      : `<p class="traffic-note">地区从现在开始记。之前打开过的人没有地区。</p>`;
    const regionLead = (safe.regions || []).slice(0, 5).map((row) => row.label).join(" · ");
    const pageNote =
      trafficRange === "30"
        ? "热门页为近 30 日浏览次数。"
        : trafficRange === "all"
          ? "热门页为全部留存期内浏览次数。"
          : "热门页为近 7 日浏览次数。";
    const banner = error
      ? `<div class="traffic-banner">${escapeHTML(error)}</div>`
      : loading
        ? `<div class="traffic-banner">正在读取访问数据…</div>`
        : `<div class="traffic-banner">统计 Cloudflare 公网访问；本机与局域网不计。</div>`;

    document.title = "访问监控 · Studio Admin";
    app.innerHTML = `
      <section class="page traffic-page" aria-label="访问监控">
        ${banner}
        <div class="traffic-head">
          <div>
            <h1>访问监控</h1>
            <p>看店铺有多少人来过 · 今天 ${escapeHTML(todayLabel)}</p>
          </div>
          <div class="traffic-range" role="group" aria-label="时间范围">
            <button class="tab${trafficRange === "7" ? " is-on" : ""}" type="button" data-traffic-range="7">近 7 日</button>
            <button class="tab${trafficRange === "30" ? " is-on" : ""}" type="button" data-traffic-range="30">近 30 日</button>
            <button class="tab${trafficRange === "all" ? " is-on" : ""}" type="button" data-traffic-range="all">全部</button>
          </div>
        </div>
        <div class="traffic-kpis">
          <article class="kpi-card">
            <span class="kpi-label">今日访客</span>
            <div class="kpi-value">${safe.today}</div>
            <div class="kpi-foot">
              <span class="kpi-delta ${safe.todayDelta >= 0 ? "is-up" : "is-down"}">${safe.todayDelta >= 0 ? "↑" : "↓"} ${Math.abs(safe.todayDelta)}%</span>
              <span>较昨日</span>
            </div>
          </article>
          <article class="kpi-card">
            <span class="kpi-label">昨日访客</span>
            <div class="kpi-value">${safe.yesterday}</div>
            <div class="kpi-foot"><span>独立访客 UV</span></div>
          </article>
          <article class="kpi-card">
            <span class="kpi-label">近 7 日</span>
            <div class="kpi-value">${safe.week}</div>
            <div class="kpi-foot">
              <span class="kpi-delta ${safe.weekDelta >= 0 ? "is-up" : "is-down"}">${safe.weekDelta >= 0 ? "↑" : "↓"} ${Math.abs(safe.weekDelta)}%</span>
              <span>较上周</span>
            </div>
          </article>
          <article class="kpi-card">
            <span class="kpi-label">当前在线</span>
            <div class="kpi-value">${safe.online}</div>
            <div class="kpi-foot">
              <span class="kpi-live"><i></i>实时</span>
              <span>5 分钟内</span>
            </div>
          </article>
        </div>
        <div class="traffic-grid">
          <section class="traffic-panel" aria-label="近七日访客">
            <div class="panel-kicker"><h2>近 7 日访客</h2><span>WEEK</span></div>
            <div class="traffic-chart">${bars}</div>
            <p class="traffic-note">柱高按当日独立访客统计，今日会随时间增长。</p>
          </section>
          <section class="traffic-panel" aria-label="来源与页面">
            <div class="panel-kicker"><h2>设备与热门页</h2><span>DEVICES & PAGES</span></div>
            <div class="split-list">${devices}</div>
            <div class="page-list">${pages}</div>
            <p class="traffic-note">${pageNote}</p>
          </section>
        </div>
        <div class="traffic-grid">
          <section class="traffic-panel" aria-label="访客地区">
            <div class="panel-kicker">
              <div>
                <h2>访客地区</h2>
                <p class="traffic-note" style="margin-top:4px">按 Cloudflare 边缘节点看到的城市，不保存 IP</p>
              </div>
              <span>GEO</span>
            </div>
            ${regionLead ? `<p class="geo-lead">${escapeHTML(regionLead)}</p>` : ""}
            <div class="geo-list">${regions}</div>
          </section>
          <section class="traffic-panel" aria-label="Moru 用量">
            <div class="panel-kicker">
              <div>
                <h2>Moru 助手用量</h2>
                <p class="traffic-note" style="margin-top:4px">公网 Moru 用本地回答，不走付费模型</p>
              </div>
              <span>AI</span>
            </div>
            <div class="token-grid">
              <article><span>本期总用量</span><b>0</b><small>尚未接入</small></article>
              <article><span>单次均耗</span><b>0</b><small>无调用记录</small></article>
              <article><span>额度成本</span><b>0</b><small>公网不扣费</small></article>
            </div>
            <p class="traffic-note">2015 上的 DeepSeek 用量还没有接到这块。这里不会显示示意数字。</p>
          </section>
        </div>
      </section>`;
  }

  function stopTrafficPoll() {
    window.clearInterval(trafficPoll);
    trafficPoll = 0;
  }

  function startTrafficPoll() {
    stopTrafficPoll();
    trafficPoll = window.setInterval(() => {
      if (readRoute().name !== "traffic" || !auth.authed) {
        stopTrafficPoll();
        return;
      }
      loadTraffic(trafficRange)
        .then((data) => paintTraffic(data))
        .catch(() => {});
    }, 30000);
  }

  async function renderTraffic() {
    paintTraffic(trafficCache || emptyTraffic(), { loading: !trafficCache });
    try {
      const data = await loadTraffic(trafficRange);
      if (readRoute().name !== "traffic") return;
      paintTraffic(data);
      startTrafficPoll();
    } catch (error) {
      if (readRoute().name !== "traffic") return;
      paintTraffic(trafficCache || emptyTraffic(), {
        error: error.message || "无法读取访问数据，请确认店铺服务正在运行。",
      });
    }
  }

  function renderOrders() {
    const counts = Object.fromEntries(
      Object.keys(ORDER_STATUS).map((key) => [key, orders.filter((order) => order.status === key).length]),
    );
    const visible = orders.filter((order) => order.status === orderTab);
    const tabs = Object.entries(ORDER_STATUS)
      .map(
        ([key, { label }]) => `
          <button class="tab${key === orderTab ? " is-on" : ""}" type="button" data-tab="${key}" aria-pressed="${key === orderTab}">
            ${label}<i>${String(counts[key]).padStart(2, "0")}</i>
          </button>`,
      )
      .join("");

    document.title = "订单管理 · Studio Admin";
    app.innerHTML = `
      <section class="page orders-page" aria-label="订单管理">
        <div class="tabs" role="group" aria-label="订单状态">${tabs}</div>
        ${
          visible.length
            ? `<div class="order-list">${visible.map(orderRow).join("")}</div>`
            : `<div class="empty-state">
                <h2>暂无${escapeHTML(ORDER_STATUS[orderTab].label)}订单</h2>
                <p>${orderTab === "pending" ? "顾客点击「我已支付」后，订单会出现在这里。" : "处理好的订单会自动移到下一个状态。"}</p>
              </div>`
        }
      </section>`;
  }

  function renderOrderDetail(order) {
    const isPending = order.status === "pending";
    const isPaid = order.status === "paid";
    const isShipped = order.status === "shipped";
    const items = order.items
      .map(
        (item) => `
          <div class="order-item">
            <img src="${orderItemImage(item)}" alt="${escapeHTML(item.name)}" />
            <div class="order-item-copy">
              <b>${escapeHTML(item.name)}</b>
              <small>¥${formatPrice(item.price)} × ${escapeHTML(item.qty)}</small>
            </div>
            <span class="order-item-sum">¥${formatPrice(item.price * item.qty)}</span>
          </div>`,
      )
      .join("");

    document.title = `订单 ${order.no} · Studio Admin`;
    app.innerHTML = `
      <section class="page order-page" aria-label="订单详情">
        <a class="back-link" href="#/orders">${icons.back}返回订单列表</a>

        <div class="panel order-head">
          <div>
            <small>订单单号</small>
            <h1>${escapeHTML(order.no)}</h1>
          </div>
          <div class="order-head-side">
            <small>下单时间 ${escapeHTML(formatTime(order.createdAt))}</small>
          </div>
        </div>

        <div class="panel">
          <h2 class="panel-title">订购商品与结算</h2>
          <div class="order-items">${items}</div>
          <div class="order-totals">
            <div><span>商品金额</span><span>¥${formatPrice(order.total)}</span></div>
            <div><span>物流运费</span><span>¥0</span></div>
            <div class="is-due"><span>实付总计</span><b>¥${formatPrice(order.total)}</b></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title-row">
            <h2 class="panel-title">收件信息</h2>
            <button class="chip-button" type="button" data-order-action="copy">${icons.copy}复制地址</button>
          </div>
          <div class="recipient">
            <div class="recipient-line"><b>${escapeHTML(order.name)}</b><span>${escapeHTML(order.phone)}</span></div>
            <p>${escapeHTML(order.address)}</p>
          </div>
          <div class="order-totals">
            <div><span>支付方式</span><span>${escapeHTML(PAYMENT_LABELS[order.method] || order.method)}</span></div>
          </div>
        </div>

        <div class="panel">
          <h2 class="panel-title">履约操作处理</h2>
          <div class="steps">
            <div class="step${isPending ? " is-current" : " is-done"}">
              <div class="step-head">
                <b><i>${isPending ? "1" : icons.check}</i>财务核算</b>
                <span>${isPending ? "待确认" : "已确认"}</span>
              </div>
              ${
                isPending
                  ? `<p>请在${escapeHTML(PAYMENT_LABELS[order.method] || "收款")}记录中核对金额 <em>¥${formatPrice(order.total)}</em> 与下单时间，确认到账后再点击。</p>
                    <button class="primary-button" type="button" data-order-action="confirm">${icons.check}<span>确认已收款</span></button>`
                  : `<p>已于 ${escapeHTML(formatTime(order.paidAt))} 确认收款。</p>`
              }
            </div>
            <div class="step${isPaid ? " is-current" : isShipped ? " is-done" : " is-locked"}">
              <div class="step-head">
                <b><i>${isShipped ? icons.check : "2"}</i>发货运单</b>
                <span>${isShipped ? "已发货" : isPaid ? "待填写" : "确认收款后可发货"}</span>
              </div>
              ${
                isShipped
                  ? `<p>快递单号 <em>${escapeHTML(order.trackingNo)}</em>，于 ${escapeHTML(formatTime(order.shippedAt))} 发货。</p>`
                  : `<form class="ship-form" id="ship-form">
                      <div class="field">
                        <label for="tracking-no">快递单号</label>
                        <input id="tracking-no" name="trackingNo" type="text" maxlength="40" placeholder="输入顺丰或其他快递单号" autocomplete="off" ${isPaid ? "" : "disabled"} />
                      </div>
                      <button class="primary-button" type="submit" ${isPaid ? "" : "disabled"}><span>确认发货</span>${icons.arrow}</button>
                    </form>`
              }
            </div>
          </div>
        </div>
      </section>`;

    const shipForm = document.getElementById("ship-form");
    if (shipForm && isPaid) {
      shipForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const trackingNo = String(new FormData(shipForm).get("trackingNo") || "").trim();
        if (!trackingNo) {
          showToast("请先填写快递单号。", true);
          return;
        }
        updateOrder(order.no, { action: "ship", trackingNo }, "已发货，订单移到「已发货」。");
      });
    }
  }

  async function updateOrder(no, payload, message) {
    const buttons = app.querySelectorAll("button");
    buttons.forEach((button) => (button.disabled = true));
    try {
      const updated = await api(`${ORDERS_API}/${encodeURIComponent(no)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      orders = orders.map((order) => (order.no === updated.no ? updated : order));
      render();
      showToast(message);
    } catch (error) {
      showToast(error.message, true);
      await loadOrders();
      render();
    }
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    return Promise.resolve();
  }

  function startOrderPoll() {
    window.clearInterval(orderPoll);
    orderPoll = window.setInterval(async () => {
      const route = readRoute();
      if (!route.name.startsWith("order") || app.querySelector("input:focus")) return;
      const before = JSON.stringify(orders);
      if ((await loadOrders()) && JSON.stringify(orders) !== before) {
        const newest = orders.filter((order) => order.status === "pending").length;
        render();
        if (route.name === "orders") showToast(`订单已更新，待确认收款 ${newest} 笔。`);
      }
    }, 15000);
  }

  function render() {
    const route = readRoute();
    document.body.classList.toggle("is-locked", !auth.authed);
    if (!auth.authed) {
      stopTrafficPoll();
      renderLogin();
      return;
    }
    setActiveNavigation(route.name);
    if (route.name !== "traffic") stopTrafficPoll();

    if (route.name === "orders") {
      renderOrders();
    } else if (route.name === "order") {
      const order = orders.find((candidate) => candidate.no === route.id);
      if (order) {
        renderOrderDetail(order);
      } else {
        window.location.hash = "#/orders";
        showToast("没有找到这个订单。", true);
      }
    } else if (route.name === "traffic") {
      renderTraffic();
    } else if (route.name === "new") {
      renderForm();
    } else if (route.name === "edit") {
      const product = products.find(
        (candidate) => String(candidate.id) === route.id,
      );
      if (product) {
        renderForm(product);
      } else {
        window.location.hash = "#/products";
        showToast("没有找到这件商品。", true);
      }
    } else {
      renderProducts();
    }

    window.scrollTo({ top: 0, behavior: "instant" });
  }

  app.addEventListener("click", (event) => {
    const rangeBtn = event.target.closest("[data-traffic-range]");
    if (rangeBtn) {
      const next = rangeBtn.dataset.trafficRange || "7";
      if (next === trafficRange) return;
      trafficRange = next;
      app.querySelectorAll("[data-traffic-range]").forEach((btn) => {
        btn.classList.toggle("is-on", btn === rangeBtn);
      });
      paintTraffic(trafficCache || emptyTraffic(), { loading: true });
      loadTraffic(next)
        .then((data) => {
          if (readRoute().name !== "traffic") return;
          paintTraffic(data);
        })
        .catch((error) => {
          if (readRoute().name !== "traffic") return;
          paintTraffic(trafficCache || emptyTraffic(), {
            error: error.message || "无法读取访问数据。",
          });
        });
      return;
    }

    const tab = event.target.closest("[data-tab]");
    if (tab) {
      orderTab = tab.dataset.tab;
      renderOrders();
      return;
    }

    const orderAction = event.target.closest("[data-order-action]");
    if (orderAction) {
      const order = orders.find((candidate) => candidate.no === readRoute().id);
      if (!order) return;
      if (orderAction.dataset.orderAction === "copy") {
        copyText(`${order.name} ${order.phone} ${order.address}`)
          .then(() => showToast("收件信息已复制。"))
          .catch(() => showToast("复制失败，请手动选择文字。", true));
      } else if (orderAction.dataset.orderAction === "confirm") {
        updateOrder(order.no, { action: "confirm" }, "已确认收款，订单移到「待发货」。");
      }
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    const product = products.find(
      (candidate) => String(candidate.id) === actionButton.dataset.id,
    );
    if (!product) return;

    if (actionButton.dataset.action === "edit") {
      window.location.hash = `#/edit/${encodeURIComponent(product.id)}`;
      return;
    }

    if (actionButton.dataset.action === "toggle") {
      const nextStatus = product.status === "active" ? "inactive" : "active";
      const nextProducts = products.map((candidate) =>
        candidate.id === product.id
          ? { ...candidate, status: nextStatus, updatedAt: new Date().toISOString() }
          : candidate,
      );

      if (commitProducts(nextProducts)) {
        renderProducts();
        showToast(nextStatus === "active" ? "商品已上架。" : "商品已下架。");
      }
      return;
    }

    if (actionButton.dataset.action === "stock") {
      const goingOut = product.stock !== "pre-order";
      const nextProducts = products.map((candidate) =>
        candidate.id === product.id
          ? {
              ...candidate,
              stock: goingOut ? "pre-order" : "in-stock",
              updatedAt: new Date().toISOString(),
            }
          : candidate,
      );

      if (commitProducts(nextProducts)) {
        renderProducts();
        showToast(
          goingOut
            ? "已标记缺货，顾客下单时按预付款处理。"
            : "已改回现货。",
        );
      }
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-global-action="storefront"]')) {
      window.location.href = "../index.html";
    }
  });

  /* ---- 长按商品卡片拖动排序（鼠标 / 触屏通用） ---- */
  const SORT_PRESS_MS = 380;
  const SORT_SLOP = 8;
  let sort = null;

  function sortSiblings() {
    return sort ? [...sort.list.querySelectorAll(".product-card")] : [];
  }

  function cancelPress() {
    if (!sort) return;
    window.clearTimeout(sort.timer);
    sort.card.classList.remove("is-pressing");
    if (!sort.active) sort = null;
  }

  function startSort() {
    if (!sort) return;
    sort.active = true;
    sort.card.classList.remove("is-pressing");
    sort.card.classList.add("is-dragging");
    document.body.classList.add("is-sorting");
    sort.startOffset = sort.card.offsetTop;
    sort.startPageY = sort.lastY + window.scrollY;
    if (navigator.vibrate) navigator.vibrate(12);
    sort.raf = window.requestAnimationFrame(sortAutoScroll);
  }

  function placeDragged() {
    const { card, lastY } = sort;
    const pageY = lastY + window.scrollY;
    card.style.transform = `translateY(${pageY - sort.startPageY - (card.offsetTop - sort.startOffset)}px)`;
  }

  function reorderUnderPointer() {
    const { card, list, lastY } = sort;
    const others = sortSiblings().filter((el) => el !== card);
    const center = sort.startOffset + (lastY + window.scrollY - sort.startPageY) + card.offsetHeight / 2;
    const before = others.find((el) => center < el.offsetTop + el.offsetHeight / 2);
    const currentNext = card.nextElementSibling;
    if (before === currentNext || (!before && !currentNext)) return;

    // FLIP：其余卡片平滑让位
    const firstRects = new Map(others.map((el) => [el, el.getBoundingClientRect().top]));
    list.insertBefore(card, before || null);
    others.forEach((el) => {
      const dy = firstRects.get(el) - el.getBoundingClientRect().top;
      if (!dy) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      window.requestAnimationFrame(() => {
        el.style.transition = "transform 200ms ease";
        el.style.transform = "";
      });
    });
  }

  function sortAutoScroll() {
    if (!sort || !sort.active) return;
    const edge = 72;
    let speed = 0;
    if (sort.lastY < edge) speed = -Math.ceil((edge - sort.lastY) / 6);
    else if (sort.lastY > window.innerHeight - edge) speed = Math.ceil((sort.lastY - (window.innerHeight - edge)) / 6);
    if (speed) {
      window.scrollBy(0, speed);
      reorderUnderPointer();
      placeDragged();
    }
    sort.raf = window.requestAnimationFrame(sortAutoScroll);
  }

  function finishSort() {
    if (!sort) return;
    const { card, active, raf } = sort;
    window.clearTimeout(sort.timer);
    window.cancelAnimationFrame(raf);
    card.classList.remove("is-pressing");
    if (!active) {
      sort = null;
      return;
    }
    const ids = sortSiblings().map((el) => el.dataset.productId);
    sort = null;
    document.body.classList.remove("is-sorting");

    card.style.transition = "transform 180ms ease";
    card.style.transform = "";
    window.setTimeout(() => {
      card.classList.remove("is-dragging");
      card.style.transition = "";
    }, 180);

    const changed = ids.some((id, index) => String(products[index]?.id) !== id);
    if (!changed) return;
    const byId = new Map(products.map((p) => [String(p.id), p]));
    const nextProducts = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((p, index) => ({ ...p, no: `NO. ${String(index + 1).padStart(2, "0")}` }));
    if (commitProducts(nextProducts)) {
      window.setTimeout(renderProducts, 200);
      showToast("排序已保存，前台同步更新。");
    }
  }

  app.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    if (event.target.closest("button, a, input")) return;
    const card = event.target.closest(".product-list .product-card");
    if (!card) return;
    sort = {
      card,
      list: card.parentElement,
      pointerId: event.pointerId,
      downX: event.clientX,
      downY: event.clientY,
      lastY: event.clientY,
      active: false,
      timer: 0,
      raf: 0,
    };
    card.classList.add("is-pressing");
    sort.timer = window.setTimeout(startSort, SORT_PRESS_MS);
  });

  window.addEventListener("pointermove", (event) => {
    if (!sort || event.pointerId !== sort.pointerId) return;
    sort.lastY = event.clientY;
    if (!sort.active) {
      if (Math.hypot(event.clientX - sort.downX, event.clientY - sort.downY) > SORT_SLOP) cancelPress();
      return;
    }
    event.preventDefault();
    reorderUnderPointer();
    placeDragged();
  });

  window.addEventListener("pointerup", (event) => {
    if (sort && event.pointerId === sort.pointerId) finishSort();
  });
  window.addEventListener("pointercancel", (event) => {
    if (sort && event.pointerId === sort.pointerId) finishSort();
  });

  // 触屏：拖动开始后拦住页面滚动；长按期间屏蔽系统菜单
  window.addEventListener(
    "touchmove",
    (event) => {
      if (sort && sort.active) event.preventDefault();
    },
    { passive: false },
  );
  app.addEventListener("contextmenu", (event) => {
    if (sort || event.target.closest(".product-list .product-card")) event.preventDefault();
  });

  window.addEventListener("hashchange", () => {
    const work = (async () => {
      if (auth.authed && readRoute().name.startsWith("order")) await loadOrders();
      render();
    })();
    finishBootWhenReady(work);
  });
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      products = loadProducts();
      render();
    }
  });

  async function start() {
    const work = (async () => {
      if (!window.location.hash) {
        window.history.replaceState(null, "", "#/orders");
      }
      try {
        auth = await api(AUTH_API);
      } catch {
        auth = { setup: true, authed: false };
      }
      if (auth.authed) {
        await loadOrders();
        startOrderPoll();
      }
      render();
      if (auth.authed) syncFromServer();
    })();
    finishBootWhenReady(work);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  start();
})();
