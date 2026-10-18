import { corsHeaders, json, normalizeHitBody, placeFromRequest, recordHit } from "../../_traffic.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: "invalid json" }, 400);
  }
  const hit = normalizeHitBody(body);
  if (!hit) return json({ error: "invalid body" }, 400);
  hit.place = placeFromRequest(request);
  if (!env.TRAFFIC) return json({ ok: true, stored: false, reason: "no kv" });

  try {
    await recordHit(env, hit);
  } catch (err) {
    return json({ error: String((err && err.message) || err || "write failed") }, 500);
  }
  return json({ ok: true, stored: true });
}
