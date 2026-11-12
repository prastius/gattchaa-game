// Inside the game's Help window (?embed=1) the page drops its own header and footer,
// and links between the info pages stay inside the window.
(function () {
  if (!new URLSearchParams(location.search).has("embed")) return;
  document.body.classList.add("embedded");
  for (const a of document.querySelectorAll("a[href^='/info/']")) {
    a.href = a.getAttribute("href") + (a.getAttribute("href").includes("?") ? "&" : "?") + "embed=1";
  }
  // Anything else (the art credits, the site) opens outside the game.
  for (const a of document.querySelectorAll("a:not([href^='/info/'])")) a.target = "_blank";
})();
