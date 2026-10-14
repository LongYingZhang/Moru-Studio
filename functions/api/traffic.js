import { corsHeaders, json, summarize } from "../_traffic.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.TRAFFIC) {
    return json({ error: "TRAFFIC KV not bound", live: false }, 503);
  }
  const url = new URL(request.url);
  let range = url.searchParams.get("range") || "7";
  if (!["7", "30", "all"].includes(range)) range = "7";
  try {
    const data = await summarize(env, range);
    return json(data);
  } catch (err) {
    return json({ error: String((err && err.message) || err || "read failed") }, 500);
  }
}
