/* Deed of Founder Status — live signature state read directly from the
   on-chain LUKOCovenant. Both founders call sign(); the contract records each
   signature's timestamp and seals once both are in. Until a signature exists
   the page keeps its localized "awaiting" placeholder; then it shows the
   on-chain date. No third-party source — the page is usable without this. */
import { CONFIG } from "./config.js?v=3";

(function () {
  "use strict";

  var COVENANT = CONFIG.addresses.covenant;
  if (!COVENANT || !window.fetch || typeof BigInt === "undefined") return;

  /* view-function selectors on LUKOCovenant */
  var LAMBDA_SIGNED_AT = "0x6f25638a"; /* lambdaSignedAtTime() -> uint64 */
  var DELTA_SIGNED_AT = "0x7e8e4120";  /* deltaSignedAtTime()  -> uint64 */
  var IS_SEALED = "0x631f9852";        /* isSealed()           -> bool   */

  var RPCS = [CONFIG.network.clientRpc].concat(CONFIG.rpc.endpoints || []);

  /* One eth_call, walking the RPC list until one answers. */
  function ethCall(selector) {
    var payload = JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "eth_call",
      params: [{ to: COVENANT, data: selector }, "latest"]
    });
    var i = 0;
    function attempt() {
      return fetch(RPCS[i], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
      }).then(function (response) {
        if (!response.ok) throw new Error("rpc");
        return response.json();
      }).then(function (json) {
        if (!json.result || json.result === "0x") throw new Error("rpc");
        return json.result;
      }).catch(function (error) {
        i += 1;
        if (i < RPCS.length) return attempt();
        throw error;
      });
    }
    return attempt();
  }

  /* YYYY-MM-DD in UTC — matches how the deed states its dates. */
  function isoDate(seconds) {
    return new Date(seconds * 1000).toISOString().slice(0, 10);
  }

  /* Once a value is written from chain it becomes fixed truth, so the
     data-en/data-lt attributes are dropped to keep the language toggle from
     overwriting it. */
  function fix(element, text) {
    element.removeAttribute("data-en");
    element.removeAttribute("data-lt");
    element.textContent = text;
    element.classList.add("gold");
  }

  function fillSignature(id, hexTime) {
    var element = document.getElementById(id);
    if (!element) return;
    var seconds = Number(BigInt(hexTime));
    if (seconds > 0) fix(element, isoDate(seconds));
    /* seconds === 0 → leave the localized "awaiting" placeholder in place */
  }

  function fillSealed(hexBool) {
    var element = document.getElementById("covenant-status");
    if (!element) return;
    if (BigInt(hexBool) === 1n) {
      fix(element, document.documentElement.lang === "lt" ? "Užrakinta (Sealed)" : "Sealed");
    }
  }

  ethCall(LAMBDA_SIGNED_AT).then(function (t) { fillSignature("sig-lambda", t); }).catch(function () {});
  ethCall(DELTA_SIGNED_AT).then(function (t) { fillSignature("sig-delta", t); }).catch(function () {});
  ethCall(IS_SEALED).then(function (b) { fillSealed(b); }).catch(function () {});
})();
