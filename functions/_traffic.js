/** Shared traffic helpers for Cloudflare Pages Functions (KV). */

export const ONLINE_SEC = 5 * 60;
export const KEEP_DAYS = 90;
export const SID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const PAGES = {
  "index.html": "首页画册",
  "product.html": "商品详情",
  "cart.html": "购物袋",
  "checkout.html": "结算页",
  "order.html": "订单",
  "terms.html": "购物须知",
};
const WEEKDAY_CN = ["一", "二", "三", "四", "五", "六", "日"];
const SH_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function corsHeaders(extra = {}) {
  // 不要在这里写 Access-Control-Allow-Origin: * ——
  // 那会让任何网站都能用 JS 跨域读走流量数据。
  // 跨域放行统一由 functions/api/_middleware.js 按白名单处理
  // （自己的域名 + 本机回环地址），没命中就一个头都不给。
  return {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    ...extra,
  };
}

// 统一用 _lib.js 的 json，避免每个文件各抄一份
export { json } from "./_lib.js";

export function emptyDay() {
  return {
    uv: 0,
    pv: 0,
    seen: {},
    active: {},
    pages: {},
    devices: { mobile: 0, desktop: 0, tablet: 0 },
  };
}

/** YYYY-MM-DD in Asia/Shanghai */
export function dayKey(offset = 0, now = new Date()) {
  const today = SH_FMT.format(now);
  const [y, m, d] = today.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d - offset);
  return new Date(utc).toISOString().slice(0, 10);
}

function weekdayLabel(iso, isToday) {
  if (isToday) return "今";
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKDAY_CN[(dow + 6) % 7];
}

function dayUv(row) {
  if (!row || typeof row !== "object") return 0;
  if (row.seen && typeof row.seen === "object") return Object.keys(row.seen).length;
  return Number(row.uv) || 0;
}

const COUNTRY_ZH = {
  CN: "中国", HK: "中国香港", MO: "中国澳门", TW: "中国台湾",
  JP: "日本", KR: "韩国", SG: "新加坡", US: "美国", GB: "英国",
  DE: "德国", FR: "法国", AU: "澳大利亚", CA: "加拿大", NL: "荷兰",
};

export function placeFromRequest(request) {
  const cf = (request && request.cf) || {};
  const country = String(cf.country || "").toUpperCase();
  const city = String(cf.city || "").trim();
  const region = String(cf.region || "").trim();
  const countryName = COUNTRY_ZH[country] || country || "";
  const label = city || region || countryName || "未知";
  const detail = [region, countryName].filter((part) => part && part !== label).join(" · ");
  return { label: label.slice(0, 40), detail: detail.slice(0, 40) };
}

export async function recordHit(env, { sid, path, device, ping, place }) {
  if (!env || !env.TRAFFIC) throw new Error("TRAFFIC KV not bound");
  const key = `d:${dayKey(0)}`;
  const now = Date.now() / 1000;
  const row = (await env.TRAFFIC.get(key, "json")) || emptyDay();
  if (!row.seen) row.seen = {};
  if (!row.active) row.active = {};
  if (!row.pages) row.pages = {};
  if (!row.devices) row.devices = { mobile: 0, desktop: 0, tablet: 0 };

  if (!row.seen[sid]) {
    row.seen[sid] = 1;
    row.uv = (Number(row.uv) || 0) + 1;
  }
  row.active[sid] = now;

  if (!ping) {
    row.pv = (Number(row.pv) || 0) + 1;
    row.pages[path] = (Number(row.pages[path]) || 0) + 1;
    if (!(device in row.devices)) device = "desktop";
    row.devices[device] = (Number(row.devices[device]) || 0) + 1;
    const label = place && place.label ? String(place.label) : "";
    if (label && label !== "未知") {
      if (!row.placed) row.placed = {};
      if (!row.placed[sid]) {
        row.placed[sid] = 1;
        if (!row.places) row.places = {};
        const key = label;
        const bucket = row.places[key] && typeof row.places[key] === "object"
          ? row.places[key]
          : { count: Number(row.places[key]) || 0, detail: "" };
        bucket.count += 1;
        if (place.detail) bucket.detail = place.detail;
        row.places[key] = bucket;
      }
    }
  }

  const cutoff = now - ONLINE_SEC * 2;
  for (const [id, ts] of Object.entries(row.active)) {
    if (Number(ts) < cutoff) delete row.active[id];
  }

  await env.TRAFFIC.put(key, JSON.stringify(row), {
    expirationTtl: KEEP_DAYS * 24 * 60 * 60,
  });
}

