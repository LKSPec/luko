/* Genesis donation note — client flow.
   Choose an amount → wallet sends LUKO to the donation address → the Pages
   Function verifies the tx and returns a personalized SVG note, which we show
   and offer as PNG / SVG. All signing happens in the user's wallet; this file
   never handles keys. Progressive enhancement — the site works without it. */
(function () {
  "use strict";

  var LUKO_ADDRESS = "0x4a9DA2831A691E7C4aca594CaFd58c35e0131fD1";
  /* Must match DONATION_ADDRESS in functions/api/card.js */
  var DONATION_ADDRESS = "0x7D9766F447a6B86Cf589A31db5b5535e379863E7";
  var BASE_CHAIN_ID = "0x2105";
  var BASE_CHAIN_PARAMS = {
    chainId: BASE_CHAIN_ID,
    chainName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://basescan.org"]
  };
  var PRESETS = [1000, 5000, 25000];

  var button = document.getElementById("get-card");
  var dialog = document.getElementById("card-dialog");
  var body = document.getElementById("card-dialog-body");
  var closeButton = document.getElementById("card-dialog-close");
  var actions = closeButton ? closeButton.parentNode : null;
  if (!button || !dialog || !body || !closeButton || typeof dialog.showModal !== "function") return;

  function track(action) {
    try { if (typeof window.track === "function") window.track(action); } catch (e) { /* non-blocking */ }
  }

  /* EIP-6963 discovery — same pattern as wallet.js. Announce strings are
     extension-controlled: only ever used as textContent / img.src. */
  var providers = [];
  window.addEventListener("eip6963:announceProvider", function (event) {
    var detail = event && event.detail;
    if (!detail || !detail.info || !detail.provider) return;
    for (var i = 0; i < providers.length; i++) {
      if (providers[i].info.uuid === detail.info.uuid) return;
      if (providers[i].info.rdns && providers[i].info.rdns === detail.info.rdns) return;
    }
    providers.push(detail);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  var busy = false;

  function clearBody() {
    while (body.firstChild) body.removeChild(body.firstChild);
  }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function openDialog() {
    if (!dialog.open) dialog.showModal();
  }
  function setWide(wide) {
    dialog.classList.toggle("is-wide", !!wide);
  }

  var ERRORS = {
    tx_not_found: "Donation not confirmed on-chain.",
    tx_failed: "That transaction did not succeed.",
    wrong_recipient: "Transfer went to a different address.",
    no_luko_transfer: "No LUKO transfer found in that transaction.",
    invalid_tx_hash: "Invalid transaction.",
    kv_not_bound: "Donation notes are not available yet.",
    donation_address_not_configured: "Donation notes are not available yet.",
    template_unavailable: "Note template unavailable."
  };

  function showError(code) {
    setWide(false);
    clearBody();
    body.appendChild(el("p", "dialog-message", ERRORS[code] || "Could not issue the note."));
    var back = el("button", "copy-button", "Back");
    back.type = "button";
    back.addEventListener("click", showAmountStep);
    body.appendChild(back);
    actions.hidden = false;
    openDialog();
  }

  /* Step 1 — choose an amount. */
  function showAmountStep() {
    setWide(false);
    clearBody();
    actions.hidden = false;
    body.appendChild(el("p", "dialog-message",
      "A genesis donation note is issued to the bearer upon donation. Choose an amount."));

    var input = el("input", "amount-input");
    input.type = "number";
    input.min = "1";
    input.step = "1";
    input.inputMode = "numeric";
    input.placeholder = "Amount in LUKO";

    var presetRow = el("div", "preset-row");
    PRESETS.forEach(function (value) {
      var preset = el("button", "preset-button", value.toLocaleString("en-US"));
      preset.type = "button";
      preset.addEventListener("click", function () {
        input.value = String(value);
        presetRow.querySelectorAll(".preset-button").forEach(function (b) {
          b.classList.toggle("is-active", b === preset);
        });
      });
      presetRow.appendChild(preset);
    });

    var donate = el("button", "copy-button gold-action donate-submit", "Donate");
    donate.type = "button";
    donate.addEventListener("click", function () {
      var amount = parseInt(input.value, 10);
      if (!(amount > 0)) { input.focus(); return; }
      startDonation(amount);
    });

    body.appendChild(presetRow);
    body.appendChild(input);
    body.appendChild(donate);
    openDialog();
  }

  function showStatus(text) {
    setWide(false);
    clearBody();
    actions.hidden = true;
    body.appendChild(el("p", "dialog-message", text));
    openDialog();
  }

  function pad32(hex) {
    return hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  }
  function transferData(to, amountBig) {
    return "0xa9059cbb" + pad32(to) + pad32("0x" + amountBig.toString(16));
  }

  function chosenProvider() {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    if (providers.length === 1) return providers[0].provider;
    if (providers.length === 0 && window.ethereum) return window.ethereum;
    return null; /* 0 providers, or multiple → resolved by caller */
  }

  function startDonation(amount) {
    if (busy) return;
    track("donation_started");

    if (providers.length > 1) {
      showWalletChoice(amount);
      return;
    }
    var provider = chosenProvider();
    if (!provider) { showNoWallet(); return; }
    donate(provider, amount);
  }

  function showWalletChoice(amount) {
    setWide(false);
    clearBody();
    actions.hidden = false;
    body.appendChild(el("p", "dialog-message", "Choose a wallet."));
    providers.forEach(function (entry) {
      var option = el("button", "wallet-option");
      option.type = "button";
      if (typeof entry.info.icon === "string" && /^data:image\//.test(entry.info.icon)) {
        var icon = el("img");
        icon.src = entry.info.icon;
        icon.alt = "";
        option.appendChild(icon);
      }
      option.appendChild(el("span", null, String(entry.info.name || "Wallet")));
      option.addEventListener("click", function () { donate(entry.provider, amount); });
      body.appendChild(option);
    });
    openDialog();
  }

  function showNoWallet() {
    setWide(false);
    clearBody();
    actions.hidden = false;
    body.appendChild(el("p", "dialog-message", "No compatible wallet detected."));
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      var link = el("a", "dialog-link", "Open in MetaMask →");
      link.href = "https://metamask.app.link/dapp/meetluko.eu";
      link.rel = "noopener";
      body.appendChild(link);
    }
    openDialog();
  }

  function ensureBase(provider) {
    return provider.request({ method: "eth_chainId" }).then(function (chainId) {
      if (chainId === BASE_CHAIN_ID) return;
      return provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_CHAIN_ID }]
      }).catch(function (error) {
        if (error && error.code === 4902) {
          return provider.request({ method: "wallet_addEthereumChain", params: [BASE_CHAIN_PARAMS] });
        }
        throw error;
      });
    });
  }

  function donate(provider, amount) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    showStatus("Waiting for wallet…");

    provider.request({ method: "eth_requestAccounts" }).then(function (accounts) {
      var from = accounts && accounts[0];
      if (!from) throw new Error("no_account");
      return ensureBase(provider).then(function () {
        var amountBig = BigInt(amount) * (10n ** 18n);
        return provider.request({
          method: "eth_sendTransaction",
          params: [{ from: from, to: LUKO_ADDRESS, data: transferData(DONATION_ADDRESS, amountBig) }]
        });
      });
    }).then(function (txHash) {
      showStatus("Verifying donation…");
      return fetch("/api/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: txHash })
      }).then(function (response) { return response.json(); });
    }).then(function (data) {
      if (!data || !data.ok) throw { handled: true, code: data && data.error };
      track("donation_confirmed");
      showNote(data);
    }).catch(function (error) {
      track("donation_failed");
      if (error && error.code === 4001) { showAmountStep(); return; } /* user cancelled */
      showError(error && error.code);
    }).finally(function () {
      busy = false;
      button.disabled = false;
    });
  }

  function dataUri(svg) {
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  }

  function download(href, filename) {
    var a = el("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function downloadSvg(svg, serial) {
    var url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    download(url, "luko-donation-" + serial.replace(/\s+/g, "") + ".svg");
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadPng(svg, serial, trigger) {
    var img = new Image();
    img.onload = function () {
      var scale = 2;
      var canvas = el("canvas");
      canvas.width = 900 * scale;
      canvas.height = 430 * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (blob) {
        if (!blob) { trigger.textContent = "PNG failed"; return; }
        var url = URL.createObjectURL(blob);
        download(url, "luko-donation-" + serial.replace(/\s+/g, "") + ".png");
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      }, "image/png");
    };
    img.onerror = function () { trigger.textContent = "PNG failed"; };
    img.src = dataUri(svg);
  }

  /* Final — show the note with download actions. */
  function showNote(data) {
    setWide(true);
    clearBody();
    actions.hidden = false;

    var img = el("img", "note-img");
    img.src = dataUri(data.svg);
    img.alt = "Donation note " + data.serial;
    body.appendChild(img);
    body.appendChild(el("p", "dialog-message address", data.serial));

    var row = el("div", "note-actions");
    var png = el("button", "copy-button gold-action", "Download PNG");
    png.type = "button";
    png.addEventListener("click", function () { downloadPng(data.svg, data.serial, png); });
    var svgBtn = el("button", "copy-button", "Download SVG");
    svgBtn.type = "button";
    svgBtn.addEventListener("click", function () { downloadSvg(data.svg, data.serial); });
    row.appendChild(png);
    row.appendChild(svgBtn);
    body.appendChild(row);
    openDialog();
  }

  button.addEventListener("click", function () {
    if (busy) return;
    showAmountStep();
  });

  closeButton.addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) dialog.close();
  });
})();
