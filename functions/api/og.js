/* Cloudflare Pages Function — live og:image.
 *
 * GET /api/og → PNG 1200x630 rendered from assets/og-live.svg with the
 * current price, holder count and block filled in. Rasterization happens
 * here via resvg-wasm (vendored in functions/lib, MPL-2.0); fonts are
 * served from the site's own assets. No third-party image services.
 *
 * Holder count is computed from LUKO Transfer logs with a balances
 * checkpoint stored in the CARDS KV namespace, so each request scans only
 * blocks since the previous run.
 *
 * Public Base RPCs rate-limit Cloudflare egress IPs; set a keyed endpoint
 * in the RPC_URL env var (full URL) or DRPC_API_KEY (bare dRPC key) for
 * reliable reads. Data failures degrade to em dashes; render failures fall
 * back to the static assets/social-1200x630.png. Cached for 10 minutes.
 *
 * Local testing: npx wrangler pages dev website --kv CARDS
 */

import { initWasm, Resvg } from "../lib/resvg.js";
import wasmModule from "../lib/resvg.wasm";
import { CONFIG } from "../../website/config.js";

const LUKO_ADDRESS = CONFIG.addresses.luko;
const USDC_ADDRESS = CONFIG.addresses.usdc;
const POOL_ADDRESS = CONFIG.addresses.pool;
const DEPLOY_BLOCK = CONFIG.network.deployBlock;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_ADDRESS = "0000000000000000000000000000000000000000";
/* public RPCs cap eth_getLogs around a 10,000-block range */
const CHUNK_SIZE = 10000;
const CHECKPOINT_KEY = "og-holders-checkpoint-v1";
/* Server-side RPC pool (see config.js). Public Base RPCs rate-limit
   Cloudflare's shared egress IPs, so requests spread across all endpoints,
   entered at a random index. */
const RPC_URLS = CONFIG.rpc.endpoints;

function rotatedRpcUrls() {
  const start = Math.floor(Math.random() * RPC_URLS.length);
  const urls = [];
  for (let i = 0; i < RPC_URLS.length; i++) {
    urls.push(RPC_URLS[(start + i) % RPC_URLS.length]);
  }
  return urls;
}
const FONT_PATHS = [
  "/assets/fonts/Archivo-ExtraLight.ttf",
  "/assets/fonts/JetBrainsMono-Regular.ttf"
];

let wasmReady = null;
let fontCache = null;

function keyedRpcUrls(env) {
  const urls = [];
  if (env && env.RPC_URL) urls.push(env.RPC_URL);
  if (env && env.DRPC_API_KEY) {
    urls.push(env.DRPC_API_KEY.indexOf("http") === 0
      ? env.DRPC_API_KEY
      : "https://lb.drpc.live/base/" + env.DRPC_API_KEY);
  }
  return urls;
}

async function rpc(env, method, params) {
  const urls = keyedRpcUrls(env).concat(rotatedRpcUrls());
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
      });
      if (!response.ok) continue;
      const payload = await response.json();
      if (!payload || payload.error || payload.result === undefined || payload.result === null) continue;
      return payload.result;
    } catch (error) { /* try next endpoint */ }
  }
  throw new Error("rpc");
}

function balanceCalldata(holder) {
  return "0x70a08231" + holder.slice(2).toLowerCase().padStart(64, "0");
}

/* Pool reserves + latest block, one batched request. Null on failure. */
async function fetchMarket(env) {
  const urls = keyedRpcUrls(env).concat(rotatedRpcUrls());
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: LUKO_ADDRESS, data: balanceCalldata(POOL_ADDRESS) }, "latest"] },
          { jsonrpc: "2.0", id: 2, method: "eth_call", params: [{ to: USDC_ADDRESS, data: balanceCalldata(POOL_ADDRESS) }, "latest"] },
          { jsonrpc: "2.0", id: 3, method: "eth_blockNumber", params: [] }
        ])
      });
      if (!response.ok) continue;
      const items = await response.json();
      if (!Array.isArray(items)) continue;
      const values = {};
      let bad = false;
      for (const item of items) {
        if (item.error || !item.result || item.result === "0x") { bad = true; break; }
        values[item.id] = item.result;
      }
      if (bad || !values[1] || !values[2] || !values[3]) continue;
      return {
        luko: Number(BigInt(values[1])) / 1e18,
        usdc: Number(BigInt(values[2])) / 1e6,
        block: parseInt(values[3], 16)
      };
    } catch (error) { /* try next endpoint */ }
  }
  return null;
}

