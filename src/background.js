// Clicking the toolbar button opens (or closes) the supermarket on the
// current Amazon tab, or takes you to Amazon Fresh if you're elsewhere.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.startsWith("https://www.amazon.com/")) {
    chrome.tabs.sendMessage(tab.id, { type: "supermarket:toggle" });
  } else {
    chrome.tabs.create({ url: "https://www.amazon.com/alm/storefront?almBrandId=QW1hem9uIEZyZXNo#supermarket" });
  }
});

// Product photos for the 3D shelves. WebGL can only use images the page may
// read, and Amazon's image server may not allow that, so fetch them here
// (extensions aren't bound by that rule) and hand back the bytes.
const IMAGE_HOSTS = ["m.media-amazon.com", "images-na.ssl-images-amazon.com"];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "supermarket:image") return;
  let url;
  try {
    url = new URL(msg.url);
  } catch {
    return;
  }
  if (url.protocol !== "https:" || !IMAGE_HOSTS.includes(url.hostname)) return;
  fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
    .then((buf) => {
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      sendResponse({ ok: true, base64: btoa(bin) });
    })
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // answer asynchronously
});
