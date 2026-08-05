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

/* In-memory language switch. English remains the default on every page load. */
(function () {
  var language = "en";
  var options = document.querySelectorAll("[data-language]");
  if (!options.length) return;

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
  }

  options.forEach(function (option) {
    option.addEventListener("click", function () {
      setLanguage(option.dataset.language);
    });
  });

  setLanguage(language);
})();