export async function summarize(env, rangeKey = "7") {
  if (!env || !env.TRAFFIC) throw new Error("TRAFFIC KV not bound");

  let span = 7;
  if (rangeKey === "30") span = 30;
  else if (rangeKey === "all") span = KEEP_DAYS;

  const today = dayKey(0);
  const yesterday = dayKey(1);
  const unique = [];
  const KEYS_CAP = 50; // 免费档单请求子请求上限 50；all 时段最多读 50 天，避免 500
  for (let offset = 0; offset < Math.max(span, 14); offset++) {
    unique.push(`d:${dayKey(offset)}`);
  }
  const keys = [...new Set(unique)].slice(-KEYS_CAP);
  const got = await Promise.all(keys.map((k) => env.TRAFFIC.get(k, "json")));
  const byKey = Object.fromEntries(keys.map((k, i) => [k, got[i] || null]));

  const todayRow = byKey[`d:${today}`] || {};
  const yesterdayRow = byKey[`d:${yesterday}`] || {};
  const todayUv = dayUv(todayRow);
  const yesterdayUv = dayUv(yesterdayRow);

  let weekUv = 0;
  let prevWeekUv = 0;
  for (let offset = 0; offset < 14; offset++) {
    const uv = dayUv(byKey[`d:${dayKey(offset)}`]);
    if (offset < 7) weekUv += uv;
    else prevWeekUv += uv;
  }

  const pageTotals = {};
  const deviceTotals = { mobile: 0, desktop: 0, tablet: 0 };
  for (let offset = 0; offset < span; offset++) {
    const row = byKey[`d:${dayKey(offset)}`] || {};
    for (const [path, count] of Object.entries(row.pages || {})) {
      pageTotals[path] = (pageTotals[path] || 0) + (Number(count) || 0);
    }
    for (const [device, count] of Object.entries(row.devices || {})) {
      if (device in deviceTotals) deviceTotals[device] += Number(count) || 0;
    }
  }

  const last7 = [];
  for (let offset = 6; offset >= 0; offset--) {
    const iso = dayKey(offset);
    last7.push({
      label: weekdayLabel(iso, offset === 0),
      value: dayUv(byKey[`d:${iso}`]),
      today: offset === 0,
      date: iso,
    });
  }

  const cutoff = Date.now() / 1000 - ONLINE_SEC;
  let online = 0;
  for (const ts of Object.values(todayRow.active || {})) {
    if (Number(ts) >= cutoff) online += 1;
  }

  const deviceSum = deviceTotals.mobile + deviceTotals.desktop + deviceTotals.tablet;
  const devices = [
    { label: "手机", pct: deviceSum ? Math.round((deviceTotals.mobile * 100) / deviceSum) : 0 },
    { label: "电脑", pct: deviceSum ? Math.round((deviceTotals.desktop * 100) / deviceSum) : 0 },
    { label: "平板", pct: deviceSum ? Math.round((deviceTotals.tablet * 100) / deviceSum) : 0 },
  ];
  if (deviceSum) {
    const drift = 100 - devices.reduce((s, d) => s + d.pct, 0);
    devices[0].pct = Math.max(0, devices[0].pct + drift);
  }

  const placeTotals = {};
  for (let offset = 0; offset < span; offset++) {
    const row = byKey[`d:${dayKey(offset)}`] || {};
    for (const [label, value] of Object.entries(row.places || {})) {
      const count = value && typeof value === "object" ? Number(value.count) || 0 : Number(value) || 0;
      const detail = value && typeof value === "object" ? String(value.detail || "") : "";
      if (!placeTotals[label]) placeTotals[label] = { count: 0, detail };
      placeTotals[label].count += count;
      if (detail) placeTotals[label].detail = detail;
    }
  }
  const placeSum = Object.values(placeTotals).reduce((s, row) => s + row.count, 0) || 1;
  const regions = Object.entries(placeTotals)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([label, row]) => ({
      label,
      detail: row.detail,
      count: row.count,
      pct: Math.round((row.count * 100) / placeSum),
    }));

  const pages = Object.entries(pageTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([path, views]) => ({
      label: PAGES[path] || path.replace(/\.html$/, ""),
      views,
    }));

  function deltaPct(current, previous) {
    if (previous <= 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) * 100) / previous);
  }

  return {
    today: todayUv,
    yesterday: yesterdayUv,
    week: weekUv,
    online,
    todayDelta: deltaPct(todayUv, yesterdayUv),
    weekDelta: deltaPct(weekUv, prevWeekUv),
    days: last7,
    devices,
    pages,
    regions,
    range: rangeKey,
    live: true,
    source: "cloudflare",
  };
}

export function normalizeHitBody(body) {
  if (!body || typeof body !== "object") return null;
  const sid = String(body.sid || "").trim();
  if (!SID_RE.test(sid)) return null;
  let page = String(body.path || "")
    .trim()
    .replace(/^\/+/, "")
    .split("?")[0]
    .split("/")
    .pop();
  if (!page || page === "/") page = "index.html";
  if (!(page in PAGES)) page = "index.html";
  let device = String(body.device || "desktop").trim().toLowerCase();
  if (!["mobile", "desktop", "tablet"].includes(device)) device = "desktop";
  return { sid, path: page, device, ping: !!body.ping };
}
