/* Live market data for the genesis page, read directly from the
   Aerodrome pool over public Base RPC. No third-party price APIs.
   The page renders "—" placeholders and stays usable without this script. */
(function () {
  "use strict";

  var POOL_ADDRESS = "0x2222A01b83Db8c533B062AEb6DE4F61D6Ae792F2";
  var RPC_URL = "https://mainnet.base.org";

  /* getReserves() → (reserve0, reserve1, blockTimestampLast).
     token0 of this pool is LUKO (verified on-chain via token0(), 0x0dfe1681):
     reserve0 = LUKO, 18 decimals; reserve1 = USDC, 6 decimals. */
  var GET_RESERVES = "0x0902f1ac";

  if (typeof BigInt === "undefined" || !window.fetch) return;

  function ethCall(to, calldata) {
    return fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
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

  function word(hex, index) {
    return BigInt("0x" + hex.slice(2 + index * 64, 2 + (index + 1) * 64));
  }

  function load() {
    return ethCall(POOL_ADDRESS, GET_RESERVES).then(function (result) {
      if (result.length < 2 + 64 * 2) throw new Error("rpc");
      var lukoReserve = Number(word(result, 0)) / 1e18;
      var usdcReserve = Number(word(result, 1)) / 1e6;
      if (!(lukoReserve > 0) || !(usdcReserve > 0)) throw new Error("empty");
      var price = usdcReserve / lukoReserve;
      setValue("market-price", formatFixed(price, 6) + " USDC");
      setValue("market-depth", formatFixed(usdcReserve * 2, 2) + " USDC");
      setValue("market-value", formatFixed(50000 * price, 2) + " USDC");
    });
  }

  load().catch(function () {
    setTimeout(function () {
      load().catch(function () { /* keep "—" */ });
    }, 3000);
  });

  /* Vested-so-far counter — Sablier Lockup v4.0 stream on Base.
     The stream is linear, so time math reproduces the exact on-chain curve;
     timestamps and deposit below were read from the contract for stream 902.
     One streamedAmountOf(uint256) call (0x4869e12d) calibrates the counter
     when RPC is available; without it the counter still runs. */
  var LOCKUP_ADDRESS = "0xc19a09A66887017F603E5dF420ed3Cb9a5c07C0A";
  var STREAM_ID = 902;
  var VEST_START = 1785697200; /* getStartTime(902) */
  var VEST_END = 1819055100;   /* getEndTime(902) */
  var VEST_TOTAL = 140000;     /* getDepositedAmount(902), LUKO */

  var vestOffset = 0;

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
    if (status && status.textContent !== "Active") {
      status.textContent = "Active";
      status.className = "accent";
    }
    var vested = vestedAt(nowSec) + vestOffset;
    vested = Math.min(Math.max(vested, 0), VEST_TOTAL);
    setValue("vested-amount", formatFixed(vested, 2) + " LUKO");
  }

  function calibrate() {
    var calldata =
      "0x4869e12d" + STREAM_ID.toString(16).padStart(64, "0");
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
