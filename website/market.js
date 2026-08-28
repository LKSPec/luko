/* Live market data for the genesis page, read directly from Base public RPC.
   No third-party price APIs, no keys. The page renders "—" placeholders and
   stays usable without this script. */
import { CONFIG } from "./config.js?v=2";

(function () {
  "use strict";

  var RPC_URL = CONFIG.network.clientRpc;
  var POOL_ADDRESS = CONFIG.addresses.pool;
  var LUKO_ADDRESS = CONFIG.addresses.luko;
  var USDC_ADDRESS = CONFIG.addresses.usdc;
  var BALANCE_OF = "0x70a08231"; /* balanceOf(address) */
  var lastPrice = null; /* latest USDC/LUKO price, set on each market fetch */

  if (typeof BigInt === "undefined" || !window.fetch) return;

  function balanceCalldata(holder) {
    return BALANCE_OF + holder.slice(2).toLowerCase().padStart(64, "0");
  }

  /* One batched JSON-RPC request: LUKO and USDC balances held by the pool.
     Reading token balances directly avoids assuming the pool's token0/token1
     ordering or its getReserves ABI. */
  function fetchReserves() {
    return fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "eth_call",
          params: [{ to: LUKO_ADDRESS, data: balanceCalldata(POOL_ADDRESS) }, "latest"] },
        { jsonrpc: "2.0", id: 2, method: "eth_call",
          params: [{ to: USDC_ADDRESS, data: balanceCalldata(POOL_ADDRESS) }, "latest"] }
      ])
    }).then(function (response) {
      if (!response.ok) throw new Error("rpc");
      return response.json();
    }).then(function (json) {
      if (!Array.isArray(json) || json.length !== 2) throw new Error("rpc");
      var byId = {};
      json.forEach(function (entry) { byId[entry.id] = entry; });
      var luko = byId[1] && byId[1].result;
      var usdc = byId[2] && byId[2].result;
      if (typeof luko !== "string" || luko === "0x" ||
          typeof usdc !== "string" || usdc === "0x") throw new Error("rpc");
      return {
        luko: Number(BigInt(luko)) / 1e18,
        usdc: Number(BigInt(usdc)) / 1e6
      };
    });
  }

  function setValue(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function formatFixed(value, digits) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function renderMarket(reserves) {
    if (!(reserves.luko > 0) || !(reserves.usdc > 0)) throw new Error("empty");
    var price = reserves.usdc / reserves.luko;
    setValue("market-price", formatFixed(price, 6) + " USDC");
    setValue("market-luko", formatFixed(reserves.luko, 0) + " LUKO");
    setValue("market-usdc", formatFixed(reserves.usdc, 2) + " USDC");
    setValue("market-value", "$" + formatFixed(50000 * price, 2));
    setValue("market-value-140", "$" + formatFixed(140000 * price, 2));
    setValue("market-value-190", "$" + formatFixed(190000 * price, 2));
    lastPrice = price;
    renderAvailable();
  }

  /* "available now" under the streaming value: the vested-so-far portion of one
     founder's 140,000 streaming allocation, in LUKO (ticks client-side from the
     stream schedule) and, once a price is known, its USD value. Makes the split
     between the full allocation and the already-available part explicit. */
  function renderAvailable() {
    var el = document.getElementById("market-avail-140");
    if (!el) return;
    var d = CONFIG.streams.delta;
    var nowSec = Date.now() / 1000;
    var vested = Math.min(Math.max(vestedAt(d, nowSec), 0), d.total);
    var text = formatFixed(vested, 0) + " LUKO";
    if (lastPrice !== null) text += " · ~$" + formatFixed(vested * lastPrice, 2);
    el.textContent = text;
  }

  /* Load with a single retry; refresh every 30 s. Failures keep "—". */
  function loadMarket() {
    return fetchReserves().then(renderMarket);
  }

  function loadMarketWithRetry() {
    loadMarket().catch(function () {
      setTimeout(function () {
        loadMarket().catch(function () { /* keep placeholders */ });
      }, 3000);
    });
  }

  loadMarketWithRetry();
  setInterval(loadMarketWithRetry, 30000);

  /* Vested-so-far counter — Sablier Lockup, linear stream. The vested amount
     is computed purely from the stream's start/end/total (from config), so
     the counter runs entirely client-side with no runtime RPC call. The
     config values must match the on-chain stream exactly; a "Verify on-chain"
     link next to the counter points at the Sablier stream page. */
  function vestedAt(cfg, nowSec) {
    if (nowSec <= cfg.start) return 0;
    if (nowSec >= cfg.end) return cfg.total;
    return cfg.total * (nowSec - cfg.start) / (cfg.end - cfg.start);
  }

  function renderVestedFor(cfg, statusId, vestedId) {
    if (!cfg) return;
    var nowSec = Date.now() / 1000;
    var status = document.getElementById(statusId);
    if (nowSec < cfg.start) {
      setValue(vestedId, "—");
      return;
    }
    if (status && status.dataset.en !== "Active") {
      status.dataset.en = "Active";
      status.dataset.lt = "Aktyvus";
      status.textContent = document.documentElement.lang === "lt" ? status.dataset.lt : status.dataset.en;
      status.className = "accent";
    }
    var vested = Math.min(Math.max(vestedAt(cfg, nowSec), 0), cfg.total);
    setValue(vestedId, formatFixed(vested, 2) + " LUKO");
  }

  function renderStreams() {
    renderVestedFor(CONFIG.streams.delta, "stream-status", "vested-amount");
    renderVestedFor(CONFIG.streams.lambda, "stream-status-lambda", "vested-amount-lambda");
    renderAvailable();
  }

  renderStreams();
  setInterval(renderStreams, 1000);
})();
