/* Current holdings, from /api/state (read live from Base by the Pages
   Function): bars under the genesis chart with what each allocation's
   wallets hold and its share of the supply, the vesting contract on its own
   line, and the source line under the table.
   Without it the bars stay hidden. */
import { CONFIG } from "./config.js?v=2";

(function () {
  "use strict";

  var ORDER = ["lambda", "delta", "market", "operations", "reserve", "other"];
  /* Percents are shares of the whole supply, so the vesting contract counts too. */
  var SHARE_ORDER = ORDER.concat(["vesting"]);
  var BAR_COLOR = {
    lambda: "#C9A86A", delta: "#9A7E4E", market: "#3B3226",
    operations: "#4E4940", reserve: "#6E6759", other: "#E8E4DC"
  };
  /* Short names for the bars, [en, lt] */
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

  /* Whole percents of the supply that add up to exactly 100 (largest
     remainder), by key. */
  function wholePercents(state) {
    var exact = SHARE_ORDER.map(function (key) { return amountOf(state, key) / state.supply * 100; });
    var whole = exact.map(Math.floor);
    var spare = 100 - whole.reduce(function (sum, value) { return sum + value; }, 0);
    exact.map(function (value, index) { return [value - whole[index], index]; })
      .sort(function (a, b) { return b[0] - a[0]; })
      .forEach(function (entry) {
        if (spare > 0) { whole[entry[1]] += 1; spare -= 1; }
      });
    var byKey = {};
    SHARE_ORDER.forEach(function (key, index) { byKey[key] = whole[index]; });
    return byKey;
  }

  /* Bars under the chart: every allocation by what its wallets hold, largest
     first, then the vesting contract on its own line. Bar lengths share one
     scale, the largest amount being full width. */
  function renderHoldings(state) {
    var box = document.getElementById("holdings");
    var list = document.getElementById("holdings-list");
    if (!box || !list) return;
    var percents = wholePercents(state);
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
      if (!row.locked) fill.style.background = BAR_COLOR[row.key];
      bar.appendChild(fill);

      var amount = document.createElement("span");
      amount.className = "holdings-amount";
      amount.textContent = formatWhole(row.amount);

      /* a holding too small to round to 1% still shows as "<1%" */
      var share = document.createElement("span");
      share.className = "holdings-share";
      share.textContent = "(" + (percents[row.key] === 0 && row.amount > 0 ? "<1" : percents[row.key]) + "%)";

      var note = document.createElement("span");
      note.className = "holdings-note";
      if (row.locked) setBilingual(note, "locked", "užrakinta");

      item.appendChild(name);
      item.appendChild(bar);
      item.appendChild(amount);
      item.appendChild(share);
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

    setBilingual(document.getElementById("state-source-head"),
      "Current holdings: balanceOf of the allocation wallets on Base, block " + state.block + " · " + dateEn + ". Vesting contract ",
      "Dabar laikoma: paskirstymo piniginių balanceOf Base tinkle, blokas " + state.block + " · " + dateLt + ". Sablier kontrakte ");
    setBilingual(document.getElementById("state-source-tail"),
      " holds another " + vesting + " LUKO, still locked.",
      " dar laikoma " + vesting + " užrakintų LUKO.");

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
        renderHoldings(state);
        renderSource(state);
      });
  }

  /* Load with a single retry; refresh every 60 s. Failures keep the bars hidden. */
  function loadWithRetry() {
    load().catch(function () {
      setTimeout(function () {
        load().catch(function () { /* keep the bars hidden */ });
      }, 3000);
    });
  }

  loadWithRetry();
  setInterval(loadWithRetry, 60000);
})();
