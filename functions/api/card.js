/* Cloudflare Pages Function — LUKO Genesis Donation Note (scaffold).
 *
 * Route: /api/card  (this file lives at functions/api/card.js, at the REPO ROOT)
 * Status: STEP 1 — hello-world plumbing only. No payment, no chain, no KV yet.
 *
 * Layout note: Cloudflare Pages builds this project with the static site in
 * website/ (build output directory) and looks for Pages Functions in the
 * `functions/` directory at the project ROOT — NOT inside website/. Keep this
 * file at repo-root functions/, or the /api/card route silently 404s to HTML.
 *
 * What this endpoint WILL do once built out:
 *   TODO: read a donation tx hash from the request (query param or POST body).
 *   TODO: verify the tx on-chain via Base RPC (https://mainnet.base.org) —
 *         confirm it landed, went to the LUKO treasury, and is a real transfer.
 *   TODO: increment a monotonic serial counter in Cloudflare KV, so each
 *         verified donation gets a unique note number ("LK 0000002", ...).
 *   TODO: generate an SVG donation note (serial + amount + date, in the
 *         LUKO design system) and return it, or a URL to it.
 *
 * For now it returns a fixed hello-world payload so the site's button,
 * fetch call, and dialog can be wired end to end.
 *
 * Local testing (run from the REPO ROOT — serves website/ as static assets and
 * picks up this repo-root functions/ directory, exactly like Cloudflare does):
 *   npx wrangler pages dev website
 *   then open the printed localhost URL and hit /api/card
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS)
  });
}

/* CORS preflight */
export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/* GET and POST both return the same scaffold payload for now. */
export function onRequest(context) {
  try {
    const method = context.request.method;
    if (method !== "GET" && method !== "POST" && method !== "OPTIONS") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }
    if (method === "OPTIONS") {
      return onRequestOptions();
    }

    // TODO: parse tx hash, verify on Base RPC, bump KV serial, build SVG note.
    return json({
      ok: true,
      serial: "LK 0000001",
      message: "Thank you for your donation to LUKO."
    });
  } catch (error) {
    return json({ ok: false, error: String((error && error.message) || error) }, 500);
  }
}
