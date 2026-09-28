// Background worker. It loads the store into a tab when asked, opens it from
// the toolbar button, and fetches product photos for the 3D shelves.
//
// Firefox runs this as a background script, Chrome as a service worker.
const ext = globalThis.browser ?? globalThis.chrome;

const FRESH_URL = "https://www.amazon.com/alm/storefront?almBrandId=QW1hem9uIEZyZXNo#supermarket";

// Everything the store needs, loaded only when someone opens it so ordinary
// Amazon pages don't pay for the 3D engine.
const STORE_FILES = [
  "src/vendor/three.min.js",
  "src/layout.js",
  "src/adapters/amazon.js",
  "src/ui.js",
  "src/walk3d.js",
  "src/fixtures.js",
];

async function loadStore(tabId, frameId = 0) {
  await ext.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: STORE_FILES });
}

ext.action.onClicked.addListener(async (tab) => {
  if (!tab.url || !tab.url.startsWith("https://www.amazon.com/")) {
    ext.tabs.create({ url: FRESH_URL });
    return;
  }
  try {
    await ext.tabs.sendMessage(tab.id, { type: "supermarket:toggle" });
  } catch {
    // The page was open before the extension was installed or updated, so
    // its content script isn't there. Reloading brings it in.
    await ext.tabs.update(tab.id, { url: tab.url.split("#")[0] + "#supermarket" });
    await ext.tabs.reload(tab.id);
  }
});

// Product photos: WebGL can only use images the page is allowed to read, and
// Amazon's image server may not allow that. Extensions aren't bound by that
// rule, so fetch the bytes here and hand them back.
const IMAGE_HOSTS = ["m.media-amazon.com", "images-na.ssl-images-amazon.com"];

async function fetchImage(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !IMAGE_HOSTS.includes(url.hostname)) throw new Error("not an Amazon image");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || sender.id !== ext.runtime.id) return;
  let job;
  if (msg.type === "supermarket:load" && sender.tab) job = loadStore(sender.tab.id, sender.frameId).then(() => ({ ok: true }));
  else if (msg.type === "supermarket:image") job = fetchImage(msg.url).then((base64) => ({ ok: true, base64 }));
  else return;
  job.catch((e) => ({ ok: false, error: String(e && e.message ? e.message : e) })).then(sendResponse);
  return true; // we answer asynchronously
});
