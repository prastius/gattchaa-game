// Inside the game's Help window (?embed=1) the page drops its own header and footer,
// and links between the info pages stay inside the window.
(function () {
  if (!new URLSearchParams(location.search).has("embed")) return;
  document.body.classList.add("embedded");
  const info = /^\/(guide|rules|terms|privacy)$/;
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (info.test(href)) a.href = href + "?embed=1";
    // Anything else (the art credits, the site) opens outside the game.
    else a.target = "_blank";
  }
})();
