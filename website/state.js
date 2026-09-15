/* Current state of the genesis allocation, from /api/state (read live from
   Base by the Pages Function). Fills the NOW column, the "Other holders"
   row, the inner ring of the chart and the source line under the table.
   Without it the page keeps its "—" placeholders and an empty inner ring. */
import { CONFIG } from "./config.js?v=2";

(function () {
  "use strict";

  var ORDER = ["lambda", "delta", "market", "operations", "reserve", "other"];
  var NAMES = {
    lambda: "Founder Λ", delta: "Founder Δ", market: "Market",
    operations: "Operations", reserve: "Reserve", other: "Other holders"
  };
  var RING_RADIUS = 57;
  var CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  if (!window.fetch) return;

  function formatWhole(value) {
    return value.toLocaleString("en-US");
  }

  function formatShare(share) {
    var percent = share * 100;
    if (percent > 0 && percent < 0.1) return "<0.1%";
    return percent.toFixed(1).replace(/\.0$/, "") + "%";
  }

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function shortAddress(address) {
    return address.slice(0, 6) + "…" + address.slice(-4);
  }

  function setBilingual(element, en, lt) {
    if (!element) return;
    element.dataset.en = en;
    element.dataset.lt = lt;
    element.textContent = document.documentElement.lang === "lt" ? lt : en;
  }

  function isValid(state) {
    if (!state || !(state.supply > 0) || !state.allocations) return false;
    return ORDER.every(function (key) { return typeof state.allocations[key] === "number"; });
  }

  function renderTable(state) {
    document.querySelectorAll("[data-now]").forEach(function (cell) {
      var key = cell.getAttribute("data-now");
      var value = key === "total" ? state.supply : state.allocations[key];
      if (typeof value === "number") cell.textContent = formatWhole(value);
    });
  }

  /* Inner ring: same order and starting point as the genesis ring. */
  function renderRing(state) {
    var start = 0;
    var parts = [];
    ORDER.forEach(function (key) {
      var share = state.allocations[key] / state.supply;
      var circle = document.querySelector('[data-ring="' + key + '"]');
      if (circle) {
        var length = share * CIRCUMFERENCE;
        circle.setAttribute("stroke-dasharray", length.toFixed(3) + " " + (CIRCUMFERENCE - length).toFixed(3));
        circle.setAttribute("transform", "rotate(" + (start * 360 - 90).toFixed(3) + " 100 100)");
      }
      parts.push(NAMES[key] + " " + formatShare(share));
      start += share;
    });
    var chart = document.querySelector(".allocation-chart");
    if (chart) {
      chart.setAttribute("aria-label",
        "Genesis allocation, outer ring: Founder Λ 19%, Founder Δ 19%, Market 19%, Operations 19%, Reserve 24%. " +
        "Now, inner ring: " + parts.join(", ") + ".");
    }
  }

  function renderSource(state) {
    var line = document.getElementById("state-source");
    if (!line) return;
    var date = new Date(state.timestamp * 1000);
    var time = pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes()) + " UTC";
    var dateEn = date.getUTCDate() + " " + MONTHS[date.getUTCMonth()] + " " + date.getUTCFullYear() + " " + time;
    var dateLt = date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate()) + " " + time;
    var vesting = formatWhole(state.vesting);

    setBilingual(document.getElementById("state-source-head"),
      "Now: balanceOf on Base, block " + state.block + " · " + dateEn + ". Vesting contract ",
      "Dabar: balanceOf Base tinkle, blokas " + state.block + " · " + dateLt + ". Sablier kontrakte ");
    setBilingual(document.getElementById("state-source-tail"),
      " holds " + vesting + ", counted in Founder Λ, Founder Δ and Market. Outer ring: genesis. Inner ring: now.",
      " laikoma " + vesting + " — priskirta Steigėjui Λ, Steigėjui Δ ir Apyvartai rinkoje. Išorinis žiedas — genezė, vidinis — dabar.");

    var link = document.getElementById("state-source-contract");
    if (link) {
      link.href = CONFIG.network.explorer + "/address/" + CONFIG.addresses.sablierLockup;
      link.textContent = shortAddress(CONFIG.addresses.sablierLockup);
    }
    line.hidden = false;
  }

  function load() {
    return fetch("/api/state", { headers: { "Accept": "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("state");
        return response.json();
      })
      .then(function (state) {
        if (!isValid(state)) throw new Error("state");
        renderTable(state);
        renderRing(state);
        renderSource(state);
      });
  }

  /* Load with a single retry; refresh every 60 s. Failures keep "—". */
  function loadWithRetry() {
    load().catch(function () {
      setTimeout(function () {
        load().catch(function () { /* keep placeholders */ });
      }, 3000);
    });
  }

  loadWithRetry();
  setInterval(loadWithRetry, 60000);
})();
