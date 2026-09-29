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

// Chrome warns about Firefox-only settings, so they live in the Firefox
// build (npm run build:firefox), not in manifest.json.
const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));
t.check("manifest.json has no Firefox-only settings", !manifest.background.scripts && !manifest.browser_specific_settings);
const png = readFileSync(root + "icons/icon128.png");
const seen = { searches: [], posts: [], images: 0, pages: [], departmentPages: [] };
// What's in the (fake) Amazon cart. The first time each product is posted
// Amazon quietly drops it, like it does with an expired token.
const cart = new Set();
const dropped = new Set();

// The store front shows the browse bar with Amazon's departments; each
// department page lists its subcategories (structure copied from a real page).
const browseBar = readFileSync(root + "test/amazon-browse-bar.html", "utf8");
const SUBS = { 18787303011: [["777", "Nut & Seed Butters"], ["778", "Pasta & Noodles"]] };
const departmentPage = (node) =>
  `<html><body>${(SUBS[node] || [])
    .map(([n, name]) => `<a class="_browse-bar-widget_style_categoryNode__2uOzA" data-browse-node-id="${n}" data-node-link="/alm/category/?node=${n}"><div class="_browse-bar-widget_style_categoryFont__2zmt5">${name}</div></a>`)
    .join("")}</body></html>`;

// A search results page shaped like Amazon's, with made-up products: 8 in
// all, 5 on the first page and 3 on the second.
// Searching for a product's ASIN finds just that product.
function resultsPage(query, index, page = 1) {
  const byAsin = /^B0[0-9A-F]{7}$/.test(query);
  const cards = (byAsin ? [0] : page === 1 ? [0, 1, 2, 3, 4] : [5, 6, 7]).map((i) => {
    const asin = byAsin ? query : `B0${Buffer.from(query).toString("hex").slice(0, 6).toUpperCase()}${i}`;
    return `
      <div data-component-type="s-search-result" data-asin="${asin}">
        <img class="s-image" src="https://m.media-amazon.com/images/I/${asin}.png">
        <h2><a href="/dp/${asin}"><span>${index === "wholefoods" ? "365 " : "Fresh "}${query} #${i + 1}</span></a></h2>
        <span class="a-price"><span class="a-offscreen">$${(2 + i).toFixed(2)}</span></span>
        <span>($0.${i + 1}0/Ounce)</span>
        ${
          // The last one isn't really available: Amazon never takes it, and
          // looking it up again finds no Add button.
          byAsin && query.endsWith("4")
            ? ""
            : `<form method="post" action="/cart/add-to-cart/local-market/QW1hem9uIEZyZXNo/ref=sm">
          <input type="hidden" name="anti-csrftoken-a2z" value="tok-${asin}">
          <input type="hidden" name="items[0.base][asin]" value="${asin}">
          <input type="hidden" name="items[0.base][quantity]" value="1">
          <input name="submit.addToCart" aria-label="Add to cart" type="submit">
        </form>`
        }
      </div>`;
  });
  const bar = `<div data-component-type="s-result-info-bar"><h1><span>${page === 1 ? "1-5" : "6-8"} of 8 results for</span></h1></div>`;
  const next = page === 1 ? `<a class="s-pagination-item s-pagination-next" href="/s?k=x&page=2">Next</a>` : `<span class="s-pagination-item s-pagination-next s-pagination-disabled">Next</span>`;
  return `<html><body>${bar}<div class="s-main-slot">${cards.join("")}</div>${next}</body></html>`;
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
    const page = Number(u.searchParams.get("page") || 1);
    seen.searches.push({ k: u.searchParams.get("k"), i: u.searchParams.get("i"), rh: u.searchParams.get("rh"), page, sort: u.searchParams.get("s") });
    // Some categories list nothing when browsed directly.
    if (!u.searchParams.get("k") && u.searchParams.get("rh") === "n:778") return route.fulfill(html("<html><body></body></html>"));
    // Browsing a category (no search words): name its products after it.
    return route.fulfill(html(resultsPage(u.searchParams.get("k") || u.searchParams.get("rh"), u.searchParams.get("i"), page)));
  }
  if (u.pathname.startsWith("/cart/add-to-cart")) {
    const body = new URLSearchParams(req.postData());
    const asin = body.get("items[0.base][asin]");
    seen.posts.push(req.postData());
    if (asin.endsWith("4")) dropped.add(asin);
    else if (body.has("submit.addToCart") && (seen.posts.length > 1 || dropped.has(asin))) cart.add(asin);
    else dropped.add(asin);
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  }
  if (u.pathname === "/cart/localmarket") {
    const items = [...cart].map((a) => `<div class="sc-list-item" data-asin="${a}">${a}</div>`).join("");
    return route.fulfill(html(`<h1>Your Amazon Fresh cart</h1>${items || "<p>Your Amazon Fresh Cart is empty.</p>"}`));
  }
  if (u.pathname === "/alm/category/") {
    seen.departmentPages.push(u.searchParams.get("node"));
    return route.fulfill(html(departmentPage(u.searchParams.get("node"))));
  }
  return route.fulfill(html(`<h1>Amazon Fresh</h1><p>Groceries delivered.</p>${browseBar}`));
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
t.check("it builds the store from Amazon's departments and their pages", await until(() => seen.departmentPages.includes("18787303011") && seen.departmentPages.length >= 10), seen.departmentPages);

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
const nutButters = (s) => s.rh === "n:777" && !s.k;
t.check("asking walks to the category's shelf, which shows that category", await until(() => seen.searches.some(nutButters)), seen.searches);
t.check("category shelves come in best-seller order", seen.searches.filter(nutButters).every((s) => s.sort === "exact-aware-popularity-rank"), seen.searches.filter(nutButters));
t.check("standing at the shelf, it fetches the category's next page", await until(() => seen.searches.some((s) => nutButters(s) && s.page === 2)), seen.searches.filter(nutButters));
t.check("a category that lists nothing is searched for by name in its department", await until(() => seen.searches.some((s) => s.k === "Pasta Noodles" && s.rh === "n:18787303011")), seen.searches.filter((s) => /778|Pasta/.test(s.rh + s.k)));
t.check("each department page is read once", seen.departmentPages.filter((n) => n === "18787303011").length === 1, seen.departmentPages);
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
t.check("checkout posts each item to Amazon, with the Add button", seen.posts.length === 4 && seen.posts.every((b) => /anti-csrftoken-a2z=tok-/.test(b) && /submit\.addToCart=/.test(b)), seen.posts);
t.check("and posts again the one Amazon dropped, so both end up in the cart", cart.size === 2, [...cart]);
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
