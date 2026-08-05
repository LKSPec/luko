/* Progressive enhancement: copy the contract address.
   The site is fully usable without this script. */
(function () {
  var button = document.getElementById("copy-address");
  var address = document.getElementById("contract-address");
  if (!button || !address || !navigator.clipboard) return;

  button.hidden = false;
  var timer = null;

  button.addEventListener("click", function () {
    navigator.clipboard.writeText(address.textContent.trim()).then(function () {
      button.textContent = "Copied";
      clearTimeout(timer);
      timer = setTimeout(function () {
        button.textContent = "Copy";
      }, 2000);
    });
  });
})();

/* Language switch carried between pages by an explicit URL parameter. */
(function () {
  var language = new URLSearchParams(window.location.search).get("lang") === "lt" ? "lt" : "en";
  var options = document.querySelectorAll("[data-language]");
  if (!options.length) return;

  function syncLanguageLinks() {
    try {
      var currentUrl = new URL(window.location.href);
      if (language === "lt") currentUrl.searchParams.set("lang", "lt");
      else currentUrl.searchParams.delete("lang");
      window.history.replaceState(null, "", currentUrl.pathname + currentUrl.search + currentUrl.hash);

      /* Carry the language across every internal link, so any page added
         later inherits it without being listed here. In-page anchors and
         third-party links are left untouched. */
      document.querySelectorAll("a[href]").forEach(function (link) {
        var raw = link.getAttribute("href");
        if (!raw || raw.charAt(0) === "#") return;
        var url = new URL(link.href, window.location.href);
        var internal = url.hostname === window.location.hostname || url.hostname === "meetluko.eu";
        if (!internal) return;
        if (language === "lt") url.searchParams.set("lang", "lt");
        else url.searchParams.delete("lang");
        link.href = url.href;
      });
    } catch (error) { /* keep the language toggle usable if URL APIs are unavailable */ }
  }

  function setLanguage(nextLanguage) {
    language = nextLanguage === "lt" ? "lt" : "en";
    document.documentElement.lang = language;
    /* Long-form pages keep both languages as parallel blocks (.lang-en /
       .lang-lt) so inline markup survives switching; CSS shows one of them. */
    document.documentElement.setAttribute("data-lang", language);

    document.querySelectorAll("[data-en][data-lt]").forEach(function (element) {
      element.textContent = element.dataset[language];
    });

    options.forEach(function (option) {
      var isActive = option.dataset.language === language;
      option.classList.toggle("is-active", isActive);
      option.setAttribute("aria-pressed", String(isActive));
    });

    syncLanguageLinks();
  }

  options.forEach(function (option) {
    option.addEventListener("click", function () {
      setLanguage(option.dataset.language);
    });
  });

  setLanguage(language);
})();
