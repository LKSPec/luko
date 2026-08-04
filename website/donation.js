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

    var emailInput = el("input", "amount-input");
    emailInput.type = "email";
    emailInput.autocomplete = "email";
    emailInput.placeholder = "Email for a copy (optional)";

    var donate = el("button", "copy-button gold-action donate-submit", "Donate");
    donate.type = "button";
    donate.addEventListener("click", function () {
      var amount = parseInt(input.value, 10);
      if (!(amount > 0)) { input.focus(); return; }
      var email = emailInput.value.trim();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { emailInput.focus(); return; }
      startDonation(amount, email);
    });

    body.appendChild(presetRow);
    body.appendChild(input);
    body.appendChild(emailInput);
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

  function startDonation(amount, email) {
    if (busy) return;
    track("donation_started");

    if (providers.length > 1) {
      showWalletChoice(amount, email);
      return;
    }
    var provider = chosenProvider();
    if (!provider) { showNoWallet(); return; }
    donate(provider, amount, email);
  }

  function showWalletChoice(amount, email) {
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
      option.addEventListener("click", function () { donate(entry.provider, amount, email); });
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

  function donate(provider, amount, email) {
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
        /* bearer personalizes the private copy (download + email); public
           permalink stays generic. Empty email → generic note. */
        body: JSON.stringify({ txHash: txHash, bearer: email || "" })
      }).then(function (response) { return response.json(); });
    }).then(function (data) {
      if (!data || !data.ok) throw { handled: true, code: data && data.error };
      track("card_generated");
      if (!email) { showNote(data, null); return; }
      /* rasterize once, email the copy, then show the note either way */
      showStatus("Sending your copy…");
      var png = rasterize(data.svg);
      return emailNote(data, email, png).then(function (emailed) {
        showNote(data, { email: email, emailed: emailed });
      });
    }).catch(function (error) {
      track("donation_failed");
      if (error && error.code === 4001) { showAmountStep(); return; } /* user cancelled */
      showError(error && error.code);
    }).finally(function () {
      busy = false;
      button.disabled = false;
    });
  }

  /* Rasterize the note SVG to a PNG data URL at 2× (1800×860) — crisp on
     retina and for print, small enough (~200 KB) to email and download. */
  function rasterize(svg) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var canvas = el("canvas");
        canvas.width = 1800;
        canvas.height = 860;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        try { resolve(canvas.toDataURL("image/png")); } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = dataUri(svg);
    });
  }

  function emailNote(data, email, pngPromise) {
    return Promise.resolve(pngPromise).then(function (pngDataUrl) {
      var pngBase64 = pngDataUrl ? pngDataUrl.split(",")[1] : "";
      return fetch("/api/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: data.txHash, email: email, pngBase64: pngBase64,
          serial: data.serial, nominal: data.nominal, date: data.date
        })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (res && res.emailed) track("card_emailed");
        return !!(res && res.emailed);
      }).catch(function () { return false; });
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

  function downloadPng(svg, serial, trigger) {
    rasterize(svg).then(function (pngDataUrl) {
      if (!pngDataUrl) { trigger.textContent = "PNG failed"; return; }
      track("card_downloaded_png");
      download(pngDataUrl, "luko-donation-" + serial.replace(/\s+/g, "") + ".png");
    });
  }

  function isMobile() {
    return (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || window.innerWidth < 640;
  }

  /* Final — show the note, download, and (if used) email confirmation. */
  function showNote(data, mail) {
    setWide(true);
    clearBody();
    actions.hidden = false;

    var img = el("img", "note-img");
    img.src = dataUri(data.svg);
    img.alt = "Donation note " + data.serial;
    body.appendChild(img);
    body.appendChild(el("p", "dialog-message address", data.serial));

    if (isMobile()) {
      body.appendChild(el("p", "note-hint", "Press and hold the image to save."));
    }

    var png = el("button", "copy-button gold-action note-download", "Download PNG");
    png.type = "button";
    png.addEventListener("click", function () { downloadPng(data.svg, data.serial, png); });
    body.appendChild(png);

    if (mail && mail.email) {
      body.appendChild(el("p", "note-hint",
        mail.emailed
          ? "A copy has been sent to " + mail.email + "."
          : "The note could not be emailed. Use Download PNG above."));
    }
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
