/* Cloudflare Pages Function — where the genesis supply sits now.
 *
 * GET /api/state → JSON with the current LUKO total of each genesis
 * allocation, read live from Base:
 *   allocation = LUKO balances of its wallets
 *              + what its Sablier streams still hold
 *                (deposited − withdrawn − refunded)
 *   other      = totalSupply − all allocations, i.e. every holder not listed
 *
 * Totals are whole LUKO, rounded so they add up exactly to the supply. The
 * wallet lists stay here and are never returned. All reads are pinned to one
 * block. The dRPC free plan rejects JSON-RPC batches of more than three
 * calls, so calls go out as parallel batches of three. Keyed endpoint first
 * (RPC_URL / DRPC_API_KEY), then the public pool. Cached at the edge for 60 s.
 */

import { CONFIG } from "../../website/config.js";

const LUKO_ADDRESS = CONFIG.addresses.luko;
const LOCKUP_ADDRESS = CONFIG.addresses.sablierLockup;
const UNIT = 10n ** 18n;

const TOTAL_SUPPLY = "0x18160ddd";    /* totalSupply() */
const BALANCE_OF = "0x70a08231";      /* balanceOf(address) */
const DEPOSITED = "0xa80fc071";       /* getDepositedAmount(uint256) */
const WITHDRAWN = "0xd511609f";       /* getWithdrawnAmount(uint256) */
const REFUNDED = "0xd4dbd20b";        /* getRefundedAmount(uint256) */

/* Order matches the allocation table. */
const ALLOCATIONS = [
  {
    key: "lambda",
    streams: [CONFIG.streams.lambda.id],
    wallets: ["0x30fd96c5ae61f0fb3d97e6159ab023710163efbf"]
  },
  {
    key: "delta",
    streams: [CONFIG.streams.delta.id],
    wallets: [
      "0xe8fc8769934f9461f7adf6f440ff3883e28021eb",
      "0xbc170538038adc0651292e28a42dab4286641e02"
    ]
  },
  {
    key: "market",
    /* Stream 904 pays out to the reserve wallet; what it still holds is Market. */
    streams: [904],
    wallets: [
      CONFIG.addresses.pool,
      "0x6e2dc3b1361f28d0ad262c57fae47be907fac1c4"   /* pool fees */
    ]
  },
  {
    key: "operations",
    streams: [],
    wallets: [
      "0x33d857fb6f06aafc498de09654da82a8f68be233",
      "0x46bcf5c09ef3831020d06ed879d69098a5a3c68e",
      "0x7d9766f447a6b86cf589a31db5b5535e379863e7",
      "0xc392bb8ba12a8aa4ddd65d824a1bce36b51205e3",
      "0xe5bf5007a56b83faf325e69ccd83af932d0168a2"
    ]
  },
  {
    key: "reserve",
    streams: [],
    wallets: ["0xf0adec1e81c31bbb253b819c67cbb1826fb7109e"]
  }
];

function rpcUrls(env) {
  const urls = [];
  if (env && env.RPC_URL) urls.push(env.RPC_URL);
  if (env && env.DRPC_API_KEY) {
    urls.push(env.DRPC_API_KEY.indexOf("http") === 0
      ? env.DRPC_API_KEY
      : "https://lb.drpc.live/base/" + env.DRPC_API_KEY);
  }
  const pool = CONFIG.rpc.endpoints;
  const start = Math.floor(Math.random() * pool.length);
  for (let i = 0; i < pool.length; i++) urls.push(pool[(start + i) % pool.length]);
  return urls;
}

function word(value) {
  const hex = typeof value === "number" ? value.toString(16) : value.slice(2).toLowerCase();
  return hex.padStart(64, "0");
}

