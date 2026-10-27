/**
 * 线上订单接口 —— 对应 checkout.html 里 fetch("/api/orders")。
 *
 * 本地开发时这个接口由 server.py 提供（读写 admin/data/orders.json）；
 * 线上 Pages 没有文件系统，所以订单落到 KV（binding: MORU_ORDERS）。
 *
 * POST /api/orders            建单（公开，前端结账调用）
 * GET  /api/orders?token=xxx  查看订单（必须带后台口令，否则一律拒绝）
 *      &format=json           返回 JSON 而不是网页
 *      &limit=50              只取最近 N 单（默认 100，上限 500）
 *
 * 安全要点：
 * - 价格一律用服务端 data/products.json 重算，绝不信前端传来的金额。
 * - 订单里有姓名/电话/地址，GET 不配 ADMIN_TOKEN 就直接 503，绝不裸奔。
 */

import { json } from "../_lib.js";
import { sameSecret } from "../_catalog-auth.js";

const ORDER_NO = /^LY\d{10,16}$/;
const PHONE = /^[+\d][\d\s-]{6,}$/;
const METHODS = new Set(["wechat", "alipay", "card"]);
const MAX_ITEMS = 50;
const KEY_PREFIX = "order:";

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式不对" }, 400);
  }
  if (!body || typeof body !== "object") {
    return json({ error: "请求格式不对" }, 400);
  }

  const no = text(body.no, 20);
  const name = text(body.name, 40);
  const phone = text(body.phone, 30);
  const address = text(body.address, 200);
  const method = METHODS.has(body.method) ? body.method : "wechat";
  const items = body.items;

  if (!ORDER_NO.test(no)) return json({ error: "订单号无效" }, 400);
  if (!name || !PHONE.test(phone) || !address) {
    return json({ error: "收件信息不完整" }, 400);
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    return json({ error: "购物袋是空的" }, 400);
  }

  if (!env.MORU_ORDERS) {
    return json({ error: "订单服务未配置，请联系店主" }, 500);
  }

  // 单号重复（同一秒并发点两次）—— 直接告诉前端重试，避免两单串号
  if (await env.MORU_ORDERS.get(KEY_PREFIX + no)) {
    return json({ error: "订单号重复，请重试" }, 409);
  }

  // 用服务端商品表核价，忽略前端任何金额字段
  const catalog = await loadCatalog(context);
  const byId = new Map();
  for (const p of catalog) {
    if (p && typeof p === "object" && (p.status || "active") === "active") {
      byId.set(String(p.id), p);
    }
  }

  const lines = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const product = byId.get(String(item.id));
    const qty = Number.parseInt(item.qty, 10);
    if (!product || !Number.isFinite(qty) || qty <= 0 || qty > 99) {
      return json({ error: "有商品已下架，请返回购物袋检查" }, 400);
    }
    const image = String(product.image || "");
    lines.push({
      id: product.id,
      name: String(product.name || ""),
      price: Number(product.price) || 0,
      qty,
      image: image.startsWith("data:") ? "" : image,
      // 快照建单那一刻的库存状态：以后商品补货了，这单仍然是预付款单
      stock: product.stock === "pre-order" ? "pre-order" : "in-stock",
    });
  }
  if (lines.length === 0) return json({ error: "购物袋是空的" }, 400);

  const total = Math.round(lines.reduce((s, l) => s + l.price * l.qty, 0) * 100) / 100;

  const order = {
    no,
    createdAt: nowIso(),
    status: "pending",
    method,
    items: lines,
    total,
    name,
    phone,
    address,
    // 有缺货商品 = 预付款单，发货时要等货
    preorder: lines.some((line) => line.stock === "pre-order"),
  };

  // 先写单条；读取订单时直接按前缀列举，无需维护索引，也就没有竞态漏单
  await env.MORU_ORDERS.put(KEY_PREFIX + no, JSON.stringify(order));

  return json({ ok: true, no, total });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const given = url.searchParams.get("token") || request.headers.get("X-Admin-Token") || "";
  const expected = (env.ADMIN_TOKEN || "").trim();

  if (!expected) {
    return json(
      { error: "还没设置后台口令。请在 Cloudflare 给 Pages 项目配置环境变量 ADMIN_TOKEN。" },
      503
    );
  }
  if (!sameSecret(given, expected)) {
    return html(
      page("需要口令", "<p class='muted'>链接里缺少正确的 <code>token</code>，无法查看订单。</p>"),
      401
    );
  }
  if (!env.MORU_ORDERS) return json({ error: "订单服务未配置" }, 500);

  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit"), 10) || 40, 1), 100);
  const orders = await loadOrders(env, limit);

  if (url.searchParams.get("format") === "json") {
    return json({ count: orders.length, orders });
  }

  const token = encodeURIComponent(given);
  const rows = orders.map((o) => orderRow(o, token)).join("");
  const body = orders.length
    ? `<table>${rows}</table>`
    : "<p class='muted'>还没有订单。</p>";

  return html(page(`订单 ${orders.length} 笔`, body, token), 200, { "X-Robots-Tag": "noindex" });
}

