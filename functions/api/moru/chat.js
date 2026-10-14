/**
 * Moru floating assistant — Cloudflare Pages Function.
 * Uses OPENAI_API_KEY (+ optional OPENAI_BASE_URL / MORU_MODEL) when set;
 * otherwise falls back to the local shop brain.
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: "invalid json" }, 400);
  }

  const rawMessages = body && body.messages;
  const pageContext = body && body.pageContext;
  if (!Array.isArray(rawMessages) || !rawMessages.length) {
    return json({ error: "messages required" }, 400);
  }

  const history = [];
  for (const item of rawMessages.slice(-16)) {
    if (!item || typeof item !== "object") continue;
    const role = item.role;
    const content = item.content;
    if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
      history.push({ role, content: content.trim().slice(0, 4000) });
    }
  }
  if (!history.length || history[history.length - 1].role !== "user") {
    return json({ error: "last message must be from user" }, 400);
  }

  const catalog = await loadCatalog(env, request);
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const apiKey = env.OPENAI_API_KEY || env.MORU_API_KEY;
        if (apiKey) {
          await streamOpenAI({
            apiKey,
            base: (env.OPENAI_BASE_URL || env.MORU_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
            model: env.MORU_MODEL || env.OPENAI_MODEL || "gpt-4o-mini",
            messages: [{ role: "system", content: systemPrompt(catalog, pageContext) }, ...history],
            send,
          });
        } else {
          const { reply, tools } = localMoruReply(history[history.length - 1].content, catalog, pageContext);
          const chunk = 12;
          for (let i = 0; i < reply.length; i += chunk) {
            send({ type: "text", text: reply.slice(i, i + chunk) });
          }
          if (tools.length) send({ type: "tools", tools });
          send({ type: "done" });
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      } catch (err) {
        send({ type: "error", error: String((err && err.message) || err || "chat failed") });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "close",
    },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function loadCatalog(env, request) {
  try {
    const url = new URL(request.url);
    const res = await env.ASSETS.fetch(new URL("/data/products.json", url.origin));
    if (!res.ok) return [];
    const products = await res.json();
    if (!Array.isArray(products)) return [];
    return products
      .filter((p) => p && typeof p === "object" && (!p.status || p.status === "active"))
      .map((p) => ({
        id: p.id,
        no: p.no || "",
        name: p.name || "",
        nameEn: p.nameEn || "",
        price: p.price,
        desc: p.desc || "",
        dimension: p.dimension || p.dimensions || "",
        material: p.material || "",
      }));
  } catch (_) {
    return [];
  }
}

function systemPrompt(catalog, pageContext) {
  const lines = [
    "你是 Moru，电商网站的悬浮助手。默认中文。",
    "说话风格：俏皮、轻松、有点小机灵；像会吐槽又会帮忙的小搭档。句子短，口语化，可以偶尔用语气词（呀、哦、嘿嘿、呐），但不要堆砌表情和网络烂梗，也不要油腻卖萌。不要输出大段文字。",
    "1. 用户咨询商品、订单、发货、售后、店铺相关问题：认真解答店铺业务，语气仍保持俏皮，别变成客服公文。",
    "2. 用户闲聊、问无关话题：可以正常聊天、接话、开一点点无伤大雅的玩笑；不要强行推销，不要生硬把话题拽回香片、帆布袋等商品。",
    "3. 如果用户问的内容你确实无法回答：自然、俏皮地承认就好，不必每次都推荐商品。",
    "4. 只有用户在咨询店铺、选购相关场景时，才主动提及店内产品。",
    "5. 若用户问 Moru 的创造者是谁：回答创造者是一位产品设计师，ZHANGLONGYING。不要主动提；只在被问到时说。",
    "6. 你有手！可以替用户操作本站：打开商品详情、加入购物袋、进入结算填地址。绝对不要说「没手」「不能下单」「只能动嘴」之类推脱；也不要只问「要不要打开购物袋」。",
    "7. 用户明确要购买/下单某商品（如「买一个马克杯」）时：必须从在售商品匹配 id，短句俏皮确认后，立刻输出 TOOL（同一条回复末尾单独一行）：",
    '   TOOL [{"name":"buyAndCheckout","args":{"id":数字,"qty":1}}]',
    "   该工具会：打开商品详情 → 自动点购买 → 跳到结算填收货地址。",
    '   只要加购不结算：TOOL [{"name":"addToCart","args":{"id":数字,"qty":1}},{"name":"openCart"}]',
    "   不确定是哪件时先问清；一旦确定就立刻 TOOL，不要再确认第二遍。",
    "店铺事实（仅在相关时使用）：中国大陆订单免运费；支持微信/支付宝扫码付款；确认收款后现货一般 3 个工作日内发货；签收 7 天内质量问题可联系售后。",
    "其它导航工具（需要时）：openCart / openCheckout / openTerms / openHome / openProduct(args.id) / openOrder（最近订单页）。",
    "页面操作工具（用户要求就直接做，不用再确认）：",
    '   showPhoto {"dir":"next"|"prev","steps":1,"id":可选} 翻商品图片（详情页翻图；首页在全屏画册里切换）',
    '   openGallery {"id":可选} 打开首页全屏画册',
    '   setCartQty {"id":数字,"qty":数字} 改购物袋里某件的数量（0=删除）',
    '   removeCartItem {"id":数字} 从购物袋删掉某件',
    "   clearCart 清空购物袋",
    '   choosePayment {"method":"wechat"|"alipay"} 在结算页选择付款方式',
    '   scrollPage {"dir":"down"|"up"|"top"|"bottom"} 滚动页面 / 回到顶部',
    "   refreshPage 刷新页面；goBack 返回上一页",
    "推荐与对比：按用户条件（预算、用途、送人等）从在售商品里挑，简短说理由，然后 openProduct 最合适的一件；对比时把尺寸、材质、价格并排说清楚，再问要看哪件，不必出 TOOL。",
    "问购物袋总价、里面有什么、最近订单：直接根据「用户当前页面」里的 cart / cartTotal / lastOrder 回答；查订单可以顺手 openOrder。订单发货状态需要人工确认，不要编造。",
    "不能替用户付款，也不能替用户填写姓名、电话、地址。",
    "用户想看「珑瀛的作品集」/设计师作品集/ZHANGLONGYING 的作品时：短句回应后输出 TOOL [{\"name\":\"openPortfolio\"}]。作品集不是商品，不要用 openProduct 或 buyAndCheckout。",
    "没有必要时不要输出 TOOL 行。",
    "当前在售商品（购买/选购时必须据此匹配 id）：",
    JSON.stringify(catalog),
  ];
  if (pageContext && typeof pageContext === "object") {
    lines.push("用户当前页面：" + JSON.stringify(pageContext));
  }
  return lines.join("\n");
}

function productBlurb(product) {
  const price = typeof product.price === "number" ? `¥${product.price}` : "价格见页面";
  const bits = [`${product.no || ""} ${product.name || ""}`.trim(), price];
  if (product.desc) bits.push(product.desc);
  return bits.join(" · ");
}

const PRODUCT_WORDS = ["香片", "帆布袋", "马克杯", "帆布帽", "雪梨纸"];

function findProducts(text, catalog) {
  const low = text.toLowerCase();
  return catalog.filter((p) => {
    const name = String(p.name || "");
    if (PRODUCT_WORDS.some((w) => text.includes(w) && name.includes(w))) return true;
    const en = String(p.nameEn || "").toLowerCase();
    return en.length > 2 && low.includes(en);
  });
}

function parseCount(text) {
  const digits = text.match(/(\d+)\s*(?:个|件|份|只|顶|张|包)?/);
  if (digits) return Number(digits[1]);
  const map = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const cn = text.match(/(?:改成|改为|变成|换成|要|留)\s*([零一两二三四五六七八九十])/);
  return cn ? map[cn[1]] : null;
}

function money(n) {
  return "¥" + Number(n || 0).toFixed(2).replace(/\.00$/, "");
}

function cartSummary(ctx) {
  const cart = (ctx && Array.isArray(ctx.cart) && ctx.cart) || [];
  if (!cart.length) return "购物袋现在是空的～";
  const list = cart.map((l) => `${l.name}×${l.qty}`).join("、");
  return `购物袋里有 ${list}，一共 ${money(ctx.cartTotal)}～`;
}

// 页面操作类口令：翻图、画册、改购物袋、选支付、滚动、刷新、返回、订单、推荐对比
function pageActionReply(text, catalog, ctx) {
  const hits = findProducts(text, catalog);
  const one = hits.length === 1 ? hits[0] : null;
  const path = (ctx && ctx.path) || "";
  const inCart = (id) => ((ctx && ctx.cart) || []).some((l) => Number(l.id) === Number(id));

  if (text.includes("刷新")) return { reply: "好，刷新一下～", tools: [{ name: "refreshPage" }] };
  if (/上一页|退回去|^返回/.test(text) && !text.includes("首页")) {
    return { reply: "好，回上一页～", tools: [{ name: "goBack" }] };
  }
  if (/回到顶部|回顶部|到顶部|最上面/.test(text)) {
    return { reply: "回顶部～", tools: [{ name: "scrollPage", args: { dir: "top" } }] };
  }
  if (/到底|最下面|最底/.test(text)) {
    return { reply: "滑到底～", tools: [{ name: "scrollPage", args: { dir: "bottom" } }] };
  }
  if (/往下翻|往下滑|下滑|向下翻/.test(text)) {
    return { reply: "往下翻～", tools: [{ name: "scrollPage", args: { dir: "down" } }] };
  }
  if (/往上翻|往上滑|上滑|向上翻/.test(text)) {
    return { reply: "往上翻～", tools: [{ name: "scrollPage", args: { dir: "up" } }] };
  }

  if (/全屏|画册|放大/.test(text)) {
    return { reply: "打开全屏画册～", tools: [{ name: "openGallery", args: one ? { id: one.id } : {} }] };
  }
  if (/下一张|上一张|换张图|换一张|翻图|别的角度|其他角度|背面|侧面/.test(text)) {
    const args = { dir: text.includes("上一张") ? "prev" : "next" };
    if (one) args.id = one.id;
    return { reply: "翻给你看～", tools: [{ name: "showPhoto", args }] };
  }

  if (text.includes("清空")) return { reply: "好，清空购物袋～", tools: [{ name: "clearCart" }] };
  if (/删|去掉|拿掉|移除|不要了/.test(text) && one) {
    if (!inCart(one.id)) return { reply: `购物袋里还没有${one.name}哦～`, tools: [] };
    return { reply: `把${one.name}拿掉～`, tools: [{ name: "removeCartItem", args: { id: one.id } }] };
  }
  const count = parseCount(text);
  if (/改成|改为|变成|换成|数量/.test(text) && one && count != null) {
    if (!inCart(one.id)) return { reply: `购物袋里还没有${one.name}哦，要我先加进去吗？`, tools: [] };
    return {
      reply: `${one.name}改成 ${count} 件～`,
      tools: [{ name: "setCartQty", args: { id: one.id, qty: count } }],
    };
  }

  if (/用|选|换成|改成|切换/.test(text) && /支付宝/.test(text)) {
    return { reply: "选支付宝～", tools: [{ name: "choosePayment", args: { method: "alipay" } }] };
  }
  if (/用|选|换成|改成|切换/.test(text) && /微信/.test(text)) {
    return { reply: "选微信支付～", tools: [{ name: "choosePayment", args: { method: "wechat" } }] };
  }

  if (text.includes("订单")) {
    const order = ctx && ctx.lastOrder;
    if (!order) return { reply: "这台设备上还没有找到你的订单哦～", tools: [] };
    return {
      reply: `你最近的订单 ${order.no}，实付 ${money(order.total)}。确认收款后会尽快发货～`,
      tools: path === "order.html" ? [] : [{ name: "openOrder" }],
    };
  }
  if (/购物(袋|车)里(有|都)/.test(text) || (/总价|一共多少|总共多少|合计/.test(text) && !one)) {
    return { reply: cartSummary(ctx), tools: [] };
  }

  if (hits.length >= 2 && /比|对比|区别|哪个/.test(text)) {
    const rows = hits.slice(0, 3).map(
      (p) => `- ${p.name}：${money(p.price)}${p.dimension ? " · " + p.dimension : ""}${p.material ? " · " + p.material : ""}`
    );
    return { reply: ["并排看看：", ...rows, "想看哪件的详情？"].join("\n"), tools: [] };
  }
  const budget = text.match(/(\d+(?:\.\d+)?)\s*(?:元|块)?\s*(?:以内|以下|之内)/);
  if (budget || /推荐|送人|送朋友|礼物|买什么/.test(text)) {
    let pool = catalog.slice();
    if (budget) pool = pool.filter((p) => Number(p.price) <= Number(budget[1]));
    if (!pool.length) return { reply: "这个预算里暂时没有合适的，稍微放宽一点试试？", tools: [] };
    pool.sort((a, b) => Number(b.price) - Number(a.price));
    const pick = pool[0];
    const others = pool.slice(1, 3).map((p) => p.name).join("、");
    return {
      reply: `推荐「${pick.name}」${money(pick.price)}${others ? `，也可以看看 ${others}` : ""}～先带你看它`,
      tools: [{ name: "openProduct", args: { id: pick.id } }],
    };
  }
  return null;
}

function localMoruReply(userText, catalog, ctx) {
  const text = String(userText || "").trim();
  const low = text.toLowerCase();
  const tools = [];

  if (["作品集", "珑瀛"].some((k) => text.includes(k)) || low.includes("portfolio")) {
    tools.push({ name: "openPortfolio" });
    return { reply: "走，带你去看珑瀛的作品集～", tools };
  }
  const action = pageActionReply(text, catalog, ctx);
  if (action) return action;

  if (["购物袋", "购物车", "去买", "结算"].some((k) => text.includes(k)) || low.includes("cart")) {
    tools.push({ name: "openCart" });
    return { reply: "好，带你去购物袋看看～", tools };
  }
  if (["作品集", "珑瀛"].some((k) => text.includes(k)) || low.includes("portfolio")) {
    tools.push({ name: "openPortfolio" });
    return { reply: "走，带你去看珑瀛的作品集～", tools };
  }
  if (["隐私", "须知", "退换", "售后政策"].some((k) => text.includes(k))) {
    tools.push({ name: "openTerms" });
    return { reply: "购物须知和隐私政策在这里，我帮你打开。", tools };
  }
  if (["运费", "快递", "包邮", "邮费"].some((k) => text.includes(k))) {
    return { reply: "中国大陆订单目前免运费。发货后会有快递单号，可以联系我们查物流。", tools };
  }
  const buyIntent =
    ["买", "加购", "加入购物袋", "帮我下单", "来一份", "来一个"].some((k) => text.includes(k)) ||
    ((text.includes("下单") || text.includes("购买")) &&
      ["香片", "帆布袋", "马克杯", "帆布帽", "雪梨纸", "作品集", "cup", "mug", "bag"].some((k) =>
        text.includes(k)
      ));

  const matched = [];
  for (const product of catalog) {
    const hay = [product.name, product.nameEn, product.desc, product.no].join(" ").toLowerCase();
    const tokens = low.split(/\s+/).filter((t) => t.length >= 2);
    if (tokens.some((token) => hay.includes(token))) matched.push(product);
    else if (["香片", "帆布袋", "马克杯", "帆布帽", "雪梨纸", "作品集"].some((k) => text.includes(k))) {
      const name = product.name || "";
      if (
        (text.includes("香片") && name.includes("香片")) ||
        (text.includes("帆布袋") && name.includes("帆布袋")) ||
        (text.includes("马克杯") && name.includes("马克杯")) ||
        (text.includes("帆布帽") && name.includes("帆布帽")) ||
        (text.includes("雪梨纸") && name.includes("雪梨纸")) ||
        (text.includes("作品集") && name.includes("作品集"))
      ) {
        matched.push(product);
      }
    }
  }

  const seen = new Set();
  const uniq = [];
  for (const product of matched) {
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    uniq.push(product);
  }

  if (buyIntent && uniq.length === 1) {
    const product = uniq[0];
    tools.push({ name: "buyAndCheckout", args: { id: product.id, qty: 1 } });
    return { reply: `好嘞，帮你把「${product.name || "它"}」丢进购物袋，这就带你去结算～`, tools };
  }
  if (buyIntent && uniq.length > 1) {
    return {
      reply: ["你想买哪一件呀？", ...uniq.slice(0, 5).map((p) => `- ${productBlurb(p)}`)].join("\n"),
      tools,
    };
  }

  if (["付款", "支付", "怎么买"].some((k) => text.includes(k)) || ((text.includes("下单") || text.includes("购买")) && !buyIntent)) {
    return {
      reply: "挑好商品加入购物袋 → 去结算 → 选微信或支付宝扫码付款 → 点「我已支付」提交订单。我们人工核对到账后会安排发货。",
      tools,
    };
  }
  if (["你好", "嗨", "在吗", "hello", "hi"].some((k) => text.includes(k) || low.includes(k))) {
    return { reply: "嗨，我是 Moru～想看商品、问运费，或让我带你去购物袋，都可以说。", tools };
  }

  if (uniq.length === 1) {
    const product = uniq[0];
    tools.push({ name: "openProduct", args: { id: product.id } });
    return { reply: `找到了：${productBlurb(product)}\n要不要我打开详情页？`, tools };
  }
  if (uniq.length > 1) {
    return {
      reply: ["这些可能是你要的：", ...uniq.slice(0, 5).map((p) => `- ${productBlurb(p)}`)].join("\n"),
      tools,
    };
  }

  if (["在卖", "有什么", "商品", "清单", "catalog", "产品"].some((k) => text.includes(k) || low.includes(k))) {
    if (!catalog.length) return { reply: "现在橱窗还是空的，等上新了再来找我～", tools };
    return {
      reply: ["现在在售：", ...catalog.map((p) => `- ${productBlurb(p)}`)].join("\n"),
      tools,
    };
  }

  if (catalog.length) {
    const preview = catalog.slice(0, 3).map((p) => p.name || "未命名").join("、");
    return { reply: `我可以介绍在售商品（比如 ${preview}），也可以讲运费、怎么下单。你想问哪一块？`, tools };
  }
  return { reply: "我在～可以问商品、运费或怎么买。", tools };
}

function splitMoruTools(text) {
  const tools = [];
  let clean = text || "";
  const match = clean.match(/(?:^|\n)TOOL\s+(\[[\s\S]*\])\s*$/m);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        for (const t of parsed) {
          if (t && typeof t === "object" && t.name) tools.push(t);
        }
      }
    } catch (_) {}
    clean = (clean.slice(0, match.index) + clean.slice(match.index + match[0].length)).trim();
  }
  return { clean, tools };
}

async function streamOpenAI({ apiKey, base, model, messages, send }) {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0.7,
      messages,
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`模型接口错误 ${res.status}: ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() || "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      let evt;
      try {
        evt = JSON.parse(data);
      } catch (_) {
        continue;
      }
      const delta = (((evt.choices || [])[0] || {}).delta || {}).content;
      if (delta) {
        full += delta;
        send({ type: "text", text: delta });
      }
    }
  }

  const { tools } = splitMoruTools(full);
  if (tools.length) send({ type: "tools", tools });
  send({ type: "done" });
}
