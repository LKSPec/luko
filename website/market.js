/* Live market data for the genesis page, read directly from Base public RPC.
   No third-party price APIs, no keys. The page renders "—" placeholders and
   stays usable without this script. */
(function () {
  "use strict";

  var RPC_URL = "https://mainnet.base.org";
  var POOL_ADDRESS = "0x2222A01b83Db8c533B062AEb6DE4F61D6Ae792F2";
  var LUKO_ADDRESS = "0x4a9DA2831A691E7C4aca594CaFd58c35e0131fD1";
  var USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
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

  /* Vested-so-far counter — Sablier Lockup v4.0 stream on Base.
     The stream is linear, so time math reproduces the exact on-chain curve;
     timestamps and deposit below were read from the contract for stream 902.
     One streamedAmountOf(uint256) call (0x4869e12d) calibrates the counter
     when RPC is available; without it the counter still runs. */
  var LOCKUP_ADDRESS = "0xc19a09A66887017F603E5dF420ed3Cb9a5c07C0A";
  var STREAM_ID = 902;
  var VEST_START = 1785697200; /* getStartTime(902) — 2 Aug 2026 22:00 */
  var VEST_END = 1819055100;   /* getEndTime(902) — 24 Aug 2027 00:05 */
  var VEST_TOTAL = 140000;     /* getDepositedAmount(902), LUKO */

  var vestOffset = 0;

  function ethCall(to, calldata) {
    return fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_call",
        params: [{ to: to, data: calldata }, "latest"]
      })
    }).then(function (response) {
      if (!response.ok) throw new Error("rpc");
      return response.json();
    }).then(function (json) {
      if (!json || typeof json.result !== "string" || json.result === "0x") {
        throw new Error("rpc");
      }
      return json.result;
    });
  }

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
    var vested = vestedAt(nowSec) + vestOffset;
    vested = Math.min(Math.max(vested, 0), VEST_TOTAL);
    setValue("vested-amount", formatFixed(vested, 2) + " LUKO");
  }

  function calibrate() {
    var calldata = "0x4869e12d" + STREAM_ID.toString(16).padStart(64, "0");
    return ethCall(LOCKUP_ADDRESS, calldata).then(function (result) {
      var onchain = Number(BigInt(result)) / 1e18;
      vestOffset = onchain - vestedAt(Date.now() / 1000);
    });
  }

  renderVested();
  setInterval(renderVested, 1000);
  calibrate().catch(function () {
    setTimeout(function () {
      calibrate().catch(function () { /* time math only */ });
    }, 3000);
  });
})();