/* Results in call order; throws if any call fails. */
async function send(url, calls) {
  const batches = [];
  for (let i = 0; i < calls.length; i += 3) batches.push(calls.slice(i, i + 3));
  const replies = await Promise.all(batches.map(async (batch, b) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch.map((call, i) => ({
        jsonrpc: "2.0", id: b * 3 + i, method: call[0], params: call[1]
      })))
    });
    if (!response.ok) throw new Error("rpc");
    const items = await response.json();
    if (!Array.isArray(items)) throw new Error("rpc");
    return items;
  }));
  const byId = new Map();
  for (const items of replies) for (const item of items) byId.set(item.id, item);
  return calls.map((call, i) => {
    const item = byId.get(i);
    if (!item || item.error || item.result === undefined || item.result === null || item.result === "0x") {
      throw new Error("rpc");
    }
    return item.result;
  });
}

/* Floors each total to whole LUKO, then hands the leftover units to the
   largest remainders, so the rounded totals still sum to the supply. */
function wholeTokens(totals, supply) {
  const keys = Object.keys(totals);
  const whole = {};
  let spare = supply / UNIT;
  for (const key of keys) {
    whole[key] = totals[key] / UNIT;
    spare -= whole[key];
  }
  const byRemainder = keys.slice().sort((a, b) => {
    const ra = totals[a] % UNIT;
    const rb = totals[b] % UNIT;
    return ra === rb ? 0 : (ra > rb ? -1 : 1);
  });
  for (const key of byRemainder) {
    if (spare <= 0n) break;
    whole[key] += 1n;
    spare -= 1n;
  }
  const result = {};
  for (const key of keys) result[key] = Number(whole[key]);
  return result;
}

async function readState(url) {
  const [head] = await send(url, [["eth_blockNumber", []]]);
  /* a few blocks behind the head, so every load-balanced node already has it */
  const tag = "0x" + (parseInt(head, 16) - 2).toString(16);
  const call = (to, data) => ["eth_call", [{ to, data }, tag]];

  const calls = [["eth_getBlockByNumber", [tag, false]], call(LUKO_ADDRESS, TOTAL_SUPPLY)];
  for (const allocation of ALLOCATIONS) {
    for (const wallet of allocation.wallets) calls.push(call(LUKO_ADDRESS, BALANCE_OF + word(wallet)));
    for (const id of allocation.streams) {
      calls.push(call(LOCKUP_ADDRESS, DEPOSITED + word(id)));
      calls.push(call(LOCKUP_ADDRESS, WITHDRAWN + word(id)));
      calls.push(call(LOCKUP_ADDRESS, REFUNDED + word(id)));
    }
  }
  const results = await send(url, calls);

  const block = results[0];
  const supply = BigInt(results[1]);
  let cursor = 2;
  const next = () => BigInt(results[cursor++]);
  const totals = {};
  let tracked = 0n;
  let vesting = 0n;
  for (const allocation of ALLOCATIONS) {
    let sum = 0n;
    for (let i = 0; i < allocation.wallets.length; i++) sum += next();
    for (let i = 0; i < allocation.streams.length; i++) {
      const deposited = next();
      const withdrawn = next();
      const refunded = next();
      const left = deposited - withdrawn - refunded;
      sum += left;
      vesting += left;
    }
    totals[allocation.key] = sum;
    tracked += sum;
  }
  totals.other = supply > tracked ? supply - tracked : 0n;

  return {
    block: parseInt(block.number, 16),
    timestamp: parseInt(block.timestamp, 16),
    supply: Number(supply / UNIT),
    vesting: Number(vesting / UNIT),
    allocations: wholeTokens(totals, supply)
  };
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const cached = await cache.match(context.request);
  if (cached) return cached;

  for (const url of rpcUrls(context.env)) {
    try {
      const state = await readState(url);
      const response = new Response(JSON.stringify(state), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=30, s-maxage=60"
        }
      });
      context.waitUntil(cache.put(context.request, response.clone()));
      return response;
    } catch (error) { /* try next endpoint */ }
  }
  return new Response(JSON.stringify({ error: "unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
