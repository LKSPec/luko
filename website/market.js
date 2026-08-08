/* Live market data for the genesis page, read directly from Base public RPC.
   No third-party price APIs, no keys. The page renders "—" placeholders and
   stays usable without this script. */
import { CONFIG } from "./config.js";

(function () {
  "use strict";

  var RPC_URL = CONFIG.network.clientRpc;
  var POOL_ADDRESS = CONFIG.addresses.pool;
  var LUKO_ADDRESS = CONFIG.addresses.luko;
  var USDC_ADDRESS = CONFIG.addresses.usdc;
  var BALANCE_OF = "0x70a08231"; /* balanceOf(address) */

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
  var DELTA = CONFIG.streams.delta;
  var VEST_START = DELTA.start;
  var VEST_END = DELTA.end;
  var VEST_TOTAL = DELTA.total;

  function vestedAt(nowSec) {
    if (nowSec <= VEST_START) return 0;
    if (nowSec >= VEST_END) return VEST_TOTAL;
    return VEST_TOTAL * (nowSec - VEST_START) / (VEST_END - VEST_START);
  }

  function renderVested() {
    var nowSec = Date.now() / 1000;
    var status = document.getElementById("stream-status");
    if (nowSec < VEST_START) {
      setValue("vested-amount", "—");
      return;
    }
    if (status && status.dataset.en !== "Active") {
      status.dataset.en = "Active";
      status.dataset.lt = "Aktyvus";
      status.textContent = document.documentElement.lang === "lt" ? status.dataset.lt : status.dataset.en;
      status.className = "accent";
    }
    var vested = Math.min(Math.max(vestedAt(nowSec), 0), VEST_TOTAL);
    setValue("vested-amount", formatFixed(vested, 2) + " LUKO");
  }

  renderVested();
  setInterval(renderVested, 1000);
})();
