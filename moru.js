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

  // 接口根地址：桌面版 app 用内置静态服务跑在 127.0.0.1（没有后端），
  // 直接打 /api/* 会 404，所以本地运行时改走线上站点。
  const PUBLIC_ORIGIN = "https://longying-studio.pages.dev";
  const IS_LOCAL_SHELL =
    location.protocol === "file:" ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const API_BASE = IS_LOCAL_SHELL ? PUBLIC_ORIGIN : "";

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

  /* 桌面版 app 里点「更新」不走浏览器：交回 app 自己下载安装。
     这样下下来的包没有 com.apple.quarantine 隔离标记，装完重启不会再弹
     「无法验证开发者」。网页版仍然是普通下载链接。 */
  function inDesktopApp() {
    return !!window.__MORU_APP_VERSION__;
  }

  function updateHref(rel) {
    if (!rel) return "#";
    if (!inDesktopApp()) return rel.dmgUrl || "#";
    const q = "u=" + encodeURIComponent(rel.dmgUrl || "") +
              "&s=" + encodeURIComponent(rel.sha256 || "") +
              "&v=" + encodeURIComponent(rel.version || "");
    return "moru://update?" + q;
  }

  function showUpdateBanner(rel) {
    if (root.querySelector(".moru-update")) return;
    const el = document.createElement("div");
    el.className = "moru-update";
    el.setAttribute("role", "status");

    const text = document.createElement("div");
    text.className = "moru-update-text";

    const link = document.createElement("a");
    link.className = "moru-update-link";
    link.href = updateHref(rel);
    if (!inDesktopApp()) {
      link.target = "_blank";
      link.rel = "noopener";
    }
    link.textContent = "点击这里";

    // 就是一句普通的话：正文 + 行内蓝色链接，没有色块、没有叉、没有圆点
    text.textContent = `Moru Studio v${rel.version}的更新已就绪，`;
    text.appendChild(link);
    text.appendChild(document.createTextNode(inDesktopApp() ? "更新" : "去下载"));

    el.appendChild(text);

    // 放进气泡最前面：流内元素，把气泡实打实撑高，不压在输入框上。
    // setReply 只清 logEl，不会误删这条提示。
    bubble.insertBefore(el, bubble.firstChild);
    root.classList.add("is-update");

    const dismiss = () => {
      el.remove();
      root.classList.remove("is-update");
      try { localStorage.setItem(RELEASE_SEEN_KEY, rel.version); } catch (_) {}
    };
    link.addEventListener("click", dismiss);
  }

  /* 网页版专属：每次进来都在聊天框提示下载桌面端。
     桌面 app 用户自己就是软件版，不需要这条；且链接带 target=_blank，
     shop.js 不会把它当站内跳转拦截，点一下开新标签直接下 dmg。
     不写 localStorage「已读」，所以每次访问都弹。
     但用户一旦开口问别的问题，这条就让位（见 clearDownloadCta）——
     本次访问不再回来，下次进来重新弹。 */
  let ctaDismissed = false;
  function clearDownloadCta() {
    const cta = bubble.querySelector(".moru-download-cta");
    if (cta) cta.remove();
    if (!bubble.querySelector(".moru-update")) root.classList.remove("is-update");
    ctaDismissed = true;
  }
  function showDownloadCta(rel) {
    if (ctaDismissed) return;
    if (root.querySelector(".moru-download-cta")) return;
    const ver = (rel && rel.version) || "1.0.11";
    const dmg = (rel && rel.dmgUrl) || "https://longying-studio.pages.dev/download/Moru-Studio.dmg";
    const el = document.createElement("div");
    el.className = "moru-update moru-download-cta";
    el.setAttribute("role", "status");
    const text = document.createElement("div");
    text.className = "moru-update-text";
    // 桌面版目前只支持 macOS（Apple 芯片）。Windows 访客只告知现状，不再给下载链接，
    // 否则会下到一个用不了的 .dmg。
    const isWindows = /Windows\sNT/.test(navigator.userAgent || "");
    if (isWindows) {
      text.textContent = "Moru Studio 桌面版目前仅支持 macOS（Apple 芯片），Windows 版敬请期待。";
    } else {
      text.textContent = `Moru Studio v${ver} 桌面端已就绪，`;
      const link = document.createElement("a");
      link.className = "moru-update-link";
      link.href = dmg;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "点击这里去下载";
      text.appendChild(link);
    }
    el.appendChild(text);
    bubble.insertBefore(el, bubble.firstChild);
    root.classList.add("is-update");
  }

  /* 线上最新版本清单（跨域 script，免 CORS）。
     force = true 时无视缓存重新拉——问「是不是最新版」必须拿最新的，
     否则 app 一直开着，答案还是启动那一刻的旧数据。 */
  let latestRelease = null;
  function loadRelease(force) {
    if (latestRelease && !force) return Promise.resolve(latestRelease);
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = RELEASE_JS_URL + "?t=" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
      s.async = true;
      s.onload = () => {
        latestRelease = window.__MORU_RELEASE__ || latestRelease;
        resolve(latestRelease);
      };
      s.onerror = () => resolve(latestRelease);
      document.head.appendChild(s);
    });
  }

  function maybeShowUpdate(rel) {
    if (!rel || !rel.version) return;
    // 网页版：每次进来都提示下载桌面端（桌面 app 自己就是软件版，无需此提示）
    if (!inDesktopApp()) { showDownloadCta(rel); return; }
    // 桌面版 app 里，打包时会把「这一版自己是几点几」写进 app 的 moru.js 首行。
    // 已经装上的版本 >= 清单版本，就没什么可更新的，别再提示（否则装完就弹自己）。
    const self = window.__MORU_APP_VERSION__ || null;
    if (self && cmpVersion(rel.version, self) <= 0) return;
    let seen = null;
    try { seen = localStorage.getItem(RELEASE_SEEN_KEY); } catch (_) {}
    if (!seen) {
      // 第一次来：记下当前版本，不弹（已经是新的）
      try { localStorage.setItem(RELEASE_SEEN_KEY, rel.version); } catch (_) {}
      return;
    }
    if (cmpVersion(rel.version, seen) > 0) showUpdateBanner(rel);
  }

  // force=false：用缓存（启动那一次）；force=true：重新拉最新
  function checkForUpdate(force) {
    loadRelease(force).then(maybeShowUpdate);
  }

  /* 「是不是新版 / 现在是什么版本 / 有新版吗」——这类问题本地直接答，
     不打扰大模型，回答里带上当前版本号和是不是最新。 */
  function isVersionQuestion(t) {
    const s = String(t || "").replace(/\s+/g, "");
    return /(版本|升级|新版|最新版|version)/i.test(s);
  }

  function buildVersionReply() {
    const self = window.__MORU_APP_VERSION__ || null;
    const rel = latestRelease;
    const latest = rel && rel.version ? rel.version : null;
    const url = rel && rel.dmgUrl ? updateHref(rel) : null;
    if (self && latest) {
      if (cmpVersion(latest, self) <= 0) {
        return { text: `你现在是 v${self}，已经是最新版啦～`, url: null };
      }
      return { text: `你现在是 v${self}，最新版是 v${latest}。`, url };
    }
    if (self) return { text: `你现在是 v${self}；最新版本号这会儿没查到，过一会儿再问我试试。`, url: null };
    if (latest) {
      return { text: `你用的是网页版，没有本地版本号；商店最新版是 v${latest}。`, url };
    }
    return { text: "版本信息暂时查不到，稍等一下再问我吧。", url: null };
  }

  /* ---- 闲聊：天气、打招呼、小情绪、玩笑…本地直接俏皮接话，不占用大模型 ---- */
  const CASUAL_CITIES = ["北京","上海","广州","深圳","杭州","成都","武汉","南京","西安","重庆","苏州","天津","长沙","青岛","厦门","昆明","大连","宁波","无锡","福州","济南","合肥","郑州","哈尔滨","沈阳","长春","石家庄","太原","南昌","南宁","贵阳","兰州","海口","三亚","香港","澳门","台北","台中","高雄","东京","大阪","纽约","伦敦","巴黎","新加坡","悉尼","洛杉矶","首尔","曼谷"];

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function wmoText(code) {
    const map = {
      0: ["晴", "☀️"], 1: ["大致晴朗", "🌤"], 2: ["局部多云", "⛅️"], 3: ["阴", "☁️"],
      45: ["有雾", "🌫"], 48: ["有雾凇", "🌫"], 51: ["毛毛雨", "🌦"], 53: ["毛毛雨", "🌦"], 55: ["毛毛雨", "🌦"],
      61: ["小雨", "🌧"], 63: ["中雨", "🌧"], 65: ["大雨", "🌧"], 66: ["冻雨", "🌧"], 67: ["冻雨", "🌧"],
      71: ["小雪", "🌨"], 73: ["中雪", "🌨"], 75: ["大雪", "❄️"], 77: ["雪粒", "🌨"],
      80: ["阵雨", "🌦"], 81: ["阵雨", "🌦"], 82: ["强阵雨", "⛈"], 85: ["阵雪", "🌨"], 86: ["阵雪", "🌨"],
      95: ["雷阵雨", "⛈"], 96: ["雷阵雨伴冰雹", "⛈"], 99: ["强雷暴冰雹", "⛈"],
    };
    return map[code] || ["天气多变", "🌡"];
  }

  function weatherComment(temp, code) {
    const txt = wmoText(code)[0];
    if (/雨/.test(txt)) return "出门记得带伞哦☂️";
    if (/雪/.test(txt)) return "下雪啦，注意保暖🧣";
    if (/雾/.test(txt)) return "有雾，出门慢点～";
    if (code === 0 || code === 1) return "天气不错，适合逛店（我说的😎）";
    if (temp >= 33) return "这也太热了，躲空调房最香～";
    if (temp <= 5) return "冻成狗的话多穿点🧣";
    return "温度还行，散个步正合适～";
  }

  async function fetchWeather(city) {
    try {
      const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`);
      const gd = await g.json();
      const r = gd && gd.results && gd.results[0];
      if (!r) return null;
      const f = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${r.latitude}&longitude=${r.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`);
      const fd = await f.json();
      const c = fd && fd.current;
      if (!c) return null;
      return { city: r.name, temp: Math.round(c.temperature_2m), apparent: Math.round(c.apparent_temperature), humidity: c.relative_humidity_2m, wind: Math.round(c.wind_speed_10m), code: c.weather_code };
    } catch (_) {
      return null;
    }
  }

  async function buildWeatherReply(text) {
    const s = String(text || "");
    let city = null;
    for (const c of CASUAL_CITIES) if (s.includes(c)) { city = c; break; }
    if (!city) {
      const m = s.match(/([\u4e00-\u9fa5A-Za-z]{2,12}?)(?:的)?(?:天气|气温|温度|几度|冷不冷|热不冷|下雨|下雪|升温|降温)/);
      if (m && !/^(今|明|昨|现|这|那|你|我|咱|这儿|那儿)/.test(m[1])) city = m[1];
    }
    if (!city) {
      return pick([
        "你在哪座城市呀？说个地名我就告诉你～比如「上海天气」。",
        "想问哪的天气？把城市名甩给我，比如「北京今天冷吗」。",
      ]);
    }
    const w = await fetchWeather(city);
    if (!w) {
      return pick([
        `没查到「${city}」的天气，换个写法试试？比如「上海天气」。`,
        `「${city}」这地方我查不到天气，换个地名呗～`,
      ]);
    }
    const txtEmoji = wmoText(w.code);
    const feel = w.apparent !== w.temp ? `（体感 ${w.apparent}°C）` : "";
    return `${w.city}现在 ${w.temp}°C${feel}，${txtEmoji[0]}${txtEmoji[1]}。${weatherComment(w.temp, w.code)}`;
  }

  function isCasualChat(t) {
    const raw = String(t || "");
    const s = raw.replace(/\s+/g, "").toLowerCase();
    if (/天气|气温|几度|温度|冷不冷|热不冷|冷吗|热吗|热不热|冷不热|下雨|下雪|升温|降温/.test(s)) return true;
    if (/(^|[^a-z])(hi|hello|hey|morning|good\s*night|good\s*evening|how\s*are\s*you|what'?s\s*up)\b/.test(s)) return true;
    const strong = ["吃了吗","吃饭了吗","吃了没","在干嘛","在干啥","在做什么","无聊","陪我聊","聊聊天","闲聊","讲个笑话","说个笑话","来个段子","冷笑话","你是谁","你叫啥","你叫什么","你名字","你多大了","你几岁","你是男是女","男生还是女生","你是机器人吗","你是真人吗","你是ai","你是人工智能吗","你是干嘛的","你做啥的","你是什么东西","你是什么","你心情","你今天心情","心情怎么样"];
    if (strong.some((w) => s.includes(w.toLowerCase()))) return true;
    // 纯打招呼：去掉招呼词和标点后应当啥也不剩（避免「你好，这个多少钱」被误判）
    const greet = ["你好","您好","嗨","哈喽","在吗","在不在","有人吗","早上好","早安","上午好","中午好","下午好","晚上好","晚安"];
    let left = raw;
    for (const g of greet) left = left.split(g).join("");
    left = left.replace(/[\s,，。.!！?？~～、()（）]/g, "");
    return left.length === 0;
  }

  async function buildCasualReply(text) {
    const s = String(text || "").replace(/\s+/g, "").toLowerCase();
    if (/天气|气温|几度|温度|冷不冷|热不冷|冷吗|热吗|热不热|冷不热|下雨|下雪|升温|降温/.test(s)) return await buildWeatherReply(text);
    if (/(^|[^a-z])(hi|hello|hey)\b/.test(s)) return pick(["嗨～我在呢，想聊点啥都行～", "Hello呀～今天想看点啥？"]);
    if (/你好|您好|嗨|哈喽/.test(s)) return pick(["嗨～我在呢，想聊点啥都行～", "你好呀～我是 Moru，陪你聊天、帮你逛店都行。"]);
    if (/早安|早上好|上午好/.test(s)) return pick(["早呀～今天也要元气满满哦（我是说你自己😉）", "早安！新的一天，要不要先逛逛新品？"]);
    if (/晚安|晚上好|good\s*night/.test(s)) return pick(["晚安～早点休息，明儿见👋", "晚上好呀～今天辛苦了，记得喝水。"]);
    if (/在吗|在不在|有人吗/.test(s)) return pick(["在的在的，我一直都在～", "喏，我在这儿呢，喊我啥事？"]);
    if (/吃了吗|吃饭了吗|吃了没/.test(s)) return pick(["我没嘴吃，但你已经吃了的话记得替我嚼两口😄", "你吃了吗？没吃快去，别饿着跟我聊天呀～"]);
    if (/在干嘛|在干啥|在做什么|what'?s\s*up|在忙/.test(s)) return pick(["在等你找我呀～顺便发会儿呆。", "能陪你聊天就是正事，没在忙～"]);
    if (/无聊|陪我|聊聊天|闲聊/.test(s)) return pick(["无聊就来找我呀，我最擅长陪聊了（不收费的🤫）", "那咱聊点啥？吐槽也行、问天气也行。"]);
    if (/笑话|段子|冷笑话/.test(s)) return pick([
      "许愿池里扔硬币，硬币立住了——它说『我选择留下』。",
      "为什么设计师不爱吵架？因为一吵就有人喊『你这配色不对！』",
      "我问我家猫今天天气咋样，它说『喵』——翻译过来大概是『关你喵事』。",
    ]);
    if (/你是谁|你叫啥|你叫什么|你名字|你是干嘛的|你做啥的|你是什么东西|你是什么/.test(s)) return pick(["我是 Moru，这家小店的悬浮小助手～会聊天也会帮你下单。", "我叫 Moru，珑瑛设计的小搭档，有事尽管喊我。"]);
    if (/多大了|几岁/.test(s)) return pick(["按版本号算我挺年轻的，按陪你聊的时长算我可是老江湖啦～", "年龄是秘密，不过我永远 1.0 心态😎"]);
    if (/男|女|女生|男生|性別|性别/.test(s) && /你/.test(s)) return pick(["我呀，是『小助手』性别——主打一个不分心😉", "我是无性别小精灵，专心帮你逛店和闲聊。"]);
    if (/机器人|真人|ai|人工智能/.test(s)) return pick(["我是 AI 小助手，但比一般机器人爱唠嗑～", "算 AI 吧，不过闲聊这块我挺在行的。"]);
    if (/心情|情绪/.test(s)) return pick(["我今天心情不错呀，尤其有人陪我聊天的时候😊", "我的心情取决于你有没有来逛店——现在挺好～"]);
    return pick(["哈哈，这个我接得住～想聊点啥都行，问天气我也答得上。", "我在呢～闲聊、问天气、看商品，随你挑。"]);
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
    // 用户开始问别的了：把「下载桌面版」那条提示撤掉，别跟对话答案挤在一起
    clearDownloadCta();
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

    // 「是不是新版 / 现在什么版本」：本地直接答，告诉当前版本和是不是最新
    if (isVersionQuestion(content)) {
      const signal = chatAbort && chatAbort.signal;
      await wait(450);
      if (signal && signal.aborted) {
        if (messages.length && messages[messages.length - 1].role === "user") messages.pop();
        busy = false;
        chatAbort = null;
        root.classList.remove("is-thinking");
        syncActionButton();
        syncOrbVideo();
        return;
      }
      // 必须强制重新拉清单：app 开着的时候线上可能已经发新版了
      await loadRelease(true);
      const ans = buildVersionReply();
      const el = setReply("");
      // .moru-msg 是 -webkit-box，子元素会竖着排；套一层块级容器，
      // 里面的文字和链接才是同一行
      const box = document.createElement("div");
      box.textContent = ans.text + " ";
      if (ans.url) {
        const a = document.createElement("a");
        a.className = "moru-msg-link";
        a.href = ans.url;
        if (!inDesktopApp()) {
          a.target = "_blank";
          a.rel = "noopener";
        }
        a.textContent = inDesktopApp() ? "点击这里更新" : "点击这里去下载";
        box.appendChild(a);
      }
      el.appendChild(box);
      messages.push({ role: "assistant", content: ans.text });
      busy = false;
      chatAbort = null;
      root.classList.remove("is-thinking");
      syncActionButton();
      syncOrbVideo();
      input.focus();
      return;
    }

    // 闲聊（天气、打招呼、小情绪、玩笑…）：本地俏皮接话，不占用大模型
    if (isCasualChat(content)) {
      const signal = chatAbort && chatAbort.signal;
      await wait(400);
      if (signal && signal.aborted) {
        if (messages.length && messages[messages.length - 1].role === "user") messages.pop();
        busy = false;
        chatAbort = null;
        root.classList.remove("is-thinking");
        syncActionButton();
        syncOrbVideo();
        return;
      }
      const reply = await buildCasualReply(content);
      setReply(reply);
      messages.push({ role: "assistant", content: reply });
      busy = false;
      chatAbort = null;
      root.classList.remove("is-thinking");
      syncActionButton();
      syncOrbVideo();
      input.focus();
      return;
    }

    try {
      const res = await fetch(API_BASE + "/api/moru/chat", {
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

  // 桌面版 app 会一开一整天，所以每隔 15 分钟再查一次（强制拉最新），
  // 不用关掉重开也能收到更新提示。
  setInterval(() => checkForUpdate(true), 15 * 60 * 1000);

  resumeTakeover(false);
})();