/* ------------------------------ helpers ------------------------------ */

async function loadCatalog(context) {
  // 优先读 KV（后台保存的实时商品表），再回落部署快照：
  // 否则后台改价/上新后，线上核价仍用旧快照，会静默错账或新商品无法下单。
  try {
    if (context.env.MORU_PRODUCTS) {
      const stored = await context.env.MORU_PRODUCTS.get("catalog");
      if (stored) {
        const data = JSON.parse(stored);
        return Array.isArray(data) ? data : [];
      }
    }
  } catch {}
  try {
    const asset = await context.env.ASSETS.fetch(
      new URL("/data/products.json", new URL(context.request.url).origin)
    );
    if (!asset.ok) return [];
    const data = await asset.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function loadOrders(env, limit) {
  // 直接用 KV 前缀列举，避免 read-modify-write 的「index」键在并发下漏单/丢单。
  // list 单次返回一组键（本身只占 1 个子请求），再按单号取最近 limit 笔。
  const listed = await env.MORU_ORDERS.list({ prefix: KEY_PREFIX, limit: Math.min(limit, 100) });
  const keys = listed.keys
    .map((k) => k.name.slice(KEY_PREFIX.length))
    .slice(-limit);
  const values = await Promise.all(
    keys.map((no) => env.MORU_ORDERS.get(KEY_PREFIX + no, "json").catch(() => null))
  );
  return values.filter(Boolean).reverse(); // 新单在前
}

function orderRow(o, token) {
  const items = (o.items || [])
    .map((l) => {
      const tag = l.stock === "pre-order" ? "<b class='wait'>预付</b>" : "";
      return `${esc(l.name)} ×${esc(l.qty)}${tag}`;
    })
    .join("、");
  const status = { pending: "待收款", paid: "已收款", shipped: "已发货" }[o.status] || o.status;
  const method = { wechat: "微信", alipay: "支付宝", card: "银行卡" }[o.method] || o.method;
  const when = String(o.createdAt || "").replace("T", " ").slice(0, 16);
  const flag = o.preorder ? "<br><span class='tag-wait'>含缺货 · 预付款</span>" : "";
  return `<tr>
    <td class="no">${esc(o.no)}${flag}</td>
    <td>${esc(when)}</td>
    <td>${esc(status)}</td>
    <td>${esc(method)}</td>
    <td class="money">¥${esc(o.total)}</td>
    <td>${items}</td>
    <td>${esc(o.name)}<br><span class="muted">${esc(o.phone)}</span><br><span class="muted">${esc(o.address)}</span></td>
  </tr>`;
}

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · Moru Studio</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; padding:28px 20px 60px; background:#f7f7f5; color:#141414;
         font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif; }
  h1 { margin:0 0 22px; font-size:18px; font-weight:600; letter-spacing:.02em; }
  table { width:100%; border-collapse:collapse; background:#fff; border-radius:14px; overflow:hidden; }
  th,td { padding:12px 14px; text-align:left; vertical-align:top; }
  thead { display:none; }
  tr { border-bottom:1px solid #eee; }
  tr:last-child { border-bottom:0; }
  .no { font-variant-numeric:tabular-nums; font-weight:600; white-space:nowrap; }
  .money { font-variant-numeric:tabular-nums; white-space:nowrap; }
  .muted { color:#8a8a86; }
  .wait { display:inline-block; margin-left:4px; padding:0 4px; border-radius:3px;
          background:#f3e3c9; color:#8a5a12; font-size:11px; font-weight:500; }
  .tag-wait { display:inline-block; margin-top:5px; padding:1px 6px; border-radius:4px;
              background:#f3e3c9; color:#8a5a12; font-size:11px; font-weight:500; }
  code { background:#eee; padding:1px 5px; border-radius:4px; }
  @media (max-width:640px) {
    body { padding:18px 12px 40px; }
    tr { display:block; padding:14px 4px; }
    td { display:block; padding:2px 8px; }
    table { background:transparent; }
  }
</style>
</head><body>
<h1>Moru Studio · ${esc(title)}</h1>
${body}
</body></html>`;
}

function html(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function text(v, max) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function nowIso() {
  // 统一用北京时间，和本地后台的历史订单格式对齐
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().replace("Z", "+08:00");
}

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
