import { launch, root, until, store } from "./helpers.mjs";
const SP = "/tmp/claude-0/-home-user-supermarket/d4e36a14-96a4-549b-b5b0-04e7b1e03f94/scratchpad/";
const b = await launch();
const p = await b.newPage({ viewport: { width: 1200, height: 750 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errs.push(m.text()));
await p.goto("file://" + root + "playground/index.html");
const ok = await until(() => store(p, (s) => s.view === "walk"), 20000);
console.log("walk view:", ok, "errors so far:", errs.slice(0, 5));
const settle = async () => {
  await until(() => store(p, (s) => !s.walker.move), 30000);
  await until(() => store(p, (s) => !s.walker.bays.some((b) => b.state === "loading" || b.state === "queued")), 20000);
  await p.waitForTimeout(2500);
};
await p.evaluate(() => { const w = window.Supermarket.current().walker; w.hint.classList.add("fade"); });
await settle();
await p.screenshot({ path: SP + "t1-entrance.png" });
for (const [q, name] of [["apples", "t2-produce"], ["lettuce", "t3-greens"], ["ice cream", "t4-freezer"], ["salmon", "t5-seafood"], ["milk", "t6-dairy"], ["popsicles", "t7-chest"], ["cereal", "t8-aisle"], ["bread", "t9-bread"], ["muffins", "t10-case"]]) {
  await p.evaluate((q) => window.Supermarket.current().ask(q), q);
  await settle();
  await p.screenshot({ path: SP + name + ".png" });
}
await p.evaluate(() => window.Supermarket.current().goMap());
await p.waitForTimeout(500);
await p.screenshot({ path: SP + "t11-map.png", fullPage: false });
const stats = await store(p, (s) => ({ bays: s.walker.bays.length, draws: s.walker.renderer.info.render.calls, tris: s.walker.renderer.info.render.triangles, textures: s.walker.renderer.info.memory.textures }));
console.log(stats, "errors:", errs.slice(0, 8));
await b.close();
