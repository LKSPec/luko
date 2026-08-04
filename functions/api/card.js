/* Cloudflare Pages Function — LUKO Genesis Donation Note.
 *
 * Route: POST /api/card   (this file lives at functions/api/card.js, REPO ROOT)
 *
 * Layout note: Cloudflare Pages builds this project with the static site in
 * website/ (build output directory) and reads Pages Functions from the
 * `functions/` directory at the project ROOT — NOT inside website/. Keep this
 * file at repo-root functions/, or the /api/card route silently 404s to HTML.
 *
 * What it does:
 *   POST { txHash } →
 *     1. if a note already exists for this tx in KV, return it (no chain call)
 *     2. else verify the tx on Base (eth_getTransactionReceipt): exists + ok
 *     3. confirm it carries a LUKO ERC-20 Transfer TO the donation address
 *     4. read the donated amount from the Transfer log
 *     5. issue a serial from KV (idempotent per txHash), never signs anything
 *     6. fill the SVG note template and return it inline
 *   Response JSON: { ok, serial, nominal, date, txHash, svg }
 *   Errors:        { ok:false, error }  (tx_not_found | tx_failed |
 *                   no_luko_transfer | wrong_recipient | ...)
 *
 * Shareable URL (same logic, GET):
 *   GET /api/card?tx=0x...             → the note as image/svg+xml
 *   GET /api/card?tx=0x...&format=json → JSON metadata + inline svg
 *
 * The Worker only READS chain state. All signing happens client-side in the
 * user's wallet. No private keys here.
 *
 * ---- CONFIG PLACEHOLDERS (fill these) --------------------------------------
 *   DONATION_ADDRESS  — recipient the donor sends LUKO to (see below).
 *   KV binding CARDS  — create a KV namespace and bind it as CARDS in the CF
 *                       Pages dashboard (Settings → Bindings). Bindings apply
 *                       only to deployments created AFTER the binding is added,
 *                       so a redeploy is required for a new CARDS binding.
 * RPC note: public https://mainnet.base.org is rate-limited (~a few req/s).
 * This endpoint makes at most 2 RPC calls per request (receipt + block) and is
 * only hit on a real donation, so free-tier limits are not a concern.
 * ---------------------------------------------------------------------------
 *
 * Local testing (run from REPO ROOT — serves website/ + this functions/ dir,
 * and provisions a local KV so the serial counter works):
 *   npx wrangler pages dev website --kv CARDS
 */

/* Donation recipient. RECOMMENDATION: use a DEDICATED address (a fresh wallet
   that holds nothing else), not the main LUKO treasury. Then every inbound LUKO
   transfer to it is unambiguously a donation — verification has no false matches
   from unrelated treasury movement, the deployer address stays private, and the
   donation total is trivially auditable. Fill the 20-byte address below. */
const DONATION_ADDRESS = "0x7D9766F447a6B86Cf589A31db5b5535e379863E7";

const LUKO_ADDRESS = "0x4a9DA2831A691E7C4aca594CaFd58c35e0131fD1";
const RPC_URL = "https://mainnet.base.org";
/* keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/* Email (optional). Mailjet REST API — Basic Auth from CF secrets
   MAILJET_API_KEY / MAILJET_SECRET_KEY, set via:
     wrangler pages secret put MAILJET_API_KEY
     wrangler pages secret put MAILJET_SECRET_KEY
   Never hardcode them. SMTP is not usable from Workers — REST only. */
const MAIL_FROM = "thankyou@meetluko.eu";
const MAIL_FROM_NAME = "LUKO";
const MAIL_REPLYTO = "hello@meetluko.eu";
const SITE_URL = "https://meetluko.eu";
/* cap the client PNG we forward to Mailjet (~a few hundred KB expected) */
const MAX_PNG_BASE64 = 4000000;

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

