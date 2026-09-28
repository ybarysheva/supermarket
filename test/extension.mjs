// Loads the real extension into Chromium and runs it against a fake
// amazon.com (every request to Amazon is answered here), from the button on
// the Fresh storefront through to checkout.
import { chromium } from "playwright";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { root, GL_ARGS, checker, until } from "./helpers.mjs";

// Let the extension's background worker's requests be answered here too.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const t = checker("Extension on (fake) Amazon");
const png = readFileSync(root + "icons/icon128.png");
const seen = { searches: [], posts: [], images: 0, pages: [] };

// A search results page shaped like Amazon's, with made-up products.
function resultsPage(query, index) {
  const cards = [0, 1, 2, 3, 4].map((i) => {
    const asin = `B0${Buffer.from(query).toString("hex").slice(0, 6).toUpperCase()}${i}`;
    return `
      <div data-component-type="s-search-result" data-asin="${asin}">
        <img class="s-image" src="https://m.media-amazon.com/images/I/${asin}.png">
        <h2><a href="/dp/${asin}"><span>${index === "wholefoods" ? "365 " : "Fresh "}${query} #${i + 1}</span></a></h2>
        <span class="a-price"><span class="a-offscreen">$${(2 + i).toFixed(2)}</span></span>
        <span>($0.${i + 1}0/Ounce)</span>
        ${
          // The last one is sold by weight: no Add button in search results.
          i === 4
            ? ""
            : `<form method="post" action="/cart/add-to-cart/ref=sm">
          <input type="hidden" name="anti-csrftoken-a2z" value="tok-${asin}">
          <input type="hidden" name="items[0.base][asin]" value="${asin}">
          <input type="hidden" name="items[0.base][quantity]" value="1">
        </form>`
        }
      </div>`;
  });
  return `<html><body><div class="s-main-slot">${cards.join("")}</div></body></html>`;
}

const html = (body) => ({ status: 200, contentType: "text/html", body });

const userDataDir = mkdtempSync(join(tmpdir(), "sm-ext-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium", // the full browser; the headless shell can't run extensions
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [...GL_ARGS, `--disable-extensions-except=${root}`, `--load-extension=${root}`],
});

await context.route("https://www.amazon.com/**", async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  seen.pages.push(`${req.method()} ${u.pathname}`);
  if (u.pathname === "/s") {
    seen.searches.push({ k: u.searchParams.get("k"), i: u.searchParams.get("i") });
    return route.fulfill(html(resultsPage(u.searchParams.get("k"), u.searchParams.get("i"))));
  }
  if (u.pathname.startsWith("/cart/add-to-cart")) {
    seen.posts.push(req.postData());
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  }
  if (u.pathname === "/cart/localmarket") return route.fulfill(html("<h1>Your Amazon Fresh cart</h1>"));
  return route.fulfill(html("<h1>Amazon Fresh</h1><p>Groceries delivered.</p>"));
});
// Refuse cross-site reads, as Amazon's image server may: WebGL can't use
// these photos directly, so they must come through the extension's fetcher.
// (Playwright would otherwise allow any origin.)
await context.route("https://m.media-amazon.com/**", (route) => {
  seen.images++;
  if (route.request().serviceWorker()) seen.proxied = (seen.proxied || 0) + 1;
  route.fulfill({ status: 200, contentType: "image/png", body: png, headers: { "access-control-allow-origin": "https://not-amazon.example" } });
});

// Wait for the extension's background worker.
const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
t.check("the extension loads", !!worker);

const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// An ordinary Amazon page: no button, and none of the store is loaded.
await page.goto("https://www.amazon.com/gp/css/order-history");
await page.waitForTimeout(1000);
t.check("no button on non-grocery pages", (await page.getByText("Shop like a supermarket").count()) === 0);

await page.goto("https://www.amazon.com/alm/storefront?almBrandId=QW1hem9uIEZyZXNo");
const button = page.getByText("🛒 Shop like a supermarket");
t.check("the button shows on the Fresh storefront", await until(() => button.isVisible()));
await button.click();

const host = page.locator("#supermarket-overlay-host");
t.check("the store opens", await until(() => host.count()));
t.check("its styles are applied", await until(() => page.locator(".sm-top").evaluate((el) => getComputedStyle(el).display === "flex").catch(() => false)));
t.check("you walk into the 3D store", await until(() => page.locator(".sm-walk3d canvas").count()));

// The shelves near the entrance fill from Amazon Fresh searches.
t.check("shelves are filled from Fresh searches", await until(() => seen.searches.length > 0 && seen.searches.every((s) => s.i === "amazonfresh")), seen.searches);
t.check("product photos come through the extension's photo fetcher", await until(() => seen.proxied > 0), seen);

// Ask for something, then use the flat view to click reliably.
await page.locator(".sm-ask input").fill("peanut butter");
await page.locator(".sm-ask button").click();
t.check("asking searches for that shelf", await until(() => seen.searches.some((s) => /peanut butter/.test(s.k))));
await page.waitForTimeout(3000);
await page.locator(".sm-w-tools button", { hasText: "Flat shelves" }).click();
await until(() => page.locator(".sm-grab").count());
await page.locator(".sm-grab").first().click();
await page.locator(".sm-grab").nth(1).click();
await page.locator(".sm-grab").nth(4).click(); // the sold-by-weight one
t.check("items go in the cart", (await page.locator(".sm-cart-count").textContent()) === "3");

// Checkout adds what it can, lists the one it can't, then goes to the cart.
await page.locator(".sm-cart-button").click();
await page.locator(".sm-cart .sm-primary").click();
const panel = page.locator(".sm-cart-panel");
await until(() => panel.getByText("Almost done").count());
t.check("lists the item it couldn't add", (await panel.locator(".sm-failed li").count()) === 1);
t.check("with no stray text", !/false|undefined|null/.test(await panel.textContent()), await panel.textContent());
await panel.getByRole("button", { name: "Remove" }).click();
t.check("Remove takes it out of the cart", (await page.locator(".sm-cart-count").textContent()) === "0");
await panel.getByText("Go to my Amazon Fresh cart").click();
await page.waitForURL(/\/cart\/localmarket/, { timeout: 20000 }).catch(() => {});
t.check("checkout posts each item to Amazon", seen.posts.length === 2 && seen.posts.every((b) => /anti-csrftoken-a2z=tok-/.test(b)), seen.posts);
t.check("and lands on the Fresh cart", /\/cart\/localmarket/.test(page.url()), page.url());

// The toolbar button opens it on any Amazon page.
await page.goto("https://www.amazon.com/wholefoods");
await until(() => button.isVisible());
await worker.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.tabs.sendMessage(tab.id, { type: "supermarket:toggle" });
});
t.check("the toolbar button opens it too", await until(() => host.count()));
t.check("on a Whole Foods page it opens Whole Foods", await until(() => seen.searches.some((s) => s.i === "wholefoods")));

t.check("no errors on the page", errors.length === 0, errors);
await context.close();
t.done();
