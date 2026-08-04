/* Cloudflare Pages Function — permanent donation-note page.
 *
 * Route: GET /card/{serial}   (functions/card/[serial].js, at the REPO ROOT)
 *
 * Resolves a note by its serial and returns the filled SVG (image/svg+xml).
 * This is the shareable URL used in donation emails, e.g.
 *   https://meetluko.eu/card/LK0000001
 *
 * Reads from the same KV namespace (CARDS) that /api/card writes:
 *   serial:{slug}  → txHash        (reverse index)
 *   card:{txHash}  → { serial, nominal, date, txHash }
 * Never touches the chain — pure KV read + template fill.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

/* keep in sync with the slug form in functions/api/card.js */
function slugFor(serial) {
  return String(serial).replace(/\s+/g, "").toUpperCase();
}

/* bearer masking — keep in sync with functions/api/card.js */
function maskLocal(s) {
  s = String(s).replace(/\./g, "");
  if (s.length <= 3) return s;
  return s.slice(0, 2) + "*".repeat(s.length - 3) + s.slice(-1);
}
function maskDomain(d) {
  const i = d.indexOf(".");
  const label = i === -1 ? d : d.slice(0, i);
  const rest = i === -1 ? "" : d.slice(i);
  if (label.length <= 2) return label + rest;
  return label[0] + "*".repeat(label.length - 2) + label.slice(-1) + rest;
}
function maskEmail(value) {
  const at = String(value).indexOf("@");
  if (at === -1) return maskLocal(value);
  return maskLocal(value.slice(0, at)) + "@" + maskDomain(value.slice(at + 1));
}

async function fillTemplate(request, card) {
  const origin = new URL(request.url).origin;
  const response = await fetch(origin + "/assets/donation-card.svg");
  if (!response.ok) throw new Error("template_unavailable");
  let svg = await response.text();
  /* public page — bearer is masked, never the full address */
  const bearer = card.bearer ? maskEmail(card.bearer) : "";
  return svg
    .replace(/\{\{SERIAL\}\}/g, card.serial)
    .replace(/\{\{NOMINAL\}\}/g, card.nominal)
    .replace(/\{\{DATE\}\}/g, card.date)
    .replace(/\{\{TXHASH\}\}/g, card.txHash)
    .replace(/\{\{BEARER\}\}/g, bearer);
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  try {
    if (!context.env || !context.env.CARDS) {
      return new Response("Not available", { status: 503, headers: CORS_HEADERS });
    }
    const slug = slugFor(context.params.serial || "");
    if (!/^LK\d{7}$/.test(slug)) {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }

    const txHash = await context.env.CARDS.get("serial:" + slug);
    if (!txHash) {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }
    const raw = await context.env.CARDS.get("card:" + txHash.toLowerCase());
    if (!raw) {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }

    const svg = await fillTemplate(context.request, JSON.parse(raw));
    return new Response(svg, {
      headers: Object.assign({
        "Content-Type": "image/svg+xml",
        /* notes are immutable once issued */
        "Cache-Control": "public, max-age=86400"
      }, CORS_HEADERS)
    });
  } catch (error) {
    return new Response("Error", { status: 500, headers: CORS_HEADERS });
  }
}
