/** Public product catalog for the storefront. */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const asset = await context.env.ASSETS.fetch(new URL("/data/products.json", url.origin));
  if (!asset.ok) {
    return json({ error: "products unavailable" }, 500);
  }
  const body = await asset.text();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
