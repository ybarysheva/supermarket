// Runs on amazon.com. Adds a "Shop like a supermarket" button on grocery
// pages, and opens the store when the toolbar button is clicked.
(function () {
  const S = window.Supermarket;
  const STORES = ["fresh", "wholefoods"];

  function guessStore() {
    const u = location.href.toLowerCase();
    if (u.includes("wholefoods") || u.includes("vuzhifdob2xlie")) return "wholefoods";
    if (u.includes("amazonfresh") || u.includes("qw1hem9uiezyzxno") || u.includes("/fresh")) return "fresh";
    return null;
  }

  function open() {
    if (S.isOpen()) return;
    button && (button.hidden = true);
    S.open({
      stores: STORES,
      initialStore: guessStore(),
      cssHref: chrome.runtime.getURL("src/store.css"),
      onClose: () => button && (button.hidden = false),
    });
  }

  let button = null;
  if (guessStore()) {
    button = document.createElement("button");
    button.textContent = "🛒 Shop like a supermarket";
    button.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147482000;padding:12px 18px;border:0;border-radius:999px;" +
      "background:#1f6b45;color:#fff;font:700 16px system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer";
    button.addEventListener("click", open);
    document.body.append(button);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "supermarket:toggle") S.isOpen() ? S.close() : open();
  });

  if (location.hash === "#supermarket") open();
})();
