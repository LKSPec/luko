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
