// Clicking the toolbar button opens (or closes) the supermarket on the
// current Amazon tab, or takes you to Amazon Fresh if you're elsewhere.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.startsWith("https://www.amazon.com/")) {
    chrome.tabs.sendMessage(tab.id, { type: "supermarket:toggle" });
  } else {
    chrome.tabs.create({ url: "https://www.amazon.com/alm/storefront?almBrandId=QW1hem9uIEZyZXNo#supermarket" });
  }
});