/* Holder count from Transfer logs, checkpointed in KV. Null on failure. */
async function fetchHolders(env, latest) {
  try {
    const kv = env && env.CARDS;
    const balances = new Map();
    let from = DEPLOY_BLOCK;
    if (kv) {
      const raw = await kv.get(CHECKPOINT_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && typeof data.block === "number" && Array.isArray(data.balances)) {
          for (const entry of data.balances) balances.set(entry[0], BigInt("0x" + entry[1]));
          from = data.block + 1;
        }
      }
    }
    while (from <= latest) {
      const to = Math.min(from + CHUNK_SIZE - 1, latest);
      const logs = await rpc(env, "eth_getLogs", [{
        address: LUKO_ADDRESS,
        fromBlock: "0x" + from.toString(16),
        toBlock: "0x" + to.toString(16),
        topics: [TRANSFER_TOPIC]
      }]);
      for (const log of logs) {
        if (!log.topics || log.topics.length < 3 || !log.data) throw new Error("rpc");
        const sender = log.topics[1].slice(-40).toLowerCase();
        const receiver = log.topics[2].slice(-40).toLowerCase();
        const amount = BigInt(log.data);
        if (sender !== ZERO_ADDRESS) balances.set(sender, (balances.get(sender) || 0n) - amount);
        if (receiver !== ZERO_ADDRESS) balances.set(receiver, (balances.get(receiver) || 0n) + amount);
      }
      from = to + 1;
    }
    let holders = 0;
    const entries = [];
    for (const [address, balance] of balances.entries()) {
      if (balance > 0n) {
        holders += 1;
        entries.push([address, balance.toString(16)]);
      }
    }
    if (kv) await kv.put(CHECKPOINT_KEY, JSON.stringify({ block: latest, balances: entries }));
    return holders;
  } catch (error) {
    return null;
  }
}

async function loadFonts(origin) {
  if (fontCache) return fontCache;
  const buffers = [];
  for (const path of FONT_PATHS) {
    const response = await fetch(origin + path);
    if (!response.ok) throw new Error("font");
    buffers.push(new Uint8Array(await response.arrayBuffer()));
  }
  fontCache = buffers;
  return buffers;
}

async function staticFallback(origin) {
  const response = await fetch(origin + "/assets/social-1200x630.png");
  return new Response(response.body, {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "public, s-maxage=600" }
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = url.origin;
  /* ?debug=1 reports what the edge actually read, as JSON. The card itself
     degrades silently to em dashes, which hides whether the chain read or the
     rasterizer failed; this makes that visible without guessing. */
  const debug = url.searchParams.get("debug") === "1";
  const cache = caches.default;
  if (!debug) {
    const cached = await cache.match(context.request);
    if (cached) return cached;
  }
  try {
    const market = await fetchMarket(context.env);
    const holders = market ? await fetchHolders(context.env, market.block) : null;
    const price = market && market.luko > 0 ? market.usdc / market.luko : null;
    const now = new Date().toISOString();

    if (debug) {
      return new Response(JSON.stringify({
        market: market,
        price: price,
        holders: holders,
        keyedRpc: keyedRpcUrls(context.env).length,
        kvBound: !!(context.env && context.env.CARDS)
      }, null, 2), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }

    let svg = await (await fetch(origin + "/assets/og-live.svg")).text();
    /* replaceAll: the template's header comment also mentions each token */
    svg = svg
      .replaceAll("{{PRICE}}", price ? (price * 1000).toFixed(2) : "—")
      .replaceAll("{{PRICE_SUB}}", price ? price.toFixed(6) : "—")
      .replaceAll("{{HOLDERS}}", holders !== null ? holders.toLocaleString("en-US") : "—")
      .replaceAll("{{DATE}}", now.slice(0, 10) + " " + now.slice(11, 16));

    if (!wasmReady) wasmReady = initWasm(wasmModule);
    await wasmReady;
    const fonts = await loadFonts(origin);
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: 1200 },
      font: {
        loadSystemFonts: false,
        fontBuffers: fonts,
        defaultFontFamily: "JetBrains Mono"
      }
    });
    const png = resvg.render().asPng();
    const response = new Response(png, {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "public, s-maxage=600" }
    });
    context.waitUntil(cache.put(context.request, response.clone()));
    return response;
  } catch (error) {
    return staticFallback(origin);
  }
}
