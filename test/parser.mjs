// Checks the Amazon page parser and the add-to-cart requests against
// test/amazon-fixture.html, in headless Chromium.
import { readFileSync } from "node:fs";
import { launch, root, checker } from "./helpers.mjs";

const fixture = readFileSync(root + "test/amazon-fixture.html", "utf8");
const browser = await launch();
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
  // A saved form whose one-time token expired: the post fails, so the
  // adapter should look the product up again and post the fresh form.
  const retried = [];
  window.fetch = async (url, opts) => {
    retried.push(`${opts && opts.method ? opts.method : "GET"} ${new URL(String(url)).pathname}`);
    if (opts && opts.method === "POST") return new Response("", { status: retried.length === 1 ? 403 : 200 });
    return new Response(html);
  };
  const stale = { ...products[0], addForm: { ...products[0].addForm, fields: [["anti-csrftoken-a2z", "old"]] } };
  const refreshed = await fresh.addToCart(stale, 1);

  // Signed out: Amazon redirects to its sign-in page.
  window.fetch = async (url) => {
    const r = new Response("<html>sign in</html>");
    Object.defineProperty(r, "url", { value: "https://www.amazon.com/ap/signin?openid=x" });
    return r;
  };
  let signedOut = null;
  try {
    await fresh.search("milk sign-in check");
  } catch (e) {
    signedOut = e.message;
  }

  // Links that aren't web pages are dropped.
  const evil = S.adapters._parseAmazonResults(
    '<div data-component-type="s-search-result" data-asin="B0EVIL"><h2><a href="javascript:alert(1)//dp/">Evil</a></h2><img class="s-image" src="javascript:x"></div>',
    "https://www.amazon.com"
  )[0];

  return { products, captcha, sent, added, noForm, cartUrl: fresh.cartUrl(), retried, refreshed, signedOut, evil };
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
  ["retries an expired add form with a fresh one", result.refreshed.ok && result.retried.join(",") === "POST /cart/add-to-cart/ref=fresh_atc,GET /s,POST /cart/add-to-cart/ref=fresh_atc"],
  ["says so when you're signed out", /signed out/.test(result.signedOut || "")],
  ["drops javascript: links", result.evil.url === "https://www.amazon.com/dp/B0EVIL" && result.evil.image === null],
];
const t = checker("Amazon parser");
for (const [name, ok] of checks) t.check(name, ok);
t.done();
