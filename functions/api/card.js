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
 *     1. verify the tx on Base (eth_getTransactionReceipt): exists + status ok
 *     2. confirm it carries a LUKO ERC-20 Transfer TO the donation address
 *     3. read the donated amount from the Transfer log
 *     4. issue a serial from KV (idempotent per txHash), never signs anything
 *     5. fill the SVG note template and return it inline
 *   Response JSON: { ok, serial, nominal, date, txHash, svg }
 *   Errors:        { ok:false, error }  (tx_not_found | tx_failed |
 *                   no_luko_transfer | wrong_recipient | ...)
 *
 * The Worker only READS chain state. All signing happens client-side in the
 * user's wallet. No private keys here.
 *
 * ---- CONFIG PLACEHOLDERS (fill these) --------------------------------------
 *   DONATION_ADDRESS  — recipient the donor sends LUKO to (see below).
 *   KV binding CARDS  — create a KV namespace and bind it as CARDS in the CF
 *                       Pages dashboard (Settings → Functions → KV bindings).
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

export function onRequestGet() {
  return json({ ok: true, message: "POST a txHash to receive a donation note." });
}

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params })
  });
  if (!response.ok) throw new Error("rpc_http_" + response.status);
  const data = await response.json();
  if (data.error) throw new Error("rpc_" + (data.error.message || "error"));
  return data.result;
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

/* Issue (or re-return) a serial for this tx. Idempotent by txHash.
   NOTE: KV is not strongly atomic — two brand-new donations landing in the same
   instant could in theory read the same counter and collide. At this volume
   (occasional personal donations) that race is acceptable; the txHash key still
   guarantees a refresh never issues a second serial for the same donation. */
async function issueSerial(env, txHash, donation) {
  const cardKey = "card:" + txHash.toLowerCase();
  const existing = await env.CARDS.get(cardKey);
  if (existing) return JSON.parse(existing);

  const current = parseInt((await env.CARDS.get("serial:counter")) || "0", 10);
  const next = current + 1;
  await env.CARDS.put("serial:counter", String(next));

  const card = {
    serial: serialString(next),
    nominal: donation.nominal,
    date: donation.date,
    txHash: txHash.toLowerCase()
  };
  await env.CARDS.put(cardKey, JSON.stringify(card));
  return card;
}

async function fillTemplate(request, card) {
  const origin = new URL(request.url).origin;
  const response = await fetch(origin + "/assets/donation-card.svg");
  if (!response.ok) throw new Error("template_unavailable");
  let svg = await response.text();
  svg = svg
    .replace(/\{\{SERIAL\}\}/g, card.serial)
    .replace(/\{\{NOMINAL\}\}/g, card.nominal)
    .replace(/\{\{DATE\}\}/g, card.date)
    .replace(/\{\{TXHASH\}\}/g, card.txHash);
  return svg;
}

export async function onRequestPost(context) {
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(DONATION_ADDRESS) ||
        DONATION_ADDRESS === "0x0000000000000000000000000000000000000000") {
      return fail("donation_address_not_configured", 503);
    }
    if (!context.env || !context.env.CARDS) {
      return fail("kv_not_bound", 503);
    }

    let body;
    try { body = await context.request.json(); } catch (e) { body = {}; }
    const txHash = body && body.txHash;
    if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return fail("invalid_tx_hash");
    }

    const donation = await verifyDonation(txHash);
    const card = await issueSerial(context.env, txHash, donation);
    const svg = await fillTemplate(context.request, card);

    return json({
      ok: true,
      serial: card.serial,
      nominal: card.nominal,
      date: card.date,
      txHash: card.txHash,
      svg: svg
    });
  } catch (error) {
    const message = String((error && error.message) || error);
    /* known verification errors are 400; anything else is a 500 */
    const known = ["tx_not_found", "tx_failed", "no_luko_transfer", "wrong_recipient", "template_unavailable"];
    return fail(message, known.indexOf(message) !== -1 ? 400 : 500);
  }
}