function fail(error, status) {
  return json({ ok: false, error: error }, status || 400);
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/* GET /api/card               → service info
   GET /api/card?tx=0x...       → the note SVG (image/svg+xml), a shareable URL
   GET /api/card?tx=0x...&format=json → JSON metadata + inline svg */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const txHash = url.searchParams.get("tx");
  if (!txHash) {
    return json({ ok: true, message: "POST a txHash, or GET ?tx=0x...&format=svg, to receive a donation note." });
  }
  try {
    const cfg = configError(context);
    if (cfg) return cfg;
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return fail("invalid_tx_hash");

    const card = await getOrCreateCard(context.env, txHash);
    const svg = await fillTemplate(context.request, card, false); /* public: no bearer */

    if (url.searchParams.get("format") === "json") {
      return json({ ok: true, serial: card.serial, nominal: card.nominal, date: card.date, txHash: card.txHash, svg: svg });
    }
    return new Response(svg, {
      headers: Object.assign({ "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" }, CORS_HEADERS)
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function rpcOnce(method, params) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params })
  });
  if (!response.ok) {
    const err = new Error("rpc_http_" + response.status);
    err.status = response.status;
    throw err;
  }
  const data = await response.json();
  if (data.error) throw new Error("rpc_" + (data.error.message || "error"));
  return data.result;
}

/* Public Base RPC is rate-limited; retry once on 429 after a short pause. */
async function rpc(method, params) {
  try {
    return await rpcOnce(method, params);
  } catch (error) {
    if (error && error.status === 429) {
      await new Promise(function (r) { setTimeout(r, 600); });
      return await rpcOnce(method, params);
    }
    throw error;
  }
}

function topicToAddress(topic) {
  return ("0x" + topic.slice(26)).toLowerCase();
}

