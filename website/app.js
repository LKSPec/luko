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

      document.querySelectorAll(".lockup, .site-nav a").forEach(function (link) {
        var url = new URL(link.href, window.location.href);
        if (language === "lt") url.searchParams.set("lang", "lt");
        else url.searchParams.delete("lang");
        link.href = url.href;
      });
    } catch (error) { /* keep the language toggle usable if URL APIs are unavailable */ }
  }

  function setLanguage(nextLanguage) {
    language = nextLanguage === "lt" ? "lt" : "en";
    document.documentElement.lang = language;

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
