// Walks through the demo store (playground/index.html) the way a person would: 3D and
// flat views, asking for things, the list, the cart and checkout, plus the
// memory and fallback behavior phones rely on.
import { launch, root, checker, until, store } from "./helpers.mjs";

const url = "file://" + root + "playground/index.html";
const browser = await launch();
const t = checker("Demo store");

async function openPage(viewport, opts = {}) {
  const page = await browser.newPage({ viewport, ...opts });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await page.goto(url);
  return page;
}

const arrived = (page) => until(() => store(page, (s) => s.walker && !s.walker.move));

// ---- desktop ----
const p = await openPage({ width: 1280, height: 800 });
t.check("starts in 3D at the entrance", await until(() => store(p, (s) => s.view === "walk" && s.walker.node.id === "entrance")));
t.check("shows where you are", /Entrance/.test(await p.locator(".sm-w-loc").textContent()));

// Watch every search the store makes: how many are waiting at once, and in
// what order they were asked for.
await p.evaluate(() => {
  const a = window.Supermarket.current().adapter;
  const orig = a.search.bind(a);
  window.searchLog = { inFlight: 0, max: 0, order: [] };
  a.search = async (q) => {
    const log = window.searchLog;
    log.order.push(q);
    log.max = Math.max(log.max, ++log.inFlight);
    try {
      return await orig(q);
    } finally {
      log.inFlight--;
    }
  };
});
t.check("a shelf waiting on the store shows it's being stocked", await until(() => store(p, (s) => s.walker.bays.some((b) => b.state === "loading" && b.placeholder))));

await p.locator(".sm-ask input").fill("peanut butter");
await p.locator(".sm-ask button").click();
await arrived(p);
t.check("asking walks you to the right shelf", /Spreads/.test(await p.locator(".sm-w-loc").textContent()));
t.check("stocks the shelves near you", await until(() => store(p, (s) => s.walker.bays.some((b) => b.section.name === "Peanut Butter & Spreads" && b.items.length > 0))));

// Pick a product up by clicking where it is on screen.
const spot = await store(p, (s) => {
  const w = s.walker;
  const bay = w.bays.find((b) => b.section.name === "Peanut Butter & Spreads");
  // The product nearest the middle of the view (long shelves run off-screen).
  const r = w.canvas.getBoundingClientRect();
  const on = bay.items
    .map((it) => ({ it, v: it.meshes[0].getWorldPosition(new window.THREE.Vector3()).project(w.camera) }))
    .sort((a, b) => Math.hypot(a.v.x, a.v.y) - Math.hypot(b.v.x, b.v.y))[0];
  return { x: r.left + ((on.v.x + 1) / 2) * r.width, y: r.top + ((1 - on.v.y) / 2) * r.height - 12, name: on.it.p.name };
});
await p.mouse.click(spot.x, spot.y);
t.check("clicking a product picks it up", (await p.locator(".sm-closeup h2").textContent().catch(() => "")) === spot.name);
await p.locator(".sm-stepper.big button[aria-label='One more']").click();
await p.locator(".sm-closeup .sm-primary").click();
t.check("puts it in the cart", (await p.locator(".sm-cart-count").textContent()) === "2");

// Keyboard: plain keys walk, browser shortcuts are left alone.
const prevented = (init) =>
  p.evaluate((init) => {
    const e = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...init });
    document.dispatchEvent(e);
    return e.defaultPrevented;
  }, init);
t.check("arrow keys turn you", await prevented({ key: "ArrowLeft" }));
t.check("Ctrl/Cmd shortcuts reach the browser", !(await prevented({ key: "d", ctrlKey: true })) && !(await prevented({ key: "w", metaKey: true })));

// Idle: once nearby shelves have finished stocking, standing still draws
// nothing. Count frames in one-second windows until one is quiet.
const frames = await p.evaluate(async () => {
  const w = window.Supermarket.current().walker;
  let n = 0;
  const orig = w.renderer.render.bind(w.renderer);
  w.renderer.render = (...a) => (n++, orig(...a));
  let last = -1;
  for (let i = 0; i < 30 && last !== 0; i++) {
    n = 0;
    await new Promise((r) => setTimeout(r, 1000));
    last = n;
  }
  w.renderer.render = orig;
  return last;
});
t.check("doesn't redraw while you stand still", frames === 0, frames);

