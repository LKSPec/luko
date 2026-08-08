/* Progressive enhancement: add LUKO to the visitor's wallet via
   wallet_watchAsset. Providers are discovered through EIP-6963 with
   window.ethereum as a legacy fallback. The site never requests accounts.
   The page is fully usable without this script. */
import { CONFIG } from "./config.js";

(function () {
  "use strict";

  var LUKO_ADDRESS = CONFIG.addresses.luko;
  var LUKO_TOKEN = {
    address: LUKO_ADDRESS,
    symbol: CONFIG.token.symbol,
    decimals: CONFIG.token.decimals,
    image: CONFIG.token.image
  };
  var BASE_CHAIN_ID = CONFIG.network.chainId;
  var BASE_CHAIN_PARAMS = {
    chainId: BASE_CHAIN_ID,
    chainName: CONFIG.network.chainName,
    nativeCurrency: CONFIG.network.nativeCurrency,
    rpcUrls: [CONFIG.network.clientRpc],
    blockExplorerUrls: [CONFIG.network.explorer]
  };

  var button = document.getElementById("add-luko");
  var dialog = document.getElementById("wallet-dialog");
  var dialogBody = document.getElementById("wallet-dialog-body");
  var closeButton = document.getElementById("wallet-dialog-close");
  if (!button || !dialog || !dialogBody || !closeButton) return;
  if (typeof dialog.showModal !== "function") return;

  /* EIP-6963 provider discovery. Announce strings are extension-controlled:
     rendered via textContent / img.src only, never innerHTML. */
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

  button.hidden = false;

  function openDialog() {
    if (!dialog.open) dialog.showModal();
  }

  function clearBody() {
    while (dialogBody.firstChild) dialogBody.removeChild(dialogBody.firstChild);
  }

  function addMessage(text) {
    var p = document.createElement("p");
    p.className = "dialog-message";
    p.textContent = text;
    dialogBody.appendChild(p);
  }

  function addContractFallback() {
    var address = document.createElement("code");
    address.className = "address";
    address.textContent = LUKO_ADDRESS;
    dialogBody.appendChild(address);

    if (navigator.clipboard) {
      var copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy-button";
      copy.textContent = "Copy";
      copy.addEventListener("click", function () {
        navigator.clipboard.writeText(LUKO_ADDRESS).then(function () {
          copy.textContent = "Copied";
          setTimeout(function () { copy.textContent = "Copy"; }, 2000);
        });
      });
      dialogBody.appendChild(copy);
    }
  }

  function showResult(text) {
    clearBody();
    addMessage(text);
    openDialog();
  }

  var DEBUG = /[?&]debug=1/.test(location.search);

  function showFallback(error) {
    clearBody();
    addMessage("Not added.");
    if (DEBUG && error) {
      addMessage("[" + String(error.code) + "] " + String(error.message || error));
    }
    addContractFallback();
    openDialog();
  }

  function showNoWallet() {
    clearBody();
    addMessage("No compatible wallet detected.");
    addContractFallback();
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      var link = document.createElement("a");
      link.className = "dialog-link";
      link.href = "https://metamask.app.link/dapp/meetluko.eu";
      link.rel = "noopener";
      link.textContent = "Open in MetaMask →";
      dialogBody.appendChild(link);
    }
    openDialog();
  }

  function showWalletChoice() {
    clearBody();
    providers.forEach(function (entry) {
      var option = document.createElement("button");
      option.type = "button";
      option.className = "wallet-option";
      if (typeof entry.info.icon === "string" && /^data:image\//.test(entry.info.icon)) {
        var icon = document.createElement("img");
        icon.src = entry.info.icon;
        icon.alt = "";
        option.appendChild(icon);
      }
      var name = document.createElement("span");
      name.textContent = String(entry.info.name || "Wallet");
      option.appendChild(name);
      option.addEventListener("click", function () {
        clearBody();
        addMessage("Waiting for wallet…");
        runAdd(entry.provider);
      });
      dialogBody.appendChild(option);
    });
    openDialog();
  }

  function addToken(provider) {
    /* network guard — remove this block (through the closing .then) to skip
       chain switching; wallet_watchAsset targets the wallet's active chain */
    return provider.request({ method: "eth_chainId" }).then(function (chainId) {
      if (chainId === BASE_CHAIN_ID) return;
      return provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_CHAIN_ID }]
      }).catch(function (error) {
        if (error && error.code === 4902) {
          return provider.request({
            method: "wallet_addEthereumChain",
            params: [BASE_CHAIN_PARAMS]
          });
        }
        throw error;
      });
    }).then(function () {
      return provider.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: LUKO_TOKEN }
      });
    });
  }

  var busy = false;

  function runAdd(provider) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    addToken(provider).then(function (added) {
      /* some wallets resolve false instead of rejecting — only truthy is a success */
      showResult(added ? "Added." : "Not added.");
    }, function (error) {
      if (error && error.code === 4001) {
        showResult("Not added.");
      } else {
        showFallback(error);
      }
    }).finally(function () {
      busy = false;
      button.disabled = false;
    });
  }

  button.addEventListener("click", function () {
    if (busy) return;
    /* re-request: catches providers injected after initial page load */
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    if (providers.length > 1) {
      showWalletChoice();
    } else if (providers.length === 1) {
      runAdd(providers[0].provider);
    } else if (window.ethereum) {
      runAdd(window.ethereum);
    } else {
      showNoWallet();
    }
  });

  closeButton.addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) dialog.close();
  });
})();
