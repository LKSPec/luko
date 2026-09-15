/* Current state of the genesis allocation, from /api/state (read live from
   Base by the Pages Function). Fills the "Holds now" column (LUKO on each
   allocation's wallets, nothing still in vesting), the "Other holders" row,
   the inner ring of the chart and the source line under the table.
   Without it the page keeps its "—" placeholders and an empty inner ring. */
import { CONFIG } from "./config.js?v=2";

(function () {
  "use strict";

  var ORDER = ["lambda", "delta", "market", "operations", "reserve", "other"];
  /* The inner ring also shows what the vesting contract still holds. */
  var RING_ORDER = ORDER.concat(["vesting"]);
  var NAMES = {
    lambda: "Founder Λ", delta: "Founder Δ", market: "Market",
    operations: "Operations", reserve: "Reserve", other: "Other holders",
    vesting: "Vesting contract"
  };
  var RING_RADIUS = 55;
  var CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  var SVG_NS = "http://www.w3.org/2000/svg";
  /* Label colours follow the genesis ring: dark on light segments, light on dark. */
  var LABEL_FILL = {
    lambda: "#0A0A0A", delta: "#0A0A0A", market: "#EDE7DA",
    operations: "#EDE7DA", reserve: "#0A0A0A", other: "#0A0A0A",
    vesting: "#8C8577"
  };
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

  function amountOf(state, key) {
    return key === "vesting" ? state.vesting : state.allocations[key];
  }

  function isValid(state) {
    if (!state || !(state.supply > 0) || typeof state.vesting !== "number" || !state.allocations) return false;
    return ORDER.every(function (key) { return typeof state.allocations[key] === "number"; });
  }

  /* The total is what all wallets hold together: the supply minus vesting. */
  function renderTable(state) {
    document.querySelectorAll("[data-now]").forEach(function (cell) {
      var key = cell.getAttribute("data-now");
      var value = key === "total" ? state.supply - state.vesting : state.allocations[key];
      if (typeof value === "number") cell.textContent = formatWhole(value);
    });
  }

  /* Whole percents that add up to exactly 100 (largest remainder). */
  function wholePercents(state) {
    var exact = RING_ORDER.map(function (key) { return amountOf(state, key) / state.supply * 100; });
    var whole = exact.map(Math.floor);
    var spare = 100 - whole.reduce(function (sum, value) { return sum + value; }, 0);
    exact.map(function (value, index) { return [value - whole[index], index]; })
      .sort(function (a, b) { return b[0] - a[0]; })
      .forEach(function (entry) {
        if (spare > 0) { whole[entry[1]] += 1; spare -= 1; }
      });
    return whole;
  }

  /* Inner ring: same order and starting point as the genesis ring, vesting
     last, with a percent label in the middle of every segment long enough
     to hold one. */
  function renderRing(state) {
    var start = 0;
    var parts = [];
    var percents = wholePercents(state);
    var labels = document.getElementById("ring-labels");
    if (labels) {
      while (labels.firstChild) labels.removeChild(labels.firstChild);
    }
    RING_ORDER.forEach(function (key, index) {
      var share = amountOf(state, key) / state.supply;
      var length = share * CIRCUMFERENCE;
      var circle = document.querySelector('[data-ring="' + key + '"]');
      if (circle) {
        circle.setAttribute("stroke-dasharray", length.toFixed(3) + " " + (CIRCUMFERENCE - length).toFixed(3));
        circle.setAttribute("transform", "rotate(" + (start * 360 - 90).toFixed(3) + " 100 100)");
      }
      /* "4%" needs about 12 units of arc, "21%" about 16 */
      var percent = percents[index];
      if (labels && percent > 0 && length >= (percent < 10 ? 12 : 16)) {
        var angle = (start + share / 2) * 2 * Math.PI - Math.PI / 2;
        var label = document.createElementNS(SVG_NS, "text");
        label.setAttribute("x", (100 + RING_RADIUS * Math.cos(angle)).toFixed(1));
        label.setAttribute("y", (100 + RING_RADIUS * Math.sin(angle)).toFixed(1));
        label.setAttribute("fill", LABEL_FILL[key]);
        label.textContent = percent + "%";
        labels.appendChild(label);
      }
      parts.push(NAMES[key] + " " + formatShare(share));
      start += share;
    });
    var chart = document.querySelector(".allocation-chart");
    if (chart) {
      chart.setAttribute("aria-label",
        "Genesis allocation, outer ring: Founder Λ 19%, Founder Δ 19%, Market 19%, Operations 19%, Reserve 24%. " +
        "Holds now, inner ring: " + parts.join(", ") + ".");
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
      "Holds now: balanceOf of the allocation wallets on Base, block " + state.block + " · " + dateEn + ". Vesting contract ",
      "Laiko dabar: paskirstymo piniginių balanceOf Base tinkle, blokas " + state.block + " · " + dateLt + ". Sablier kontrakte ");
    setBilingual(document.getElementById("state-source-tail"),
      " holds another " + vesting + " — the dark part of the inner ring. Outer ring: genesis. Inner ring: now.",
      " laikoma dar " + vesting + " — vidiniame žiede tamsi dalis. Išorinis žiedas — genezė, vidinis — dabar.");

    var link = document.getElementById("state-source-contract");
    if (link) {
      link.href = CONFIG.network.explorer + "/address/" + CONFIG.addresses.sablierLockup;
      link.textContent = shortAddress(CONFIG.addresses.sablierLockup);
    }
    line.hidden = false;
  }

  function load() {
    /* ?v= changes with the response format, so the edge never serves an older one */
    return fetch("/api/state?v=2", { headers: { "Accept": "application/json" } })
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
