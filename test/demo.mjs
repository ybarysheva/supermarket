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

await p.locator(".sm-ask input").fill("peanut butter");
await p.locator(".sm-ask button").click();
await arrived(p);
t.check("asking walks you to the right shelf", /Spreads/.test(await p.locator(".sm-w-loc").textContent()));
t.check("stocks the shelves near you", await until(() => store(p, (s) => s.walker.bays.some((b) => b.section.name === "Spreads" && b.items.length > 0))));

// Pick a product up by clicking where it is on screen.
const spot = await store(p, (s) => {
  const w = s.walker;
  const bay = w.bays.find((b) => b.section.name === "Spreads");
  const v = bay.items[0].meshes[0].getWorldPosition(new window.THREE.Vector3()).project(w.camera);
  const r = w.canvas.getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, name: bay.items[0].p.name };
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

// Idle: nothing should be drawn while standing still.
const frames = await p.evaluate(async () => {
  const w = window.Supermarket.current().walker;
  // Let any turn or pending photos settle first.
  for (let i = 0; i < 40 && (w.move || w.yawTarget != null || w.dirty); i++) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 1500));
  let n = 0;
  const orig = w.renderer.render.bind(w.renderer);
  w.renderer.render = (...a) => (n++, orig(...a));
  await new Promise((r) => setTimeout(r, 1000));
  w.renderer.render = orig;
  return n;
});
t.check("doesn't redraw while you stand still", frames === 0, frames);

// Flat view and back.
await p.locator(".sm-w-tools button", { hasText: "Flat shelves" }).click();
t.check("flat shelves show the same aisle", await until(() => p.locator(".sm-bay .sm-item").count()));
await p.locator(".sm-grab").first().click();
t.check("the + on a price tag adds one", (await p.locator(".sm-cart-count").textContent()) === "3");
await p.locator("button", { hasText: "Walk here in 3D" }).click();
t.check("and you can walk back in", await until(() => store(p, (s) => s.view === "walk")));

// Walking far away empties the shelves behind you.
await p.locator(".sm-ask input").fill("milk");
await p.locator(".sm-ask button").click();
await arrived(p);
const stocked = await until(() =>
  store(p, (s) => {
    const spreads = s.walker.bays.find((b) => b.section.name === "Spreads");
    return spreads.state === "empty" ? "emptied" : null;
  })
);
t.check("empties shelves you've walked away from", stocked === "emptied");

// Shopping list: sorted, located, ticked off by the cart.
await p.locator("button", { hasText: "📝 List" }).click();
await p.locator(".sm-list textarea").fill("eggs, bread, unicorn food");
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
t.check("with reduced motion you jump instead of walking", jump && (await until(() => store(r, (s) => /Aisle 6/.test(s.walker.locTitle.textContent)))));

await browser.close();
t.done();
