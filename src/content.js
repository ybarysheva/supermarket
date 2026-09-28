// Runs on every amazon.com page, so it stays tiny: it adds a "Shop like a
// supermarket" button on grocery pages and loads the store only when it's
// opened (see STORE_FILES in background.js).
(function () {
  if (window.top !== window) return; // not inside Amazon's iframes

  const ext = globalThis.browser ?? globalThis.chrome;
  const STORES = ["fresh", "wholefoods"];

  function guessStore() {
    const u = location.href.toLowerCase();
    if (u.includes("wholefoods") || u.includes("vuzhifdob2xlie")) return "wholefoods";
    if (u.includes("amazonfresh") || u.includes("qw1hem9uiezyzxno") || u.includes("/fresh")) return "fresh";
    return null;
  }

  let button = null;
  let opening = false;

  async function open() {
    if (opening || window.Supermarket?.isOpen?.()) return;
    opening = true;
    try {
      if (!window.Supermarket?.open) {
        const res = await ext.runtime.sendMessage({ type: "supermarket:load" });
        if (!res || !res.ok) throw new Error(res ? res.error : "no answer");
      }
      const S = window.Supermarket;
      // Firefox content scripts fetch as the extension, not the page, which
      // Amazon may treat as a stranger. content.fetch sends it as the page.
      if (typeof content !== "undefined" && content.fetch) S.pageFetch = content.fetch.bind(content);
      S.imageProxy = async (url) => {
        const r = await ext.runtime.sendMessage({ type: "supermarket:image", url });
        if (!r || !r.ok) throw new Error("image unavailable");
        return Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      };
      const cssText = await (await fetch(ext.runtime.getURL("src/store.css"))).text();
      if (button) button.hidden = true;
      S.open({
        stores: STORES,
        initialStore: guessStore(),
        cssText,
        onClose: () => {
          if (button) button.hidden = false;
        },
      });
    } catch (e) {
      console.error("Supermarket Mode couldn't open:", e);
    } finally {
      opening = false;
    }
  }

  if (guessStore()) {
    button = document.createElement("button");
    button.textContent = "🛒 Shop like a supermarket";
    button.style.cssText =
      "position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom, 0px));z-index:2147482000;" +
      "padding:12px 18px;border:0;border-radius:999px;background:#1f6b45;color:#fff;" +
      "font:700 16px system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer";
    button.addEventListener("click", open);
    document.body.append(button);
  }

  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "supermarket:toggle") return;
    if (window.Supermarket?.isOpen?.()) window.Supermarket.close();
    else open();
    sendResponse({ ok: true }); // tells the toolbar button we're here
  });

  if (location.hash === "#supermarket") open();
})();
