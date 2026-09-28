// Loads the adapters in headless Chromium and checks the Amazon page parser
// and add-to-cart request against test/amazon-fixture.html. Run: node test/run.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const fixture = readFileSync(root + "test/amazon-fixture.html", "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file://" + root + "demo.html");
await page.addScriptTag({ path: root + "src/adapters/amazon.js" });

const result = await page.evaluate(async (html) => {
  const S = window.Supermarket;
  const products = S.adapters._parseAmazonResults(html, "https://www.amazon.com");

  let captcha = false;
  try {
    S.adapters._parseAmazonResults('<form action="/errors/validateCaptcha"></form>', "https://www.amazon.com");
  } catch (e) {
    captcha = !!e.captcha;
  }

  const sent = [];
  window.fetch = async (url, opts) => (sent.push({ url: String(url), body: String(opts.body) }), new Response("ok"));
  const fresh = S.adapters.fresh();
  const added = await fresh.addToCart(products[0], 3);
  const noForm = await fresh.addToCart(products[1], 1);
  return { products, captcha, sent, added, noForm, cartUrl: fresh.cartUrl() };
}, fixture);
await browser.close();

const checks = [
  ["skips sponsored results", result.products.length === 2],
  ["reads the name", result.products[0].name === "Amazon Fresh, Creamy Peanut Butter, 16 Oz"],
  ["reads the price, not the list price", result.products[0].price === 2.49],
  ["reads the unit price", result.products[0].unitPrice === "$0.16/Ounce"],
  ["reads the image", result.products[0].image.endsWith("pb.jpg")],
  ["makes an absolute product link", result.products[0].url.startsWith("https://www.amazon.com/Creamy-Peanut-Butter/dp/")],
  ["handles a missing price", result.products[1].price === null],
  ["spots a captcha page", result.captcha],
  ["posts the add form", result.added.ok && result.sent[0].url === "https://www.amazon.com/cart/add-to-cart/ref=fresh_atc"],
  ["sends the csrf token and asin", /anti-csrftoken-a2z=tok123/.test(result.sent[0].body) && /B000PB0002/.test(result.sent[0].body)],
  ["sends the chosen quantity", result.sent[0].body.includes(encodeURIComponent("items[0.base][quantity]") + "=3")],
  ["falls back when there's no add form", !result.noForm.ok],
  ["links to the Fresh cart", result.cartUrl.includes("almBrandId=QW1hem9uIEZyZXNo")],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}
if (failed) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}
