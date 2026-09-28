// Checks the Amazon page parser and the add-to-cart requests against
// test/amazon-fixture.html, in headless Chromium.
import { readFileSync } from "node:fs";
import { launch, root, checker } from "./helpers.mjs";

const fixture = readFileSync(root + "test/amazon-fixture.html", "utf8");
// Product cards from a real Amazon Fresh search page (scrubbed).
const real = readFileSync(root + "test/amazon-fresh-search.html", "utf8");
const bar = readFileSync(root + "test/amazon-browse-bar.html", "utf8");
const browser = await launch();
const page = await browser.newPage();
await page.goto("file://" + root + "playground/index.html");
await page.addScriptTag({ path: root + "src/adapters/amazon.js" });

const result = await page.evaluate(async ({ html, realHtml, barHtml }) => {
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

  const realProducts = S.adapters._parseAmazonResults(realHtml, "https://www.amazon.com");

  // Categories: read the browse bar.
  const C = S.adapters._amazonCategories;
  const departments = C.parseDepartments(barHtml);
  const subs = C.parseSubcategories(barHtml, "6506977011");
  // The store's aisles, built from its categories.
  const dept = (name, node, ...subs) => ({ name, node, subs: subs.map(([n, s]) => ({ node: n, name: s })) });
  const catalog = [
    dept("Produce", "p", ["p1", "Fresh Fruit"], ["p2", "Fresh Vegetables"], ["p3", "Fresh Herbs"], ["p4", "Nuts & Seeds"], ["p5", "Dried Fruits & Vegetables"], ["p6", "Fresh Cut & Packaged"]),
    dept("Breakfast Foods", "b", ["b1", "Cereals"], ["b2", "Oatmeal & Hot Cereals"], ["b3", "Breakfast Bars"]),
    dept("Pantry Staples", "s", ...Array.from({ length: 11 }, (_, i) => [`s${i}`, i === 0 ? "Nut & Seed Butters" : `Pantry ${i}`])),
    dept("Dairy, Eggs & Cheese", "d", ["d1", "Milk & Cream"], ["d2", "Eggs"], ["d3", "Cheese"]),
    dept("Frozen Foods", "f", ["f1", "Ice Cream & Novelties"], ["f2", "Frozen Pizza"], ["f3", "Frozen Vegetables"], ["f4", "Frozen Meals"]),
    dept("Meat & Seafood", "m", ["m1", "Beef"], ["m2", "Fish & Shellfish"]),
    dept("Wine", "w", ["w1", "Red Wine"]),
    dept("Office & School", "o"),
  ];
  const L = S.buildLayout(catalog);
  S.useLayout(L);
  const shelves = L.places.flatMap((p) => p.sides.flatMap((sd) => sd.sections.map((x) => ({ place: p.id, fixture: sd.fixture, ...x }))));
  const shelf = (name) => shelves.find((x) => x.name === name) || {};
  const found = (q) => {
    const hit = S.findShelf(q)[0];
    return hit && hit.place.sides[hit.sideIndex].sections[hit.sectionIndex].name;
  };
  const refs = [...L.plan.corridors.flatMap((c) => [...c.left, ...c.right]), ...L.plan.back, ...(L.plan.chests ? L.plan.chests.sides : [])];
  const layout = {
    count: shelves.length,
    ids: new Set(shelves.map((x) => x.id)).size,
    placed: new Set(refs.map(([id, i]) => `${id}/${i}`)).size === L.places.reduce((t, p) => t + p.sides.length, 0),
    herbs: shelf("Fresh Herbs").fixture,
    fruit: shelf("Fresh Fruit").fixture,
    icecream: shelf("Ice Cream & Novelties").fixture,
    pizza: shelf("Frozen Pizza").fixture,
    milk: shelf("Milk & Cream").fixture,
    fish: shelf("Fish & Shellfish").fixture,
    wine: !!shelf("Red Wine").name,
    office: shelf("Office & School"),
    widest: Math.max(...L.places.filter((p) => p.zone === "aisle").flatMap((p) => p.sides.map((sd) => sd.sections.length))),
    order: L.places.map((p) => p.id),
    cereal: found("cereal"),
    peanut: found("peanut butter"),
  };
  const bar = (t, next) => `<div data-component-type="s-result-info-bar"><h1><span>${t}</span></h1></div>${next}`;
  const page1 = S.adapters._parseAmazonPage(bar("1-24 of over 1,000 results for", '<a class="s-pagination-next" href="?page=2">Next</a>'), "https://www.amazon.com");
  const pageLast = S.adapters._parseAmazonPage(bar("97-119 of 119 results for", '<span class="s-pagination-next s-pagination-disabled">Next</span>'), "https://www.amazon.com");
  const noNav = S.adapters._parseAmazonPage(bar("1-24 of 119 results for", ""), "https://www.amazon.com");
  const paging = { page1, pageLast, noNav };

  // A category shelf shows everything in its category.
  const card = '<div data-component-type="s-search-result" data-asin="B0NUTBUT01"><h2>Almond Butter</h2></div>';
  const asked = [];
  window.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/s") asked.push(`${u.searchParams.get("k") || ""}|${u.searchParams.get("rh") || ""}`);
    return new Response(u.pathname === "/s" && u.searchParams.get("rh") === "n:s0" ? card : "<html></html>");
  };
  const browsed = await S.adapters.fresh().searchShelf(shelf("Nut & Seed Butters"));
  const fallback = { names: browsed.products.map((p) => p.name), asked };
  return { fallback, paging, products, captcha, sent, added, noForm, cartUrl: fresh.cartUrl(), retried, refreshed, signedOut, evil, realProducts, departments, subs, layout };
}, { html: fixture, realHtml: real, barHtml: bar });
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
  ["reads how many results there are in all", result.paging.page1.total === 1000 && result.paging.pageLast.total === 119],
  ["a category shelf shows everything in its category", result.fallback.names.join() === "Almond Butter" && result.fallback.asked.join() === "|n:s0", result.fallback],
  ["knows when there's another page", result.paging.page1.more && !result.paging.pageLast.more && result.paging.noNav.more],
  ["drops javascript: links", result.evil.url === "https://www.amazon.com/dp/B0EVIL" && result.evil.image === null],
];
const rp = result.realProducts;
const m = result.layout;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
checks.push(
  ["browse bar: reads the departments", same(result.departments.map((d) => d.name), ["Produce", "Pantry Staples", "Dairy, Eggs & Cheese"]) && result.departments[1].node === "18787303011"],
  ["browse bar: reads the subcategories (not Featured)", same(result.subs.map((d) => d.name), ["Fresh Vegetables", "Fresh Fruit", "Fresh Herbs"]) && result.subs[1].node === "16318981"],
  ["store: every category gets one shelf (no alcohol)", m.count === 6 + 3 + 11 + 3 + 4 + 2 + 1 && m.ids === m.count && !m.wine, m],
  ["store: every run of shelves is placed on the floor", m.placed],
  ["store: a department with no subcategories is a shelf itself", m.office.name === "Office & School" && m.office.category.node === "o"],
  ["store: produce on tables, herbs on the misted rack", m.fruit === "table" && m.herbs === "wetrack", m],
  ["store: freezers, ice cream chests, dairy coolers, seafood counter", m.pizza === "freezer" && m.icecream === "coffin" && m.milk === "cooler" && m.fish === "counter", m],
  ["store: center aisle sides hold up to 8 shelves", m.widest <= 8, m.widest],
  ["store: produce first, cold things last", m.order[0] === "produce" && m.order[m.order.length - 1] === "dairy", m.order],
  ["store: asking finds category shelves", m.cereal === "Cereals" && m.peanut === "Nut & Seed Butters", m]
);
checks.push(
  ["real page: finds the products", rp.length >= 6],
  ["real page: every product has a name, price and photo", rp.every((p) => p.name && p.price > 0 && p.image)],
  ["real page: reads unit prices like $0.69/ounce", rp.filter((p) => /^\$[\d.]+\/[a-z]/i.test(p.unitPrice)).length >= rp.length / 2],
  ["real page: finds Fresh add-to-cart forms", rp.filter((p) => p.addForm && /\/cart\/add-to-cart\/local-market\//.test(p.addForm.action)).length >= rp.length / 2],
  ["real page: forms carry the token, product and quantity", rp.filter((p) => p.addForm).every((p) => ["anti-csrftoken-a2z", "items[0.base][asin]", "items[0.base][quantity]"].every((n) => p.addForm.fields.some(([f]) => f === n)))]
);
const t = checker("Amazon parser");
for (const [name, ok] of checks) t.check(name, ok);
t.done();
