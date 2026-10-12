/* 上新商品：前台卡片预览与图片位置调整 */
(function () {
  const R = 466 / 188;
  const ARROW =
    '<svg class="ce-go" viewBox="436.969 160.297 12 12" aria-hidden="true"><path d="M446.1 167.047H436.969V165.547H446.1L441.9 161.347L442.969 160.297L448.969 166.297L442.969 172.297L441.9 171.247L446.1 167.047Z" fill="currentColor"/></svg>';
  function absSrc(src) {
    if (!src) return "";
    if (/^(data:|\/|https?:)/.test(src)) return src;
    return "/" + src;
  }

  function parsePhoto(style) {
    if (!style || /background-size\s*:\s*cover/.test(style)) return null;
    const get = (key) => {
      const match = new RegExp("(?:^|;)\\s*" + key + "\\s*:\\s*(-?[\\d.]+)%").exec(style);
      return match ? parseFloat(match[1]) : null;
    };
    const left = get("left");
    const top = get("top");
    const w = get("width");
    return left === null || top === null || w === null ? null : { left, top, w };
  }

  function luminance(hex) {
    const n = parseInt(String(hex).replace("#", "").slice(0, 6), 16);
    if (!Number.isFinite(n)) return 1;
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function autoInk(bg) {
    return luminance(bg) < 0.45 ? "light" : "dark";
  }

  // 取图片左边缘的平均色，作为卡片底色，让图片和底色接得上
  function sampleEdge(img) {
    const canvas = document.createElement("canvas");
    const W = 60;
    const H = Math.max(1, Math.round(W * img.naturalHeight / img.naturalWidth));
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, W, H);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    try {
      const d = ctx.getImageData(0, 0, W, H).data;
      for (let y = 0; y < H; y += 1) {
        for (const x of [0, 1]) {
          const i = (y * W + x) * 4;
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
          n += 1;
        }
      }
    } catch (_) {
      return "#F3F3F1";
    }
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
    return ("#" + hex(r) + hex(g) + hex(b)).toUpperCase();
  }

  function create(root, opts) {
    const options = opts || {};
    const state = {
      raw: "",
      src: "",
      aspect: 1,
      left: 0,
      top: 0,
      w: 100,
      edge: "#F3F3F1",
      bg: options.bg || null,
      ink: options.ink === "light" || options.ink === "dark" ? options.ink : "auto",
      name: options.name || "",
      en: options.en || "",
      no: options.no || "NO. 00",
      ready: false,
    };
    root.innerHTML = `
      <div class="ce-editor is-empty">
        <div class="ce-stage">
          <div class="ce-ghost"><span class="ce-photo"></span></div>
          <div class="ce-card ce-main" data-ink="dark" tabindex="0" aria-label="前台卡片预览，可拖动调整图片位置">
            <span class="ce-photo"></span>
            <span class="ce-face">
              <span class="ce-no"></span>
              <span class="ce-copy"><span class="ce-name"></span><span class="ce-en"></span></span>
              ${ARROW}
            </span>
          </div>
          <i class="ce-guide is-v"></i>
          <i class="ce-guide is-h"></i>
        </div>
        <p class="ce-tip">拖动图片调整位置 · 滚轮或双指缩放 · 方向键微调</p>
        <p class="ce-empty-tip">上传商品图后，可在这里调整它在前台卡片上的位置</p>
      </div>
      <div class="ce-bottom">
        <div class="ce-panel">
          <div class="ce-row">
            <b>快捷摆放</b>
            <div class="ce-seg" data-role="presets">
              <button type="button" data-preset="right"><svg viewBox="0 0 22 10"><rect x=".5" y=".5" width="21" height="9" rx="2" fill="none" stroke="currentColor"/><rect x="11" y="1.5" width="9.5" height="7" rx="1" fill="currentColor"/></svg>靠右</button>
              <button type="button" data-preset="center"><svg viewBox="0 0 22 10"><rect x=".5" y=".5" width="21" height="9" rx="2" fill="none" stroke="currentColor"/><rect x="6.5" y="1.5" width="9" height="7" rx="1" fill="currentColor"/></svg>居中</button>
              <button type="button" data-preset="cover"><svg viewBox="0 0 22 10"><rect x=".5" y=".5" width="21" height="9" rx="2" fill="currentColor"/></svg>铺满</button>
            </div>
            <button class="ce-reset" type="button" data-role="reset">重置</button>
          </div>
          <div class="ce-row">
            <b>缩放</b>
            <div class="ce-zoom">
              <button class="ce-icon" type="button" data-zoom="out" aria-label="缩小">−</button>
              <input type="range" min="50" max="300" step="1" value="100" aria-label="缩放">
              <button class="ce-icon" type="button" data-zoom="in" aria-label="放大">＋</button>
            </div>
          </div>
          <div class="ce-row">
            <b>卡片底色</b>
            <button class="ce-swatch" type="button" data-color="#FFFFFF" style="background:#FFFFFF" aria-label="白色"></button>
            <button class="ce-swatch" type="button" data-color="#141414" style="background:#141414" aria-label="黑色"></button>
            <span class="ce-picker">
              <button class="ce-picker-ring" type="button" title="自动取色（取自图片边缘）" aria-label="自动取色"></button>
              <label class="ce-picker-color" title="自定义颜色"><input type="color" value="#f3f3f1" aria-label="自定义颜色"></label>
            </span>
          </div>
          <div class="ce-row">
            <b>文字颜色</b>
            <div class="ce-seg" data-role="ink">
              <button type="button" data-ink="auto">自动</button>
              <button type="button" data-ink="dark">黑字</button>
              <button type="button" data-ink="light">白字</button>
            </div>
          </div>
        </div>
      </div>`;

    const editor = root.querySelector(".ce-editor");
    const card = root.querySelector(".ce-main");
    const photo = card.querySelector(".ce-photo");
    const ghost = root.querySelector(".ce-ghost .ce-photo");
    const gv = root.querySelector(".ce-guide.is-v");
    const gh = root.querySelector(".ce-guide.is-h");
    const zoom = root.querySelector(".ce-zoom input");
    const presets = root.querySelector('[data-role="presets"]');
    const inkSeg = root.querySelector('[data-role="ink"]');
    const picker = root.querySelector(".ce-picker");

    const hOf = (w) => w * R / state.aspect;
    const fitW = () => 100 * state.aspect / R;
    const autoPreset = () => (state.aspect > R ? "cover" : "right");
    const photoStyle = () =>
      `left:${state.left.toFixed(4)}%;top:${state.top.toFixed(4)}%;width:${state.w.toFixed(4)}%;height:${hOf(state.w).toFixed(4)}%`;
    const currentBg = () => state.bg || state.edge;
    const currentInk = () => (state.ink === "auto" ? autoInk(currentBg()) : state.ink);

    function markPreset(kind) {
      presets.querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.preset === kind));
    }

    function preset(kind) {
      const fit = fitW();
      if (kind === "cover") {
        state.w = Math.max(100, fit);
        state.left = (100 - state.w) / 2;
        state.top = (100 - hOf(state.w)) / 2;
      } else {
        state.w = fit;
        state.top = 0;
        state.left = kind === "right" ? 100 - fit : (100 - fit) / 2;
      }
      markPreset(kind);
      render();
    }

    function zoomAt(nextW, cx, cy) {
      if (!state.ready) return;
      nextW = Math.max(fitW() * 0.5, Math.min(fitW() * 3, nextW));
      const k = nextW / state.w;
      state.left = cx - (cx - state.left) * k;
      state.top = cy - (cy - state.top) * k;
      state.w = nextW;
      markPreset(null);
      render();
    }

    function snap() {
      const T = 1.6;
      const h = hOf(state.w);
      let sv = null;
      let sh = null;
      for (const [edge, target] of [[state.left, 0], [state.left + state.w, 100], [state.left + state.w / 2, 50]]) {
        if (Math.abs(edge - target) < T) {
          state.left += target - edge;
          sv = target;
          break;
        }
      }
      for (const [edge, target] of [[state.top, 0], [state.top + h, 100], [state.top + h / 2, 50]]) {
        if (Math.abs(edge - target) < T) {
          state.top += target - edge;
          sh = target;
          break;
        }
      }
      gv.classList.toggle("is-on", sv !== null);
      gh.classList.toggle("is-on", sh !== null);
      if (sv !== null) gv.style.left = sv + "%";
      if (sh !== null) gh.style.top = sh + "%";
    }

    function render() {
      const bg = currentBg();
      const ink = currentInk();
      const style = state.ready ? photoStyle() : "";
      const image = state.ready ? `background-image:url('${state.src.replace(/'/g, "%27")}');` : "";
      editor.classList.toggle("is-empty", !state.ready);
      card.style.setProperty("--card", bg);
      card.dataset.ink = ink;
      photo.style.cssText = image + style;
      ghost.style.cssText = image + style;
      card.querySelector(".ce-no").textContent = state.no;
      card.querySelector(".ce-name").textContent = state.name || "商品名字";
      card.querySelector(".ce-en").textContent = state.en || "保存后自动翻译";

      if (state.ready) zoom.value = String(Math.round(state.w / fitW() * 100));
      root.querySelectorAll(".ce-swatch").forEach((s) => s.classList.toggle("is-on", s.dataset.color === state.bg));
      inkSeg.querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.ink === state.ink));
    }

    function setImage(raw, saved) {
      if (raw === state.raw && state.ready) return;
      state.raw = raw || "";
      state.src = absSrc(raw);
      state.ready = false;
      if (!raw) {
        render();
        return;
      }
      const img = new Image();
      img.onload = () => {
        if (state.raw !== raw) return;
        state.aspect = img.naturalWidth / img.naturalHeight || 1;
        state.edge = sampleEdge(img);
        state.ready = true;
        if (saved) {
          state.left = saved.left;
          state.top = saved.top;
          state.w = saved.w;
          markPreset(null);
          render();
        } else {
          state.bg = null;
          preset(autoPreset());
        }
      };
      img.onerror = () => render();
      img.src = state.src;
    }

    // ---- 拖动 / 双指缩放 ----
    const pointers = new Map();
    let last = null;
    let pinch = null;

    // 浏览器原生拖拽会吞掉后续 pointermove，图片就拖不动
    card.addEventListener("dragstart", (e) => e.preventDefault());
    card.addEventListener("pointerdown", (e) => {
      if (!state.ready || e.button !== 0) return;
      e.preventDefault();
      card.focus({ preventScroll: true });
      try {
        card.setPointerCapture(e.pointerId);
      } catch (_) {}
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      editor.classList.add("is-dragging");
      if (pointers.size === 1) last = { x: e.clientX, y: e.clientY };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, w: state.w };
      }
    });
    card.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const box = card.getBoundingClientRect();
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = ((a.x + b.x) / 2 - box.left) / box.width * 100;
        const cy = ((a.y + b.y) / 2 - box.top) / box.height * 100;
        zoomAt(pinch.w * d / pinch.d, cx, cy);
        return;
      }
      if (!last) return;
      state.left += (e.clientX - last.x) / box.width * 100;
      state.top += (e.clientY - last.y) / box.height * 100;
      last = { x: e.clientX, y: e.clientY };
      markPreset(null);
      snap();
      render();
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        const [p] = [...pointers.values()];
        last = { x: p.x, y: p.y };
      }
      if (!pointers.size) {
        last = null;
        editor.classList.remove("is-dragging");
        gv.classList.remove("is-on");
        gh.classList.remove("is-on");
      }
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);

    let ghostTimer = 0;
    card.addEventListener("wheel", (e) => {
      if (!state.ready) return;
      e.preventDefault();
      const box = card.getBoundingClientRect();
      zoomAt(
        state.w * Math.exp(-e.deltaY * 0.0015),
        (e.clientX - box.left) / box.width * 100,
        (e.clientY - box.top) / box.height * 100,
      );
      editor.classList.add("is-zooming");
      clearTimeout(ghostTimer);
      ghostTimer = setTimeout(() => editor.classList.remove("is-zooming"), 500);
    }, { passive: false });

    card.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 2 : 0.25;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (!state.ready || !moves[e.key]) return;
      e.preventDefault();
      state.left += moves[e.key][0];
      state.top += moves[e.key][1] * R;
      markPreset(null);
      render();
    });

    // ---- 控件 ----
    presets.addEventListener("click", (e) => {
      const b = e.target.closest("[data-preset]");
      if (b && state.ready) preset(b.dataset.preset);
    });
    root.querySelector('[data-role="reset"]').addEventListener("click", () => {
      if (state.ready) preset(autoPreset());
    });
    zoom.addEventListener("input", () => zoomAt(fitW() * Number(zoom.value) / 100, 50, 50));
    root.querySelector('[data-zoom="in"]').addEventListener("click", () => zoomAt(state.w * 1.1, 50, 50));
    root.querySelector('[data-zoom="out"]').addEventListener("click", () => zoomAt(state.w / 1.1, 50, 50));
    root.querySelectorAll(".ce-swatch").forEach((s) =>
      s.addEventListener("click", () => {
        state.bg = s.dataset.color;
        render();
      }),
    );
    picker.querySelector(".ce-picker-ring").addEventListener("click", () => {
      state.bg = null;
      render();
    });
    picker.querySelector('input[type="color"]').addEventListener("input", (e) => {
      state.bg = e.target.value.toUpperCase();
      render();
    });
    inkSeg.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ink]");
      if (!b) return;
      state.ink = b.dataset.ink;
      render();
    });

    render();
    setImage(options.src || "", parsePhoto(options.photo));

    return {
      setImage: (raw) => setImage(raw, null),
      setName(name, en) {
        state.name = name;
        state.en = en;
        render();
      },
      value() {
        if (!state.ready) return null;
        return {
          cardImage: state.raw,
          cardPhoto: photoStyle(),
          cardBg: currentBg(),
          cardInk: state.ink === "auto" ? "" : state.ink,
        };
      },
    };
  }

  window.CardEditor = { create };
})();