function commas(intString) {
  return intString.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDate(unixSeconds) {
  /* 2026-08-04T17:46:23.000Z → 2026-08-04 17:46:23 UTC */
  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function serialString(counter) {
  return "LK " + String(counter).padStart(7, "0");
}

/* URL-safe form of a serial: "LK 0000001" → "LK0000001". Used for the
   /card/{slug} permalink and the serial→txHash reverse index key. */
function slugFor(serial) {
  return String(serial).replace(/\s+/g, "").toUpperCase();
}

/* Verify the tx and extract the LUKO donation. Returns { nominal, date } or throws. */
async function verifyDonation(txHash) {
  const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
  if (!receipt) throw new Error("tx_not_found");
  if (receipt.status !== "0x1") throw new Error("tx_failed");

  const logs = receipt.logs || [];
  let transfer = null;
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (log.address.toLowerCase() !== LUKO_ADDRESS.toLowerCase()) continue;
    if (!log.topics || log.topics[0].toLowerCase() !== TRANSFER_TOPIC) continue;
    if (topicToAddress(log.topics[2]) !== DONATION_ADDRESS.toLowerCase()) continue;
    transfer = log;
    break;
  }
  if (!transfer) {
    /* a LUKO transfer exists but not to us, or no LUKO transfer at all */
    const anyLuko = logs.some(function (l) {
      return l.address.toLowerCase() === LUKO_ADDRESS.toLowerCase() &&
        l.topics && l.topics[0].toLowerCase() === TRANSFER_TOPIC;
    });
    throw new Error(anyLuko ? "wrong_recipient" : "no_luko_transfer");
  }

  const raw = BigInt(transfer.data);           /* 18-decimal units */
  const whole = raw / (10n ** 18n);            /* whole LUKO for the note face */
  const nominal = commas(whole.toString());

  const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
  const date = formatDate(parseInt(block.timestamp, 16));

  return { nominal: nominal, date: date };
}

function cardKeyFor(txHash) {
  return "card:" + txHash.toLowerCase();
}

/* Mint a new serial for a first-seen tx. Idempotency is handled by the caller
   (which checks KV before any RPC), so this only runs for genuinely new cards.
   NOTE: KV is not strongly atomic — two brand-new donations landing in the same
   instant could in theory read the same counter and collide. At this volume
   (occasional personal donations) that race is acceptable; the txHash key still
   guarantees a refresh never issues a second serial for the same donation. */
async function issueSerial(env, txHash, donation, bearer) {
  const current = parseInt((await env.CARDS.get("serial:counter")) || "0", 10);
  const next = current + 1;
  await env.CARDS.put("serial:counter", String(next));

  const card = {
    serial: serialString(next),
    nominal: donation.nominal,
    date: donation.date,
    txHash: txHash.toLowerCase(),
    bearer: cleanBearer(bearer)
  };
  await env.CARDS.put(cardKeyFor(txHash), JSON.stringify(card));
  /* reverse index so the /card/{serial} page can resolve serial → txHash */
  await env.CARDS.put("serial:" + slugFor(card.serial), card.txHash);
  return card;
}

/* Lookup only — never creates. Used by the email path so a KV read-after-write
   lag can't cause a second serial to be minted for an already-issued tx. */
async function getCard(env, txHash) {
  const raw = await env.CARDS.get(cardKeyFor(txHash));
  return raw ? JSON.parse(raw) : null;
}

/* The bearer line ({{BEARER}}, the donor's email) is filled ONLY on the private
   copy — the SVG returned to the donor for download and email attachment.
   Public views (GET permalink, /card/{serial}) pass isPrivate=false so the
   bearer stays blank and the email is never exposed on a shareable URL. */
async function fillTemplate(request, card, isPrivate) {
  const origin = new URL(request.url).origin;
  const response = await fetch(origin + "/assets/donation-card.svg");
  if (!response.ok) throw new Error("template_unavailable");
  let svg = await response.text();
  const bearer = (isPrivate && card.bearer) ? card.bearer : "";
  svg = svg
    .replace(/\{\{SERIAL\}\}/g, card.serial)
    .replace(/\{\{NOMINAL\}\}/g, card.nominal)
    .replace(/\{\{DATE\}\}/g, card.date)
    .replace(/\{\{TXHASH\}\}/g, card.txHash)
    .replace(/\{\{BEARER\}\}/g, bearer);
  return svg;
}

/* Sanitize a donor-supplied bearer string for safe inclusion in the SVG. */
function cleanBearer(value) {
  return String(value || "").replace(/[<>&"']/g, "").trim().slice(0, 60);
}

/* Config guard: returns a fail Response if the endpoint is not ready, else null. */
function configError(context) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(DONATION_ADDRESS) ||
      DONATION_ADDRESS === "0x0000000000000000000000000000000000000000") {
    return fail("donation_address_not_configured", 503);
  }
  if (!context.env || !context.env.CARDS) {
    return fail("kv_not_bound", 503);
  }
  return null;
}

/* KV-first: a note already issued for this tx is returned WITHOUT touching the
   chain — refreshes and shared-URL views are RPC-free and cannot hit rate
   limits. Only a genuinely new tx is verified on-chain and given a serial. */
async function getOrCreateCard(env, txHash, bearer) {
  const existing = await env.CARDS.get(cardKeyFor(txHash));
  if (existing) {
    const card = JSON.parse(existing);
    /* backfill the reverse index for cards issued before it existed */
    const indexKey = "serial:" + slugFor(card.serial);
    if (!(await env.CARDS.get(indexKey))) await env.CARDS.put(indexKey, card.txHash);
    return card;
  }
  const donation = await verifyDonation(txHash);
  return await issueSerial(env, txHash, donation, bearer);
}

/* Send the note by email via the Mailjet REST API. Returns {ok} / {ok:false,error};
   never throws — a mail failure must not fail the (already-issued) note. */
async function sendEmail(env, card, email, pngBase64) {
  const apiKey = env.MAILJET_API_KEY;
  const secret = env.MAILJET_SECRET_KEY;
  if (!apiKey || !secret) return { ok: false, error: "email_not_configured" };

  const slug = slugFor(card.serial);
  const link = SITE_URL + "/card/" + slug;
  const lines = [
    "A genesis donation note has been issued to the bearer.",
    "",
    "Serial   " + card.serial,
    "Nominal  " + card.nominal + " LUKO",
    "Date     " + card.date,
    "",
    "View your note: " + link,
    "",
    "LUKO — " + SITE_URL
  ];
  const html =
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#0A0A0A;line-height:1.7">' +
    "<p>A genesis donation note has been issued to the bearer.</p>" +
    '<p style="font-family:monospace">Serial&nbsp;&nbsp;' + card.serial +
    "<br>Nominal&nbsp;" + card.nominal + " LUKO" +
    "<br>Date&nbsp;&nbsp;&nbsp;&nbsp;" + card.date + "</p>" +
    '<p><a href="' + link + '" style="color:#9a7b3f">View your note &rarr;</a></p>' +
    '<p style="color:#8C8577">LUKO — ' + SITE_URL + "</p></div>";

  const message = {
    From: { Email: MAIL_FROM, Name: MAIL_FROM_NAME },
    To: [{ Email: email }],
    ReplyTo: { Email: MAIL_REPLYTO },
    Subject: "Your LUKO Genesis Donation Note — " + card.serial,
    TextPart: lines.join("\n"),
    HTMLPart: html
  };
  if (pngBase64 && pngBase64.length <= MAX_PNG_BASE64) {
    message.Attachments = [{
      ContentType: "image/png",
      Filename: "luko-donation-" + slug + ".png",
      Base64Content: pngBase64
    }];
  }

  try {
    const response = await fetch("https://api.mailjet.com/v3.1/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + btoa(apiKey + ":" + secret)
      },
      body: JSON.stringify({ Messages: [message] })
    });
    if (!response.ok) return { ok: false, error: "mailjet_http_" + response.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "mailjet_unreachable" };
  }
}

