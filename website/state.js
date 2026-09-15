/* Current state of the genesis allocation, from /api/state (read live from
   Base by the Pages Function). Fills the "Holds now" column (LUKO on each
   allocation's wallets, nothing still in vesting, with its dollar value),
   the "Other holders" row, the inner ring of the chart, the holdings bars
   under it and the source line under the table.
   Without it the page keeps its "—" placeholders and an empty inner ring. */
import { CONFIG } from "./config.js?v=2";

(function () {
  "use strict";

  var ORDER = ["lambda", "delta", "market", "operations", "reserve", "other"];
  /* Percents are shares of the whole supply, so the vesting contract counts
     too; its part of the inner ring is left empty. */
  var SHARE_ORDER = ORDER.concat(["vesting"]);
  var NAMES = {
    lambda: "Founder Λ", delta: "Founder Δ", market: "Market",
    operations: "Operations", reserve: "Reserve", other: "Other holders"
  };
  var RING_RADIUS = 55;
  var CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  var SVG_NS = "http://www.w3.org/2000/svg";
  /* Label colours follow the genesis ring: dark on light segments, light on dark. */
  var LABEL_FILL = {
    lambda: "#0A0A0A", delta: "#0A0A0A", market: "#EDE7DA",
    operations: "#EDE7DA", reserve: "#0A0A0A", other: "#0A0A0A"
  };
  var SEGMENT_COLOR = {
    lambda: "#C9A86A", delta: "#9A7E4E", market: "#3B3226",
    operations: "#4E4940", reserve: "#6E6759", other: "#E8E4DC"
  };
  /* Short names for the holdings bars, [en, lt] */
  var HOLDING_NAMES = {
    lambda: ["Founder — Λ", "Steigėjas — Λ"], delta: ["Founder — Δ", "Steigėjas — Δ"],
    market: ["Market", "Rinka"], operations: ["Operations", "Operacijos"],
    reserve: ["Reserve", "Rezervas"], other: ["Other", "Kiti"],
    vesting: ["Vesting", "Palaipsniui"]
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

  function formatUsd(cents) {
    return (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + "$";
  }

  /* LUKO in the cell, its dollar value at the pool price underneath. */
  function fillNow(key, amount, cents) {
    var cell = document.querySelector('[data-now="' + key + '"]');
    if (!cell) return;
    cell.textContent = formatWhole(amount);
    if (cents === null) return;
    var usd = document.createElement("span");
    usd.className = "now-usd";
    usd.textContent = formatUsd(cents);
    cell.appendChild(usd);
  }

  /* The total is what all wallets hold together: the supply minus vesting.
     Its dollar value is the sum of the rows, so the column adds up. */
  function renderTable(state) {
    var price = state.price > 0 ? state.price : null;
    var totalCents = 0;
    ORDER.forEach(function (key) {
      var cents = price === null ? null : Math.round(state.allocations[key] * price * 100);
      if (cents !== null) totalCents += cents;
      fillNow(key, state.allocations[key], cents);
    });
    fillNow("total", state.supply - state.vesting, price === null ? null : totalCents);
  }

  /* Whole percents of the supply, in SHARE_ORDER, that add up to exactly 100
     (largest remainder). */
  function wholePercents(state) {
    var exact = SHARE_ORDER.map(function (key) { return amountOf(state, key) / state.supply * 100; });
    var whole = exact.map(Math.floor);
    var spare = 100 - whole.reduce(function (sum, value) { return sum + value; }, 0);
    exact.map(function (value, index) { return [value - whole[index], index]; })
      .sort(function (a, b) { return b[0] - a[0]; })
      .forEach(function (entry) {
        if (spare > 0) { whole[entry[1]] += 1; spare -= 1; }
      });
    return whole;
  }

  /* Inner ring: same order and starting point as the genesis ring, with a
     percent label in the middle of every segment long enough to hold one.
     The segments cover only what the wallets hold; the rest of the ring,
     still in the vesting contract, stays empty and unlabelled. */
  function renderRing(state) {
    var start = 0;
    var parts = [];
    var percents = wholePercents(state);
    var labels = document.getElementById("ring-labels");
    if (labels) {
      while (labels.firstChild) labels.removeChild(labels.firstChild);
    }
    ORDER.forEach(function (key, index) {
      var share = amountOf(state, key) / state.supply;
      var length = share * CIRCUMFERENCE;
      var circle = document.querySelector('[data-ring="' + key + '"]');
      if (circle) {
        circle.setAttribute("stroke-dasharray", length.toFixed(3) + " " + (CIRCUMFERENCE - length).toFixed(3));
        circle.setAttribute("transform", "rotate(" + (start * 360 - 90).toFixed(3) + " 100 100)");
      }
      /* "4%" needs about 12 units of arc, "34%" about 16 */
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
        "Holds now, inner ring: " + parts.join(", ") + "; still in vesting " + formatShare(state.vesting / state.supply) + ".");
    }
  }

  /* Bars under the chart: every allocation by what its wallets hold, largest
     first, then the vesting contract on its own line. Bar lengths share one
     scale, the largest amount being full width. */
  function renderHoldings(state) {
    var box = document.getElementById("holdings");
    var list = document.getElementById("holdings-list");
    if (!box || !list) return;
    var rows = ORDER.map(function (key) { return { key: key, amount: state.allocations[key] }; })
      .sort(function (a, b) { return b.amount - a.amount; });
    rows.push({ key: "vesting", amount: state.vesting, locked: true });
    var largest = Math.max.apply(null, rows.map(function (row) { return row.amount; })) || 1;

    while (list.firstChild) list.removeChild(list.firstChild);
    rows.forEach(function (row) {
      var item = document.createElement("li");
      item.className = row.locked ? "holdings-row holdings-row-locked" : "holdings-row";

      var name = document.createElement("span");
      name.className = "holdings-name";
      setBilingual(name, HOLDING_NAMES[row.key][0], HOLDING_NAMES[row.key][1]);

      var bar = document.createElement("span");
      bar.className = "holdings-bar";
      var fill = document.createElement("span");
      fill.className = "holdings-fill";
      fill.style.width = (row.amount / largest * 100).toFixed(2) + "%";
      if (!row.locked) fill.style.background = SEGMENT_COLOR[row.key];
      bar.appendChild(fill);

      var amount = document.createElement("span");
      amount.className = "holdings-amount";
      amount.textContent = formatWhole(row.amount);

      var note = document.createElement("span");
      note.className = "holdings-note";
      if (row.locked) setBilingual(note, "locked", "užrakinta");

      item.appendChild(name);
      item.appendChild(bar);
      item.appendChild(amount);
      item.appendChild(note);
      list.appendChild(item);
    });
    box.hidden = false;
  }

  function renderSource(state) {
    var line = document.getElementById("state-source");
    if (!line) return;
    var date = new Date(state.timestamp * 1000);
    var time = pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes()) + " UTC";
    var dateEn = date.getUTCDate() + " " + MONTHS[date.getUTCMonth()] + " " + date.getUTCFullYear() + " " + time;
    var dateLt = date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate()) + " " + time;
    var vesting = formatWhole(state.vesting);
    var price = state.price > 0 ? state.price.toFixed(6) : null;

    setBilingual(document.getElementById("state-source-head"),
      "Holds now: balanceOf of the allocation wallets on Base, block " + state.block + " · " + dateEn + ". Vesting contract ",
      "Laiko dabar: paskirstymo piniginių balanceOf Base tinkle, blokas " + state.block + " · " + dateLt + ". Sablier kontrakte ");
    setBilingual(document.getElementById("state-source-tail"),
      " holds another " + vesting + " — the empty part of the inner ring." +
        (price ? " Dollars at the Aerodrome LUKO/USDC pool price, 1 LUKO = " + price + " USDC." : "") +
        " Outer ring: genesis. Inner ring: now.",
      " laikoma dar " + vesting + " — tuščia vidinio žiedo dalis." +
        (price ? " Doleriais — pagal „Aerodrome“ LUKO/USDC baseino kainą, 1 LUKO = " + price + " USDC." : "") +
        " Išorinis žiedas — genezė, vidinis — dabar.");

    var link = document.getElementById("state-source-contract");
    if (link) {
      link.href = CONFIG.network.explorer + "/address/" + CONFIG.addresses.sablierLockup;
      link.textContent = shortAddress(CONFIG.addresses.sablierLockup);
    }
    line.hidden = false;
  }

  function load() {
    /* ?v= changes with the response format, so the edge never serves an older one */
    return fetch("/api/state?v=3", { headers: { "Accept": "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("state");
        return response.json();
      })
      .then(function (state) {
        if (!isValid(state)) throw new Error("state");
        renderTable(state);
        renderRing(state);
        renderHoldings(state);
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