// Flat view and back.
await p.locator(".sm-w-tools button", { hasText: "Flat shelves" }).click();
t.check("flat shelves show the same aisle", await until(() => p.locator(".sm-bay .sm-item").count()));
await p.locator(".sm-grab").first().click();
t.check("the + on a price tag adds one", (await p.locator(".sm-cart-count").textContent()) === "3");
await p.locator("button", { hasText: "Walk here in 3D" }).click();
t.check("and you can walk back in", await until(() => store(p, (s) => s.view === "walk")));

// Walking far away empties the shelves behind you, and the shelf you asked
// for is fetched before the ones you pass on the way.
// (Asked from script so "the next search" is measured from the exact moment.)
const before = await p.evaluate(() => {
  window.Supermarket.current().ask("milk");
  return window.searchLog.order.length;
});
const next = await until(() => p.evaluate((n) => window.searchLog.order[n], before));
t.check("the shelf you asked for is fetched first", next === "milk gallon", next);
await arrived(p);
const stocked = await until(() =>
  store(p, (s) => {
    const spreads = s.walker.bays.find((b) => b.section.name === "Peanut Butter & Spreads");
    return spreads.state === "empty" ? "emptied" : null;
  })
);
t.check("empties shelves you've walked away from", stocked === "emptied");

const maxWaiting = await p.evaluate(() => window.searchLog.max);
t.check("never more than two shelves wait on the store at once", maxWaiting <= 2, maxWaiting);

// Shopping list: sorted, located, ticked off by the cart.
await p.locator("button", { hasText: "📝 List" }).click();
await p.locator(".sm-list textarea").fill("eggs, bread, unicorn");
await p.locator(".sm-list-add button").click();
const where = await p.locator(".sm-list li").allTextContents();
t.check("the list is in walking order", /bread/.test(where[0]) && /eggs/.test(where[1]) && /unicorn/.test(where[2]), where);
await p.locator(".sm-list button[aria-label='Put list away']").click();

// Checkout (demo: a receipt).
await p.locator(".sm-cart-button").click();
await p.locator(".sm-cart .sm-primary").click();
t.check("checkout prints a receipt", /TOTAL/.test(await p.locator(".sm-receipt").textContent()));

// If the browser takes the 3D view away (phones do), fall back to the map.
await p.locator(".sm-cart button", { hasText: "Back to shopping" }).click();
await p.evaluate(() => window.Supermarket.current().walker.renderer.getContext().getExtension("WEBGL_lose_context").loseContext());
t.check("falls back to the map if 3D dies", await until(() => store(p, (s) => s.view === "map" && !s.use3d)));

// Leaving frees the store.
await p.locator("button", { hasText: "Leave" }).click();
t.check("leaving closes the store", !(await p.evaluate(() => window.Supermarket.isOpen())));
t.check("no errors on desktop", p.errors.length === 0, p.errors);

// ---- phone ----
const m = await openPage({ width: 390, height: 844 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
t.check("3D works on a phone-sized screen", await until(() => store(m, (s) => s.view === "walk")));
const dpr = await store(m, (s) => s.walker.renderer.getPixelRatio());
t.check("draws at a lighter resolution on phones", dpr === 1.5, dpr);
const overlap = await m.evaluate(() => {
  const root = document.querySelector("#supermarket-overlay-host").shadowRoot;
  const a = root.querySelector(".sm-w-controls").getBoundingClientRect();
  const b = root.querySelector(".sm-cart-button").getBoundingClientRect();
  return a.right > b.left && a.bottom > b.top;
});
t.check("walk controls don't cover the cart", !overlap);
await m.locator("button", { hasText: "📝 List" }).tap();
await m.locator(".sm-list textarea").fill("eggs");
await m.locator(".sm-list-add button").tap();
await m.locator(".sm-where").first().tap();
t.check("tapping a list item puts the list away", !(await m.locator(".sm-list.open").count()));
t.check("no errors on a phone", m.errors.length === 0, m.errors);

// ---- reduced motion ----
const r = await openPage({ width: 1280, height: 800 }, { reducedMotion: "reduce" });
await until(() => store(r, (s) => s.view === "walk"));
await r.locator(".sm-ask input").fill("ice cream");
await r.locator(".sm-ask button").click();
const jump = await store(r, (s) => !s.walker.move || s.walker.move.speed === Infinity);
t.check("with reduced motion you jump instead of walking", jump && (await until(() => store(r, (s) => /Dairy & Drinks/.test(s.walker.locTitle.textContent)))));

await browser.close();
t.done();
