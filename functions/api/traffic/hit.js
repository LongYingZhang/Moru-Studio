/** Accept shop beacons on Cloudflare. Persistence lives on the 2015 Python host. */
export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true, stored: false }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
