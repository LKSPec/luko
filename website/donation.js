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

  /* Telemetry: every step of the flow goes to Sentry as a breadcrumb, and
     failures additionally as a message with the real error code/text, so a
     failed donation can be diagnosed after the fact instead of guessing. */
  function track(action, data) {
    try { if (typeof window.track === "function") window.track(action); } catch (e) { /* non-blocking */ }
    try {
      if (window.Sentry && typeof window.Sentry.addBreadcrumb === "function") {
        window.Sentry.addBreadcrumb({
          category: "donation", message: action, level: "info", data: data || {}
        });
      }
    } catch (e) { /* non-blocking */ }
  }

  function reportFailure(stage, error, extra) {
    var detail = {
      stage: stage,
      code: error && (error.code !== undefined ? String(error.code) : ""),
      message: String((error && (error.message || error.error)) || error || "")
    };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) detail[k] = extra[k];
    track("donation_failed", detail);
    try {
      if (window.Sentry && typeof window.Sentry.captureMessage === "function") {
        window.Sentry.captureMessage(
          "donation_failed:" + stage + " " + (detail.code || "") + " " + detail.message,
          { level: "error", extra: detail }
        );
      }
    } catch (e) { /* non-blocking */ }
    return detail;
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

  /* detail: {stage, code, message} from reportFailure — shown when DEBUG=1 and
     used to pick a human sentence for wallet-side failures. */
  function showError(code, detail) {
    setWide(false);
    clearBody();
    var text = ERRORS[code];
    if (!text && detail) {
      var m = (detail.message || "").toLowerCase();
      if (/insufficient funds|gas required|exceeds balance/.test(m)) {
        text = "Not enough ETH on Base to cover gas.";
      } else if (/transfer amount exceeds balance|erc20/.test(m)) {
        text = "Not enough LUKO for that amount.";
      } else if (detail.stage === "send") {
        text = "The wallet did not send the transaction.";
      } else if (detail.stage === "confirm") {
        text = "The donation is taking longer than expected to confirm. Your note can be issued later from the transaction.";
      }
    }
    body.appendChild(el("p", "dialog-message", text || "Could not issue the note."));
    if (DEBUG && detail) {
      body.appendChild(el("p", "note-hint",
        "[" + detail.stage + "] " + (detail.code ? detail.code + " " : "") + detail.message));
    }
    if (detail && detail.txHash) {
      body.appendChild(el("code", "address", detail.txHash));
    }
    var back = el("button", "copy-button", "Back");
    back.type = "button";
    back.addEventListener("click", showAmountStep);
    body.appendChild(back);
    actions.hidden = false;
    openDialog();
  }

  var DEBUG = /[?&]debug=1/.test(location.search);

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
    track("donation_started", { amount: amount, withEmail: !!email, wallets: providers.length });

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
    body.appendChild(el("p", "dialog-message",
      "A donation is signed in a wallet. No wallet was detected in this browser."));
    /* The deep link works on mobile (opens the dapp inside the wallet's own
       browser); on desktop the visitor needs an extension instead. */
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      var link = el("a", "dialog-link", "Open in MetaMask →");
      link.href = "https://metamask.app.link/dapp/meetluko.eu";
      link.rel = "noopener";
      body.appendChild(link);
    } else {
      body.appendChild(el("p", "note-hint",
        "Open meetluko.eu in a wallet browser, or install a wallet extension."));
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

    var stage = "connect";
    var sentTxHash = "";

    provider.request({ method: "eth_requestAccounts" }).then(function (accounts) {
      var from = accounts && accounts[0];
      if (!from) throw new Error("no_account");
      track("donation_connected");
      stage = "network";
      return ensureBase(provider).then(function () {
        track("donation_network_ready");
        stage = "send";
        showStatus("Confirm the transfer in your wallet…");
        var amountBig = BigInt(amount) * (10n ** 18n);
        return provider.request({
          method: "eth_sendTransaction",
          params: [{ from: from, to: LUKO_ADDRESS, data: transferData(DONATION_ADDRESS, amountBig) }]
        });
      });
    }).then(function (txHash) {
      sentTxHash = txHash;
      track("donation_sent", { txHash: txHash, amount: amount });
      stage = "confirm";
      showStatus("Waiting for confirmation on Base…");
      /* The tx needs to land in a block before the Worker can verify it.
         Poll /api/card until it stops reporting tx_not_found. */
      return issueWithRetry(txHash, email);
    }).then(function (data) {
      track("card_generated", { serial: data.serial });
      if (!email) { showNote(data, null); return; }
      showStatus("Sending your copy…");
      var png = rasterize(data.svg);
      return emailNote(data, email, png).then(function (emailed) {
        showNote(data, { email: email, emailed: emailed });
      });
    }).catch(function (error) {
      /* user cancelled in the wallet — not an error worth reporting */
      if (error && (error.code === 4001 || error.code === "ACTION_REJECTED")) {
        track("donation_cancelled");
        showAmountStep();
        return;
      }
      var detail = reportFailure(stage, error, sentTxHash ? { txHash: sentTxHash } : null);
      showError(error && (error.apiError || error.code), detail);
    }).finally(function () {
      busy = false;
      button.disabled = false;
    });
  }

  /* Ask the Worker for the note, retrying while the tx is not yet mined.
     ~90s of polling: donations on Base confirm in seconds, but a congested
     block or a slow RPC should not surface as a false failure. */
  function issueWithRetry(txHash, email) {
    var attempts = 0;
    var MAX = 30;
    function attempt() {
      attempts++;
      return fetch("/api/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* bearer personalizes the private copy (download + email); the public
           permalink shows it masked. Empty email → no bearer line. */
        body: JSON.stringify({ txHash: txHash, bearer: email || "" })
      }).then(function (response) { return response.json(); }).then(function (data) {
        if (data && data.ok) return data;
        var pending = data && (data.error === "tx_not_found" || data.error === "tx_pending");
        if (pending && attempts < MAX) {
          track("donation_awaiting_confirmation", { attempt: attempts });
          return new Promise(function (resolve) { setTimeout(resolve, 3000); }).then(attempt);
        }
        var err = new Error((data && data.error) || "issue_failed");
        err.apiError = data && data.error;
        throw err;
      });
    }
    return attempt();
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
    /* catch wallets injected after load, then decide up front: with no wallet
       there is nothing to sign with, so ask to open in one instead of making
       the visitor fill in an amount first and fail afterwards. */
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    if (!providers.length && !window.ethereum) {
      track("donation_no_wallet");
      showNoWallet();
      return;
    }
    showAmountStep();
  });

  closeButton.addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) dialog.close();
  });
})();
