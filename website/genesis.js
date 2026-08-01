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
})();