function errorResponse(error) {
  const message = String((error && error.message) || error);
  /* known verification errors are 400; anything else is a 500 */
  const known = ["tx_not_found", "tx_failed", "no_luko_transfer", "wrong_recipient", "template_unavailable"];
  return fail(message, known.indexOf(message) !== -1 ? 400 : 500);
}

export async function onRequestPost(context) {
  try {
    const cfg = configError(context);
    if (cfg) return cfg;

    let body;
    try { body = await context.request.json(); } catch (e) { body = {}; }
    const txHash = body && body.txHash;
    if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return fail("invalid_tx_hash");
    }

    const email = typeof body.email === "string" ? body.email.trim() : "";

    /* Email path — the note was already generated by a prior POST; look it up
       (no create → no double-issue under KV lag) and mail it. Best-effort:
       falls back to client-echoed fields only if KV has not yet propagated. */
    if (email) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("invalid_email");
      let card = await getCard(context.env, txHash);
      if (!card && body.serial) {
        card = {
          serial: String(body.serial),
          nominal: String(body.nominal || ""),
          date: String(body.date || ""),
          txHash: txHash.toLowerCase()
        };
      }
      if (!card) return fail("card_not_found");
      const pngBase64 = typeof body.pngBase64 === "string" ? body.pngBase64 : "";
      const sent = await sendEmail(context.env, card, email, pngBase64);
      return json({ ok: true, emailed: sent.ok, error: sent.ok ? undefined : sent.error });
    }

    /* Generation path — bearer (optional) personalizes the PRIVATE copy only. */
    const bearer = typeof body.bearer === "string" ? body.bearer : "";
    const card = await getOrCreateCard(context.env, txHash, bearer);
    const svg = await fillTemplate(context.request, card, true);

    return json({
      ok: true,
      serial: card.serial,
      nominal: card.nominal,
      date: card.date,
      txHash: card.txHash,
      svg: svg
    });
  } catch (error) {
    return errorResponse(error);
  }
}
