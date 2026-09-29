// Walk through the store in 3D, Street View style: drag to look around,
// click the arrows on the floor (or anywhere on the floor) to walk there, and
// click a product on the shelf to pick it up.
//
// The building is generated from the floor plan in layout.js. Shelves are
// stocked lazily with real search results as you walk up to them.
(function () {
  const S = (window.Supermarket = window.Supermarket || {});
  const THREE = window.THREE;

  // Store dimensions, in meters. The floor plan itself is in layout.js and
  // the fixtures (shelving, coolers, produce tables…) in fixtures.js.
  const W = 2.4; // aisle width (walkway between two fixtures)
  const W_WIDE = 3.0; // produce lanes are roomier
  const SPINE = 0.06; // between two fixtures standing back to back
  const Z0 = 8; // where the aisles start, measured from the front wall
  const L = 24; // aisle length
  const STEP = 1.5; // distance between standing spots inside an aisle
  const EYE = 1.6;
  const CEILING = 4.8;
  const TAG_H = 0.08;
  const PX_PER_M = 700; // price tag text resolution
  const STOCK_RADIUS = 10; // stock shelves within this distance…
  const UNSTOCK_RADIUS = 24; // …and empty them again past this one, to save memory
  const MAX_STOCKING = 2; // shelf requests queued at once (the store lets two out at a time)
  const SLOT = 0.2; // shelf space per product, as in a real store
  const MAX_BAY = 3.2; // longest stretch of fixture per bay of a category

  // Where each product goes on a bay: `perRow` slots on each of `R` rows
  // (eye level first). Like a real store, the shelf carries the category's
  // best sellers, as many as fit.
  //
  // Products marked with a sub-category (`group`) get a section of their
  // own, a few columns wide, in the store's order; the rest go last.
  // Packaged goods stand in brand blocks: each brand fills columns from eye
  // level up and down, so it reads as a strip of the shelf with its best
  // sellers at eye level. Loose produce (crates) fills row by row.
  // Returns { spots: [{ p, r, col }], labels: [{ name, col0, cols }] }.
  function planShelf(products, perRow, R, crates) {
    const groups = new Map();
    for (const p of products) {
      const key = p.group || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    // Sections holding more of the category's best sellers come first (and
    // get the room when the shelf is short); the rest go last.
    const top = (name) => groups.get(name).filter((p) => p.rank != null).length;
    const list = [...groups.keys()]
      .sort((a, b) => (a === "") - (b === "") || top(b) - top(a) || groups.get(b).length - groups.get(a).length)
      .map((name) => ({ name, items: groups.get(name) }));
    const spots = [];
    const labels = [];
    const order = (items) => (crates ? items : S.byBrand(items));
    if (list.length === 1) {
      const top = order(products.slice(0, perRow * R));
      if (crates) top.forEach((p, i) => spots.push({ p, r: Math.floor(i / perRow), col: i % perRow }));
      else top.forEach((p, i) => spots.push({ p, r: i % R, col: Math.floor(i / R) }));
      return { spots, labels };
    }
    // Columns for each section: what it needs, up to a fair share so no
    // one section (Avocados) takes over the display; one each first when
    // the shelf is short. Spare columns stay empty, with room for more.
    // Every section is at least MIN wide (60 cm of shelf, two crates) so it
    // reads as a section with its sign; a short shelf carries fewer.
    const MIN = crates ? 2 : 3;
    const fair = Math.max(MIN, Math.ceil((perRow * 2) / list.length));
    const need = list.map((g) => Math.max(MIN, Math.min(fair, Math.ceil(g.items.length / R))));
    const got = list.map(() => 0);
    let left = perRow;
    for (let i = 0; i < list.length && left >= MIN; i++, left -= MIN) got[i] = MIN;
    while (left > 0) {
      let best = -1;
      for (let i = 0; i < list.length; i++) if (got[i] && got[i] < need[i] && (best < 0 || need[i] - got[i] > need[best] - got[best])) best = i;
      if (best < 0) break;
      got[best]++;
      left--;
    }
    let col0 = 0;
    list.forEach((g, i) => {
      if (!got[i]) return;
      order(g.items.slice(0, got[i] * R)).forEach((p, k) => spots.push({ p, r: k % R, col: col0 + Math.floor(k / R) }));
      if (g.name) labels.push({ name: g.name, col0, cols: got[i] });
      col0 += got[i];
    });
    return { spots, labels };
  }
  const CRATE_SLOT = 0.3; // per crate of loose produce

  const C = {
    floorA: "#f2f2ed",
    floorB: "#e2e4dd",
    wall: 0xf4efe4,
    ceiling: 0xf7f7f3,
    light: 0xffffff,
    panel: 0xe4e7e9,
    board: 0xc3c9ce,
    wood: 0xb98a5c,
    kick: 0x6f777d,
    upright: 0x9aa2a8,
    endcap: 0xd3d8dc,
    sign: "#1f6b45",
    cold: "#1f5a8a",
    accent: 0xe2462f,
    checkout: 0x33413b,
    cardboard: 0xc9a46b,
  };

  const supported = () => {
    if (!THREE) return false;
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  };

  // ---- small helpers ------------------------------------------------------

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

  let unitBox = null;
  const matCache = new Map();

  function lambert(color) {
    if (!matCache.has(color)) {
      const m = new THREE.MeshLambertMaterial({ color });
      m.userData.shared = true; // used all over the store; freed with the store
      matCache.set(color, m);
    }
    return matCache.get(color);
  }

  function block(parent, color, w, h, d, x, y, z, list) {
    const m = new THREE.Mesh(unitBox, typeof color === "number" ? lambert(color) : color);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    parent.add(m);
    if (list) list.push(m);
    return m;
  }

  function canvasTexture(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  // Shrink the font until the text fits, then fall back to an ellipsis.
  function fit(g, text, maxW, size, weight = 700, min = 10) {
    for (let s = size; s >= min; s--) {
      g.font = `${weight} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      if (g.measureText(text).width <= maxW) return text;
    }
    let t = text;
    while (t.length > 1 && g.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  }

  // Amazon's photo service scales on request: a shelf texture is 256 px,
  // so ask for that, as compressed WebP (several times smaller than the
  // search page's 320 px JPEG). The close-up keeps the original.
  const shelfPhoto = (url) => (/^https:\/\/m\.media-amazon\.com\/images\//.test(url) ? url.replace(/\._[A-Za-z0-9_,]+_\.(jpg|jpeg|png)$/i, "._AC_UL256_FMwebp_QL65_.jpg") : url);

  // "$0.21/Ounce" → "$0.21/oz", as a shelf tag would print it.
  const UNITS = [[/fl(uid)?\.? ?ounces?/i, "fl oz"], [/ounces?/i, "oz"], [/pounds?/i, "lb"], [/count/i, "ct"], [/each/i, "ea"], [/kilograms?/i, "kg"], [/\bgrams?/i, "g"], [/liters?|litres?/i, "L"], [/gallons?/i, "gal"], [/quarts?/i, "qt"], [/pints?/i, "pt"], [/sheets?/i, "sheet"]];
  const shortUnit = (u) => UNITS.reduce((t, [re, abbr]) => t.replace(re, abbr), u).replace(/\s*\/\s*/, "/").trim();

  function signTexture(lines, bg, w = 1024, h = 192) {
    return canvasTexture(w, h, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#fff";
      g.textAlign = "center";
      g.textBaseline = "middle";
      if (lines.length === 1) {
        g.fillText(fit(g, lines[0], w * 0.9, h * 0.5, 800), w / 2, h / 2 + 4);
      } else {
        g.fillText(fit(g, lines[0], w * 0.9, h * 0.34, 800), w / 2, h * 0.34);
        g.globalAlpha = 0.85;
        g.fillText(fit(g, lines[1], w * 0.9, h * 0.22, 600), w / 2, h * 0.72);
      }
    });
  }

  function plane(tex, w, h, basic = true) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      basic ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : new THREE.MeshLambertMaterial({ map: tex })
    );
    return m;
  }

  // ---- product pictures ---------------------------------------------------
  //
  // WebGL can only use images the page is allowed to read. Amazon's image
  // server may not allow that, so the extension can provide S.imageProxy
  // (fetches the bytes through the background worker) as a fallback.

  let imgActive = 0;
  const imgWaiting = [];
  function limited(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        imgActive++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            imgActive--;
            if (imgWaiting.length) imgWaiting.shift()();
          });
      };
      if (imgActive < 6) run();
      else imgWaiting.push(run);
    });
  }

  function loadImg(src, cors) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (cors) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image failed"));
      img.src = src;
    });
  }

  function toCanvas(source, iw, ih) {
    const aspect = iw && ih ? ih / iw : 1;
    // Always 256×256 (textures that repeat, like produce piles, need a
    // power-of-two size); `aspect` restores the shape on packages.
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(source, 0, 0, c.width, c.height);
    return { canvas: c, aspect };
  }

  async function loadImageCanvas(url) {
    if (url.startsWith("data:")) {
      const img = await loadImg(url);
      return toCanvas(img, img.naturalWidth, img.naturalHeight);
    }
    try {
      const img = await loadImg(url, true);
      const r = toCanvas(img, img.naturalWidth, img.naturalHeight);
      r.canvas.getContext("2d").getImageData(0, 0, 1, 1); // throws if unreadable
      return r;
    } catch (e) {
      if (!S.imageProxy) throw e;
      const bytes = await S.imageProxy(url);
      const bmp = await createImageBitmap(new Blob([bytes]));
      return toCanvas(bmp, bmp.width, bmp.height);
    }
  }

  // Product photos are shared by every facing that shows them and counted,
  // so a photo's GPU memory is freed once no stocked shelf uses it.
  const texCache = new Map(); // url -> { promise, refs }

  function acquireTexture(url) {
    let entry = texCache.get(url);
    if (!entry) {
      entry = {
        refs: 0,
        promise: limited(() => loadImageCanvas(url)).then(({ canvas, aspect }) => {
          const t = new THREE.CanvasTexture(canvas);
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
          t.wrapS = t.wrapT = THREE.RepeatWrapping; // produce piles tile it
          return { texture: t, aspect };
        }),
      };
      entry.promise.catch(() => texCache.delete(url));
      texCache.set(url, entry);
    }
    entry.refs++;
    return entry.promise;
  }

  function releaseTexture(url) {
    const entry = texCache.get(url);
    if (!entry || --entry.refs > 0) return;
    texCache.delete(url);
    entry.promise.then(({ texture }) => texture.dispose(), () => {});
  }

  function releaseAllTextures() {
    for (const [url, entry] of texCache) {
      texCache.delete(url);
      entry.promise.then(({ texture }) => texture.dispose(), () => {});
    }
  }

  // Frees everything under an object that the GPU holds on to.
  function disposeTree(root, keep) {
    root.traverse((o) => {
      if (o.geometry && o.geometry !== keep && !o.geometry.userData.shared) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (m.userData.shared) continue;
        if (m.map && !m.map.userData.shared) m.map.dispose();
        m.dispose();
      }
    });
  }

  function labelTexture(name) {
    return canvasTexture(256, 320, (g, w, h) => {
      g.fillStyle = "#fff";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#1d2320";
      g.textAlign = "center";
      const words = name.split(" ");
      let line = "";
      let y = 90;
      g.font = "700 30px system-ui, sans-serif";
      for (const word of words) {
        if (g.measureText(line + word).width > w - 30 && line) {
          g.fillText(line.trim(), w / 2, y);
          line = "";
          y += 38;
        }
        line += word + " ";
      }
      g.fillText(line.trim(), w / 2, y);
    });
  }

  // ---- the walk-through -----------------------------------------------------

  class Walk3D {
    constructor(store) {
      this.store = store;
      const h = S.h;
      unitBox = unitBox || new THREE.BoxGeometry(1, 1, 1);

      const coarse = window.matchMedia("(pointer: coarse)").matches;
      this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: coarse ? "low-power" : "default" });
      // Phones have very dense screens; 1.5× looks the same and draws far less.
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0xeef0ec);
      this.scene.fog = new THREE.Fog(0xeef0ec, 14, 42);
      this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 90);
      this.raycaster = new THREE.Raycaster();

      this.pickables = new Set(); // things you can click
      this.solids = []; // things that block clicks (shelves, walls)
      this.arrows = [];
      this.bays = [];
      this.nodes = new Map();

      this.build();

      this.node = this.nodes.get("entrance");
      this.pos = { x: this.node.x, z: this.node.z };
      this.yaw = 0;
      this.pitch = -0.08;
      this.yawTarget = null;
      this.move = null;

      // HUD
      this.el = h("div", { class: "sm-walk3d" });
      this.canvas = this.renderer.domElement;
      this.canvas.className = "sm-w-canvas";
      this.onContextLost = (e) => {
        e.preventDefault();
        if (!this.destroyed) this.store.fallBackToFlat("graphics context lost");
      };
      this.canvas.addEventListener("webglcontextlost", this.onContextLost);
      this.locTitle = h("strong");
      this.locSides = h("div", { class: "sm-w-sides" });
      this.tooltip = h("div", { class: "sm-w-tip", hidden: true });
      this.minimap = h("canvas", { class: "sm-w-minimap", title: "Open the store map" });
      this.minimap.addEventListener("click", () => this.store.goMap());
      this.hint = h("div", { class: "sm-w-hint" }, "Drag to look around · click the floor or the arrows to walk · click a product to pick it up · scroll to zoom");

      const ctl = (label, title, fn) => h("button", { title, "aria-label": title, onclick: fn }, label);
      this.el.append(
        this.canvas,
        h("div", { class: "sm-w-loc" }, this.locTitle, this.locSides),
        this.minimap,
        h("div", { class: "sm-w-controls" },
          ctl("↺", "Turn left", () => this.turn(-1)),
          ctl("▲", "Walk forward", () => this.step(1)),
          ctl("▼", "Walk back", () => this.step(-1)),
          ctl("↻", "Turn right", () => this.turn(1))
        ),
        h("div", { class: "sm-w-tools" },
          h("button", { onclick: () => this.store.goMap() }, "🗺️ Map"),
          h("button", { onclick: () => this.openFlat() }, "▦ Flat shelves")
        ),
        this.hint,
        this.tooltip
      );

      this.bindInput();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.el);
      this.showArrows();
      this.updateHud();
      setTimeout(() => this.hint.classList.add("fade"), 7000);
    }

    // ---- building the store ------------------------------------------------

    build() {
      const plan = S.LAYOUT.plan;
      const FX = S.FIXTURES;
      this.setupApi();

      // A run of fixtures: the sections of the listed [place, side]s, in order.
      const run = (list) => {
        const entries = [];
        for (const [pid, si] of list) {
          const place = S.place(pid);
          const side = place.sides[si];
          side.sections.forEach((section, sectionIndex) =>
            entries.push({
              place,
              sideIndex: si,
              sectionIndex,
              section,
              fixtureName: side.fixture,
              fixture: FX[side.fixture],
              bays: section.bays || 1,
              cold: !!(place.cold || FX[side.fixture].cold),
              ice: /seafood/i.test(side.label),
            })
          );
        }
        // An empty run is a bare wall.
        if (!entries.length) return { entries, depth: 0.1, height: 0 };
        return { entries, depth: Math.max(...entries.map((e) => e.fixture.depth)), height: Math.max(...entries.map((e) => e.fixture.height)) };
      };

      // Corridors run from the left wall (x = 0) toward the right (−x).
      // Walking into the store you face +z, so your left is +x.
      let x = 0;
      this.corridors = plan.corridors.map((c, k) => {
        const left = run(c.left);
        const right = run(c.right);
        const w = c.wide ? W_WIDE : W;
        const leftBack = x;
        const cx = leftBack - left.depth - w / 2;
        const rightBack = cx - w / 2 - right.depth;
        x = rightBack - SPINE;
        const place = c.place ? S.place(c.place) : null;
        const labels = [...new Set([...c.left, ...c.right].map(([pid, si]) => S.place(pid).sides[si].label))];
        return {
          k,
          x: cx,
          w,
          left,
          right,
          leftBack,
          rightBack,
          place,
          label: place ? place.label : c.label,
          number: place ? place.number : null,
          icon: (c.left[0] && S.place(c.left[0][0]).sign) || "🛒",
          cold: !!(place && place.cold),
          sub: labels.join(" · "),
        };
      });
      const lastC = this.corridors[this.corridors.length - 1];
      this.xMax = 0.05;
      this.xMin = lastC.rightBack - 0.05;
      this.cx = (this.xMax + this.xMin) / 2;
      this.frontLane = Z0 - 1.5;
      this.backLane = Z0 + L + 1.6;
      const back = run(plan.back);
      this.zBackWall = this.backLane + 1.3 + back.depth;
      this.zMin = -0.05;
      this.zMax = this.zBackWall + 0.05;
      const width = this.xMax - this.xMin;
      const depth = this.zMax - this.zMin;
      const zMid = (this.zMax + this.zMin) / 2;

      // Lights.
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d4c8, 1.9));
      const sun = new THREE.DirectionalLight(0xffffff, 0.9);
      sun.position.set(-4, 10, 3);
      this.scene.add(sun);

      // Floor: big square tiles.
      const tiles = canvasTexture(256, 256, (g) => {
        g.fillStyle = C.floorA;
        g.fillRect(0, 0, 256, 256);
        g.fillStyle = C.floorB;
        g.fillRect(0, 0, 128, 128);
        g.fillRect(128, 128, 128, 128);
        g.strokeStyle = "rgba(0,0,0,0.06)";
        g.strokeRect(0, 0, 256, 256);
      });
      tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
      tiles.repeat.set(width / 1.2, depth / 1.2);
      this.floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshLambertMaterial({ map: tiles }));
      this.floor.rotation.x = -Math.PI / 2;
      this.floor.position.set(this.cx, 0, zMid);
      this.floor.userData.floor = true;
      this.scene.add(this.floor);

      // Ceiling, light panels over the aisles and lanes, walls.
      const A = this.api;
      A.block(this.scene, C.ceiling, width, 0.05, depth, this.cx, CEILING, zMid);
      for (const c of this.corridors) {
        for (let z = Z0; z < Z0 + L; z += 3) A.block(this.scene, 0xffffff, 0.35, 0.03, 2.2, c.x, CEILING - 0.04, z + 1.5, false, true);
      }
      for (let xx = this.xMax - 3; xx > this.xMin + 1; xx -= 4) {
        A.block(this.scene, 0xffffff, 2.2, 0.03, 0.35, xx, CEILING - 0.04, this.frontLane, false, true);
        A.block(this.scene, 0xffffff, 2.2, 0.03, 0.35, xx, CEILING - 0.04, this.backLane, false, true);
      }
      A.block(this.scene, C.wall, 0.1, CEILING, depth, this.xMax + 0.05, CEILING / 2, zMid, true);
      A.block(this.scene, C.wall, 0.1, CEILING, depth, this.xMin - 0.05, CEILING / 2, zMid, true);
      A.block(this.scene, C.wall, width, CEILING, 0.1, this.cx, CEILING / 2, this.zMax + 0.05, true);
      A.block(this.scene, C.wall, width, CEILING, 0.1, this.cx, CEILING / 2, this.zMin - 0.05, true);

      // Fixtures along each corridor, front to back.
      const alongZ = (face, originX, theta, corridor, faceSide) => {
        if (!face.entries.length) return; // nothing on this side
        // A section is at most MAX_BAY long; a short run leaves the rest of
        // the aisle open rather than stretching a category down all of it.
        const total = face.entries.reduce((t, e) => t + e.bays, 0);
        const unit = Math.min(L / total, MAX_BAY);
        let z = Z0;
        for (const e of face.entries) {
          const w = e.bays * unit;
          this.buildBay(e, originX, z + w / 2, theta, w, unit, corridor, faceSide);
          z += w;
        }
      };
      this.corridors.forEach((c, k) => {
        alongZ(c.left, c.leftBack, -Math.PI / 2, k, "left");
        alongZ(c.right, c.rightBack, Math.PI / 2, k, "right");
        this.hangingSign(c);
      });

      // Ends of the runs between corridors.
      for (let k = 0; k < this.corridors.length - 1; k++) {
        const a = this.corridors[k];
        const b = this.corridors[k + 1];
        const xa = a.x - a.w / 2;
        const xb = b.x + b.w / 2;
        const h = Math.min(Math.max(a.right.height, b.left.height), 2.05);
        for (const z of [Z0 - 0.03, Z0 + L + 0.03]) A.block(this.scene, C.endcap, xa - xb, h, 0.06, (xa + xb) / 2, h / 2, z, true);
        A.block(this.scene, C.accent, xa - xb + 0.01, 0.12, 0.07, (xa + xb) / 2, h - 0.1, Z0 - 0.04);
      }

      // Back wall, left to right as you face it.
      if (back.entries.length) {
        const total = back.entries.reduce((t, e) => t + e.bays, 0);
        const unit = width / total;
        let xx = this.xMax;
        for (const e of back.entries) {
          const w = e.bays * unit;
          this.buildBay(e, xx - w / 2, this.zBackWall, Math.PI, w, unit, null, "back");
          xx -= w;
        }
      }

      // Chest freezers in the wide front aisle.
      if (plan.chests) {
        const chest = run(plan.chests.sides);
        const c = this.corridors[plan.chests.corridor];
        const unit = 1.2;
        const total = chest.entries.reduce((t, e) => t + e.bays, 0) * unit;
        let xx = c.x + total / 2;
        for (const e of chest.entries) {
          const w = e.bays * unit;
          this.buildBay(e, xx - w / 2, Z0 - 3.5, 0, w, unit, null, "chest");
          xx -= w;
        }
      }

      this.departmentSigns();
      this.buildFront();
      this.finishStatics();
      this.buildNodes();
    }

    // Structure that never changes (shelving, walls, lights) is collected
    // here and drawn as one batch per colour, instead of thousands of
    // separate pieces; that keeps a full-size store smooth on phones.
    setupApi() {
      this.statics = new Map();
      this.glassMats = new Map();
      this.api = {
        block: (g, color, w, h, d, x, y, z, solid = false, glow = false) => {
          const o = new THREE.Object3D();
          o.scale.set(w, h, d);
          o.position.set(x, y, z);
          g.add(o);
          const key = `${glow ? "glow" : color}|${solid ? 1 : 0}`;
          let entry = this.statics.get(key);
          if (!entry) this.statics.set(key, (entry = { color, glow, solid, parts: [] }));
          entry.parts.push(o);
        },
        glass: (g, w, h, x, y, z, color, opacity, rotX = 0) => {
          const key = `${color}|${opacity}`;
          let mat = this.glassMats.get(key);
          if (!mat) {
            mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
            mat.userData.shared = true;
            this.glassMats.set(key, mat);
          }
          const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
          m.position.set(x, y, z);
          m.rotation.x = rotX;
          m.renderOrder = 1;
          g.add(m);
        },
      };
    }

    finishStatics() {
      this.scene.updateMatrixWorld(true);
      const glow = new THREE.MeshBasicMaterial({ color: C.light });
      glow.userData.shared = true;
      this.glowMat = glow;
      for (const { color, glow: isGlow, solid, parts } of this.statics.values()) {
        const im = new THREE.InstancedMesh(unitBox, isGlow ? glow : lambert(color), parts.length);
        parts.forEach((o, i) => {
          im.setMatrixAt(i, o.matrixWorld);
          o.parent.remove(o);
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        this.scene.add(im);
        if (solid) this.solids.push(im);
      }
      this.statics = null;
    }

    buildBay(e, x, z, theta, w, unit, corridor, faceSide) {
      const f = e.fixture;
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = theta;
      this.scene.add(g);
      f.build(this.api, g, w, unit, { ice: e.ice });

      const signMat = new THREE.MeshBasicMaterial({ map: signTexture([e.section.name.toUpperCase()], e.cold ? C.cold : C.sign, 384, 64), toneMapped: false });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w * 0.9, 1.8), 0.24), signMat);
      sign.position.set(0, f.sign.y, f.sign.z);
      g.add(sign);

      // Where to stand to look at it: the point just in front of the bay.
      const front = new THREE.Vector3(0, 0, f.depth + 0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), theta);
      this.bays.push({
        place: e.place,
        sideIndex: e.sideIndex,
        sectionIndex: e.sectionIndex,
        section: e.section,
        fixture: f,
        fixtureName: e.fixtureName,
        group: g,
        w,
        x,
        z,
        fx: x + front.x,
        fz: z + front.z,
        corridor,
        faceSide,
        signMat,
        state: "empty",
        items: [],
      });
    }

    hangingSign(c) {
      const tex = canvasTexture(768, 256, (g, w, h) => {
        g.fillStyle = c.cold ? C.cold : C.sign;
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#fff";
        g.textBaseline = "middle";
        const parts = c.sub.split(" · ");
        let left = 40;
        if (c.number || c.icon) {
          g.fillStyle = "rgba(0,0,0,0.18)";
          g.fillRect(0, 0, 220, h);
          g.fillStyle = "#fff";
          g.textAlign = "center";
          g.font = c.number && /\d/.test(c.number) ? "900 150px system-ui, sans-serif" : "110px system-ui, sans-serif";
          g.fillText(c.number || c.icon, 110, h / 2 + 8);
          left = 250;
        }
        g.textAlign = "left";
        const lines = c.number && /\d/.test(c.number) ? parts : [c.label, ...parts.filter((p) => p !== c.label)].slice(0, 3);
        const lh = h / (lines.length + 1);
        lines.forEach((p, i) => g.fillText(fit(g, p, w - left - 20, 52, 800, 20), left, lh * (i + 1) + 4));
      });
      // Two single-sided faces so it reads correctly from both ends.
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      for (const rot of [Math.PI, 0]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.63), mat);
        m.position.set(c.x, 3.25, Z0 + 0.6 + (rot ? -0.01 : 0.01));
        m.rotation.y = rot;
        this.scene.add(m);
      }
      for (const dx of [-0.8, 0.8]) this.api.block(this.scene, 0x888888, 0.01, CEILING - 3.56, 0.01, c.x + dx, (CEILING + 3.56) / 2, Z0 + 0.6);
    }

    // Big department names high on the walls, over each department's run.
    departmentSigns() {
      const walls = [
        { bays: this.bays.filter((b) => b.corridor === 0 && b.faceSide === "left"), axis: "z", at: this.xMax - 0.02, rot: -Math.PI / 2 },
        { bays: this.bays.filter((b) => b.corridor === this.corridors.length - 1 && b.faceSide === "right"), axis: "z", at: this.xMin + 0.02, rot: Math.PI / 2 },
        { bays: this.bays.filter((b) => b.faceSide === "back"), axis: "x", at: this.zMax - 0.07, rot: Math.PI },
      ];
      for (const wall of walls) {
        const groups = [];
        for (const b of wall.bays) {
          const last = groups[groups.length - 1];
          if (last && last.place === b.place) last.bays.push(b);
          else groups.push({ place: b.place, bays: [b] });
        }
        for (const { place, bays } of groups) {
          const lo = Math.min(...bays.map((b) => b[wall.axis] - b.w / 2));
          const hi = Math.max(...bays.map((b) => b[wall.axis] + b.w / 2));
          const len = Math.min(hi - lo - 0.4, 6);
          const m = plane(signTexture([place.label.toUpperCase()], place.cold ? C.cold : C.sign, 1024, 180), len, len * 0.176);
          if (wall.axis === "z") m.position.set(wall.at, 3.55, (lo + hi) / 2);
          else m.position.set((lo + hi) / 2, 3.55, wall.at);
          m.rotation.y = wall.rot;
          this.scene.add(m);
        }
      }
    }

    buildFront() {
      // Checkout lanes on the left, the entrance on the right by produce.
      this.checkouts = [];
      for (let j = 0; j < 4; j++) {
        const x = this.xMax - 3.5 - j * 2.8;
        const z = 2.6;
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        this.scene.add(g);
        const parts = [
          block(g, C.checkout, 0.8, 0.88, 2.4, 0, 0.44, 0),
          block(g, 0x1b1f1d, 0.55, 0.02, 1.7, 0, 0.9, 0.3),
          block(g, 0x2c3530, 0.45, 0.35, 0.4, 0.05, 1.07, -0.9),
          block(g, 0x9aa2a8, 0.05, 1.3, 0.05, 0.38, 1.53, -1.15),
        ];
        const lane = plane(signTexture([String(j + 1)], "#e2462f", 128, 128), 0.34, 0.34);
        lane.position.set(0.38, 2.35, -1.15);
        lane.rotation.y = Math.PI;
        g.add(lane);
        const lane2 = lane.clone();
        lane2.rotation.y = 0;
        g.add(lane2);
        for (const p of parts) {
          p.userData.checkout = true;
          this.pickables.add(p);
        }
        this.checkouts.push({ x, z });
      }
      const lanes = plane(signTexture(["CHECKOUT"], "#e2462f", 768, 160), 2.4, 0.5);
      lanes.position.set(this.xMax - 3.5 - 1.5 * 2.8, 3.4, 2.6);
      lanes.rotation.y = Math.PI;
      this.scene.add(lanes);

      // Sliding doors behind the entrance.
      const cs = this.corridors;
      const ex = cs.length > 1 ? (cs[cs.length - 1].x + cs[cs.length - 2].x) / 2 : cs[0].x;
      this.entranceX = ex;
      const glass = new THREE.MeshLambertMaterial({ color: 0xa9d2ea, transparent: true, opacity: 0.55 });
      block(this.scene, glass, 1.2, 2.4, 0.04, ex - 0.62, 1.2, this.zMin + 0.08);
      block(this.scene, glass, 1.2, 2.4, 0.04, ex + 0.62, 1.2, this.zMin + 0.08);
      block(this.scene, 0x6b7780, 2.6, 0.12, 0.08, ex, 2.44, this.zMin + 0.09);
      const welcome = plane(signTexture(["WELCOME", this.store.adapter.name], C.sign, 1024, 256), 3.6, 0.9);
      welcome.position.set(ex, 3.3, this.zMin + 0.07);
      this.scene.add(welcome);
    }

    // Standing spots, linked like Street View photo points.
    buildNodes() {
      const add = (id, x, z, info) => {
        const n = { id, x, z, links: new Set(), ...info };
        this.nodes.set(id, n);
        return n;
      };
      const link = (a, b) => {
        a.links.add(b);
        b.links.add(a);
      };
      const stops = Math.round(L / STEP);
      let prevFront = null;
      let prevBack = null;
      this.corridors.forEach((c, k) => {
        const f = add(`f${k}`, c.x, this.frontLane, { zone: "front", corridor: k });
        const b = add(`b${k}`, c.x, this.backLane, { zone: "back", corridor: k });
        let prev = f;
        for (let i = 0; i < stops; i++) {
          const s = add(`c${k}_${i}`, c.x, Z0 + (i + 0.5) * STEP, { zone: "aisle", corridor: k });
          link(prev, s);
          prev = s;
        }
        link(prev, b);
        if (prevFront) link(prevFront, f);
        if (prevBack) link(prevBack, b);
        prevFront = f;
        prevBack = b;
      });
      const entrance = add("entrance", this.entranceX, 2.2, { zone: "entrance" });
      const fronts = [...this.nodes.values()].filter((n) => n.zone === "front").sort((a, b) => Math.abs(a.x - entrance.x) - Math.abs(b.x - entrance.x));
      fronts.slice(0, 2).forEach((n) => link(entrance, n));

      // Each bay remembers the closest standing spot.
      for (const bay of this.bays) {
        let best = null;
        let bestD = Infinity;
        for (const n of this.nodes.values()) {
          const d = Math.hypot(n.x - bay.fx, n.z - bay.fz);
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
        bay.node = best;
      }
    }

    // ---- stocking shelves --------------------------------------------------

    // Stocking is a queue with a short front: only MAX_STOCKING shelves wait
    // on the store at a time, and each time a slot frees up it goes to the
    // shelf that matters most right now. Shelves the store has already
    // answered for are filled straight away, without taking a slot.
    stockNearby() {
      // While walking somewhere, get the destination ready rather than the
      // shelves you're passing on the way.
      const at = this.move ? this.move.target : this.pos;
      const look = this.move?.lookAt ? { x: this.move.lookAt.x - at.x, z: this.move.lookAt.z - at.z } : this.lookDir();
      const here = this.move ? this.move.target : this.node;
      const lookLen = Math.hypot(look.x, look.z) || 1;
      const wanted = [];
      let busy = this.store.pendingShelves();
      for (const b of this.bays) {
        const d = this.bayDistance(b, at);
        const dHere = this.bayDistance(b, this.pos);
        if (b.state !== "empty" && dHere > UNSTOCK_RADIUS && d > UNSTOCK_RADIUS) this.unstock(b);
        else if ((b.state === "empty" || b.state === "queued") && d < STOCK_RADIUS) {
          // Shelves in front of you come first; then the nearest.
          const facing = ((b.x - at.x) * look.x + (b.z - at.z) * look.z) / (lookLen * (Math.hypot(b.x - at.x, b.z - at.z) || 1));
          // Shelves in the next aisle are close as the crow flies but
          // behind the shelving, so your own aisle goes first.
          const otherAisle = here.zone === "aisle" && b.corridor !== here.corridor ? 8 : 0;
          wanted.push([d - facing * 4 + otherAisle, b]);
        }
      }
      wanted.sort((a, b) => a[0] - b[0]);

      for (const [, b] of wanted) {
        if (this.isShelfReady(b)) this.stock(b);
        else if (busy < MAX_STOCKING) {
          this.stock(b);
          busy++;
        } else if (b.state === "empty") this.queue(b);
      }

      // Standing at a shelf with room for more: its next page (or its next
      // sub-category section) once the shelves around you have theirs.
      if (!this.move && busy < MAX_STOCKING) {
        const bay = this.bayInView();
        if (bay && this.wantsMore(bay)) this.loadMore(bay);
      }
    }

    // How far a point is from the nearest part of a bay's front: a long bay
    // can be right beside you while its middle is far off.
    bayDistance(b, p) {
      const ry = b.group.rotation.y;
      const ax = Math.cos(ry);
      const az = -Math.sin(ry);
      const t = clamp((p.x - b.fx) * ax + (p.z - b.fz) * az, -b.w / 2, b.w / 2);
      return Math.hypot(b.fx + ax * t - p.x, b.fz + az * t - p.z);
    }

    wantsMore(bay) {
      const s = this.store.shelfState(bay.section);
      // Room left, or sub-category sections still to load.
      return bay.state === "ready" && !!bay.capacity && !!s && !!s.next && !s.morePromise && !s.moreError && (s.products.length < bay.capacity || !!s.next.groups);
    }

    loadMore(bay) {
      return this.store.more(bay.section, bay.place).then((s) => {
        // Sub-category sections go up once they've all arrived, not
        // rearranging the shelf as each one comes in.
        if (s && s.next && s.next.groups) return s;
        if (!this.destroyed && s && s.products !== bay.shownFrom) this.refill(bay);
        return s;
      });
    }

    // Put a bay's products up again (a new page, more products): the new
    // stock goes up before the old comes down, so nothing flickers, and
    // photos both use are kept.
    refill(bay) {
      const s = this.store.shelfState(bay.section);
      if (!bay.stocked || bay.state !== "ready" || !s || s.status !== "ready") return;
      const old = bay.stocked;
      const oldUrls = bay.imageUrls;
      if (this.hoveredMat) {
        this.hoveredMat = null;
        this.hoveredProduct = null;
      }
      bay.stocked = null;
      bay.placeholder = null;
      bay.token = {};
      this.prepareBay(bay);
      this.fill(bay, s.products);
      old.traverse((o) => this.pickables.delete(o));
      bay.group.remove(old);
      disposeTree(old, unitBox);
      for (const url of oldUrls) releaseTexture(url);
      this.invalidate();
    }

    // Waiting its turn: shows the "stocking" boxes right away, so no nearby
    // shelf ever looks empty just because the store is slow.
    queue(bay) {
      this.prepareBay(bay);
      bay.state = "queued";
      bay.token = null;
      this.placeholder(bay);
    }

    prepareBay(bay) {
      if (bay.stocked) return;
      bay.stocked = new THREE.Group();
      bay.group.add(bay.stocked);
      bay.items = [];
      bay.imageUrls = [];
    }

    isShelfReady(bay) {
      const s = this.store.shelfState(bay.section);
      return !!s && s.status === "ready";
    }

    // Everything put on a bay's shelves lives in bay.stocked, so emptying
    // the bay is one remove plus freeing what it used.
    stock(bay) {
      this.prepareBay(bay);
      bay.state = "loading";
      const token = (bay.token = {});
      const s = this.store.shelf(bay.section, bay.place);
      const done = () => {
        if (this.destroyed || bay.token !== token) return;
        this.clearPlaceholder(bay);
        if (s.status === "ready") this.fill(bay, s.products);
        else this.shelfNote(bay, "Couldn't stock this shelf — click to try again", true);
        this.invalidate();
      };
      if (s.status === "loading") {
        if (!bay.placeholder) this.placeholder(bay);
        s.promise.then(done);
      } else done();
    }

    // While a shelf waits on the store: cardboard boxes and a sign, so it
    // doesn't look like the shelf is simply empty.
    placeholder(bay) {
      const f = bay.fixture;
      const g = new THREE.Group();
      const n = Math.max(2, Math.floor(bay.w / 0.55));
      for (const row of f.rows) {
        const h = Math.min(0.2, row.maxH);
        for (let i = 0; i < n; i++) {
          const x = -bay.w / 2 + ((i + 0.5) * bay.w) / n;
          const box = block(g, C.cardboard, 0.34, h, 0.26, x, row.y + h / 2, row.z);
          box.rotation.x = row.kind === "crate" ? row.lean : 0;
        }
      }
      if (!this.stockingTex) {
        this.stockingTex = canvasTexture(1024, 160, (c, w, h) => {
          c.fillStyle = "#fff8d6";
          c.fillRect(0, 0, w, h);
          c.fillStyle = "#1d2320";
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillText(fit(c, "Stocking this shelf…", w - 40, 64, 800), w / 2, h / 2 + 2);
        });
        this.stockingTex.userData.shared = true;
      }
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(bay.w * 0.8, 1.2), 0.19),
        new THREE.MeshBasicMaterial({ map: this.stockingTex, toneMapped: false })
      );
      sign.position.set(0, this.noteY(bay), f.depth + 0.03);
      g.add(sign);
      bay.placeholder = g;
      bay.stocked.add(g);
      this.invalidate();
    }

    // A good height for a notice on this fixture: just above its top row.
    noteY(bay) {
      return Math.max(...bay.fixture.rows.map((r) => r.y)) + 0.14;
    }

    clearPlaceholder(bay) {
      if (!bay.placeholder) return;
      bay.stocked.remove(bay.placeholder);
      disposeTree(bay.placeholder, unitBox);
      bay.placeholder = null;
    }

    unstock(bay) {
      bay.token = null;
      bay.state = "empty";
      if (!bay.stocked) return;
      bay.stocked.traverse((o) => this.pickables.delete(o));
      bay.group.remove(bay.stocked);
      disposeTree(bay.stocked, unitBox);
      for (const url of bay.imageUrls) releaseTexture(url);
      bay.stocked = null;
      bay.placeholder = null;
      bay.items = [];
      bay.imageUrls = [];
      this.invalidate();
    }

    shelfNote(bay, text, retry) {
      bay.state = retry ? "error" : "ready";
      const m = plane(
        canvasTexture(1024, 160, (g, w, h) => {
          g.fillStyle = "#fffdf3";
          g.fillRect(0, 0, w, h);
          g.strokeStyle = "#e2462f";
          g.lineWidth = 6;
          g.strokeRect(3, 3, w - 6, h - 6);
          g.fillStyle = "#1d2320";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(fit(g, text, w - 40, 54, 700), w / 2, h / 2);
        }),
        Math.min(bay.w * 0.9, 1.4),
        0.22
      );
      m.position.set(0, this.noteY(bay), bay.fixture.depth + 0.03);
      if (retry) {
        m.userData.retry = bay;
        this.pickables.add(m);
      }
      bay.stocked.add(m);
    }

    // Put products on the fixture's rows at real-store spacing, left to
    // right, eye-level row first (the store lists its best sellers first).
    // Like a real store, a shelf carries the category's best sellers, as
    // many as fit; anything else is a search away ("Excuse me, where's…").
    // Packages stand (or lean back, in counters and chests); loose produce
    // is heaped in crates.
    fill(bay, products) {
      bay.state = "ready";
      bay.shownFrom = products;
      if (!products.length) return this.shelfNote(bay, "Nothing here right now", false);

      const rows = bay.fixture.rows;
      const inner = bay.w - 0.1;
      const crates = rows[0].kind === "crate";
      const perRow = Math.max(1, Math.floor(inner / (crates ? CRATE_SLOT : SLOT)));
      const slotW = inner / perRow;
      bay.capacity = perRow * rows.length;
      const R = rows.length;
      const { spots, labels } = planShelf(products, perRow, R, crates);
      const tagRows = rows.map(() => []);

      spots.forEach(({ p, r, col }) => {
        const row = rows[r];
        const x0 = -inner / 2 + col * slotW;
        const item = row.kind === "crate" ? this.crate(bay, row, p, x0, slotW) : this.facings(bay, row, p, x0, slotW);
        Object.assign(item, { p, x0, slotW, row });
        bay.items.push(item);
        tagRows[r].push(item);
      });

      rows.forEach((row, r) => {
        if (!tagRows[r].length) return;
        if (row.kind === "crate") tagRows[r].forEach((it) => this.stakeTag(bay, it));
        else this.tagStrip(bay, row, tagRows[r]);
      });
      for (const l of labels) this.sectionLabel(bay, l.name, -inner / 2 + l.col0 * slotW, l.cols * slotW);
      this.refreshBadges();
    }

    // A small sign over one sub-category's section of the shelf ("Onions").
    sectionLabel(bay, name, x0, w) {
      const f = bay.fixture;
      const lw = w * 0.94;
      const lh = 0.065;
      const tex = canvasTexture(Math.round(lw * 800), 52, (g, cw, ch) => {
        g.fillStyle = "#fffdf3";
        g.fillRect(0, 0, cw, ch);
        g.fillStyle = C.sign;
        g.fillRect(0, ch - 6, cw, 6);
        g.fillStyle = "#1d2320";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(fit(g, name, cw - 12, 34, 800, 12), cw / 2, ch / 2 - 2);
      });
      const m = plane(tex, lw, lh);
      m.position.set(x0 + w / 2, f.sign.y - 0.12 - lh / 2, f.sign.z + 0.01);
      bay.stocked.add(m);
    }

    // Packages, side by side: wide slots get several facings of each.
    facings(bay, row, p, x0, slotW) {
      const pw = Math.min(0.22, slotW * 0.8);
      const gap = 0.015;
      const n = clamp(Math.floor((slotW * 0.92) / (pw + gap)), 1, 4);
      const sideMat = lambert(0xf1f1ee);
      const front = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const mats = [sideMat, sideMat, sideMat, sideMat, front, sideMat];
      const span = n * pw + (n - 1) * gap;
      const start = x0 + (slotW - span) / 2 + pw / 2;
      const meshes = [];
      const h0 = Math.min(pw * 1.3, row.maxH);
      for (let i = 0; i < n; i++) {
        // A pivot at the product's base, so leaning products lean from the bottom.
        const pivot = new THREE.Group();
        pivot.position.set(start + i * (pw + gap), row.y, row.z);
        pivot.rotation.x = -row.lean;
        const m = new THREE.Mesh(unitBox, mats);
        m.scale.set(pw, h0, 0.12);
        m.position.y = h0 / 2;
        m.userData.product = p;
        pivot.add(m);
        bay.stocked.add(pivot);
        this.pickables.add(m);
        meshes.push(m);
      }
      const setHeight = (aspect) => {
        const ht = clamp(pw * aspect, 0.08, row.maxH);
        for (const m of meshes) {
          m.scale.y = ht;
          m.position.y = ht / 2;
        }
      };
      this.photo(bay, p, front, setHeight);
      return { meshes, front };
    }

    // A crate of loose produce: the product photo tiled into a heap.
    crate(bay, row, p, x0, slotW) {
      const cw = Math.min(0.5, slotW * 0.9);
      const cd = row.crateD;
      const g = new THREE.Group();
      g.position.set(x0 + slotW / 2, row.y, row.z);
      g.rotation.x = row.lean; // back edge up, so the heap faces the shopper
      const wood = lambert(0x9c7148);
      const sides = [
        block(g, wood, cw, 0.1, 0.02, 0, 0.05, cd / 2),
        block(g, wood, cw, 0.1, 0.02, 0, 0.05, -cd / 2),
        block(g, wood, 0.02, 0.1, cd, cw / 2, 0.05, 0),
        block(g, wood, 0.02, 0.1, cd, -cw / 2, 0.05, 0),
      ];
      const front = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const heap = new THREE.Mesh(this.heapGeometry(cw - 0.03, cd - 0.03), front);
      heap.rotation.x = -Math.PI / 2;
      heap.position.y = 0.08;
      g.add(heap);
      for (const m of [heap, ...sides]) {
        m.userData.product = p;
        this.pickables.add(m);
      }
      bay.stocked.add(g);
      this.photo(bay, p, front, () => {});
      return { meshes: [heap], front, crate: g, cw, cd };
    }

    // A flat patch whose texture repeats about every 11 cm, like a heap of
    // apples; shared between crates of the same size.
    heapGeometry(w, d) {
      const key = `${w.toFixed(2)}x${d.toFixed(2)}`;
      this.heaps = this.heaps || new Map();
      if (!this.heaps.has(key)) {
        const geo = new THREE.PlaneGeometry(w, d);
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 0.11, (uv.getY(i) * d) / 0.11);
        geo.userData.shared = true;
        this.heaps.set(key, geo);
      }
      return this.heaps.get(key);
    }

    // Load a product's photo onto its material (or a name label if there's none).
    photo(bay, p, front, setHeight) {
      const token = bay.token;
      if (!p.image) {
        front.map = labelTexture(p.name);
        return;
      }
      const url = shelfPhoto(p.image);
      bay.imageUrls.push(url);
      // If the small photo isn't there, the original.
      const load = () => acquireTexture(url).catch(() => (url === p.image ? Promise.reject() : (bay.imageUrls.push(p.image), acquireTexture(p.image))));
      load().then(
        ({ texture, aspect }) => {
          if (bay.token !== token) return;
          texture.userData.shared = true; // owned by the cache, not the material
          front.map = texture;
          front.needsUpdate = true;
          setHeight(aspect);
          this.invalidate();
        },
        () => {
          if (bay.token !== token) return;
          front.map = labelTexture(p.name);
          front.needsUpdate = true;
          this.invalidate();
        }
      );
    }

    // The price tags along the front edge of one row.
    tagStrip(bay, row, items) {
      // Only as long as the products on the row, in pieces a texture can
      // hold at full resolution (a long bay would squeeze every tag).
      const sorted = items.slice().sort((a, b) => a.x0 - b.x0);
      const maxW = 4096 / PX_PER_M;
      const pieces = [];
      for (const it of sorted) {
        const last = pieces[pieces.length - 1];
        if (last && it.x0 + it.slotW - last.x0 <= maxW) last.items.push(it);
        else pieces.push({ x0: it.x0, items: [it] });
      }
      for (const piece of pieces) {
        const end = piece.items[piece.items.length - 1];
        const w = end.x0 + end.slotW - piece.x0;
        const cw = Math.round(w * PX_PER_M);
        const ch = Math.round(TAG_H * PX_PER_M);
        const px = (m) => (m - piece.x0) * PX_PER_M;
        const tex = canvasTexture(cw, ch, (g) => {
          g.fillStyle = "#8d959c";
          g.fillRect(0, 0, cw, ch);
          let prev = null;
          for (const it of piece.items) {
            const tw = Math.min(it.slotW * 0.94, 0.34) * PX_PER_M;
            const tx = px(it.x0) + (it.slotW * PX_PER_M - tw) / 2;
            this.drawTag(g, it.p, tx, 4, tw, ch - 8);
            // A dark line where one brand's block ends and the next begins.
            const brand = S.brandKey(it.p);
            if (prev !== null && brand !== prev) {
              g.fillStyle = "#3b4247";
              g.fillRect(px(it.x0) - 3, 0, 6, ch);
            }
            prev = brand;
          }
        });
        const m = plane(tex, w, TAG_H);
        m.position.set(piece.x0 + w / 2, row.tag.y, row.tag.z);
        m.rotation.x = -row.tag.lean;
        m.userData.tags = { bay, items: piece.items, x0: piece.x0, w };
        bay.stocked.add(m);
        this.pickables.add(m);
      }
    }

    // A little price sign on a stake at the back of a produce crate.
    stakeTag(bay, it) {
      const tex = canvasTexture(240, 96, (g, w, h) => this.drawTag(g, it.p, 0, 0, w, h));
      const m = plane(tex, 0.2, 0.08);
      m.position.set(0, 0.2, -it.cd / 2);
      m.rotation.x = -it.row.lean; // stand upright again
      m.userData.product = it.p;
      it.crate.add(m);
      this.pickables.add(m);
      const stake = block(it.crate, lambert(0x9c7148), 0.012, 0.16, 0.012, 0, 0.1, -it.cd / 2 - 0.01);
      stake.userData.product = it.p;
    }

    drawTag(g, p, x, y, w, h) {
      g.fillStyle = "#fff";
      g.fillRect(x, y, w, h);
      g.fillStyle = "#ffd84a";
      g.fillRect(x, y, 8, h);
      g.fillStyle = "#56605a";
      g.textBaseline = "alphabetic";
      const price = p.price == null ? "See price" : `$${p.price.toFixed(2)}`;
      // The price comes first; the unit price ("$0.21/oz", shelf-tag
      // shorthand) takes what's left beside it, or moves up to the name
      // line when the tag is too narrow.
      const priceText = fit(g, price, w - 22, p.price == null ? Math.round(h * 0.3) : Math.round(h * 0.52), 900, 10);
      const priceFont = g.font;
      const priceW = g.measureText(priceText).width;
      const unit = p.unitPrice ? shortUnit(p.unitPrice) : "";
      let unitBeside = false;
      if (unit) {
        g.font = `600 ${Math.round(h * 0.2)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        unitBeside = g.measureText(unit).width <= w - 14 - priceW - 12;
      }
      g.textAlign = "left";
      g.fillStyle = "#56605a";
      let nameW = w - 22;
      if (unit && !unitBeside) {
        g.font = `600 ${Math.round(h * 0.2)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        const top = fit(g, unit, w * 0.5, Math.round(h * 0.2), 600, 8);
        const tw = g.measureText(top).width;
        g.textAlign = "right";
        g.fillText(top, x + w - 6, y + h * 0.3);
        g.textAlign = "left";
        nameW = w - 26 - tw;
      }
      g.fillText(fit(g, p.name, nameW, Math.round(h * 0.22), 500, 9), x + 14, y + h * 0.3);
      g.font = priceFont;
      g.fillStyle = "#1d2320";
      g.fillText(priceText, x + 14, y + h * 0.86);
      if (unit && unitBeside) {
        g.font = `600 ${Math.round(h * 0.2)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        g.fillStyle = "#56605a";
        g.textAlign = "right";
        g.fillText(unit, x + w - 6, y + h * 0.84);
      }
    }

    refreshBadges() {
      for (const bay of this.bays) {
        for (const it of bay.items) {
          const qty = this.store.basket.get(it.p.id)?.qty || 0;
          if (it.badgeQty === qty) continue;
          it.badgeQty = qty;
          if (it.badge) {
            it.badge.parent.remove(it.badge);
            disposeTree(it.badge);
            it.badge = null;
          }
          if (!qty) continue;
          const tex = canvasTexture(256, 80, (g, w, h) => {
            g.fillStyle = "#e2462f";
            g.beginPath();
            g.roundRect(0, 0, w, h, h / 2);
            g.fill();
            g.fillStyle = "#fff";
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.font = "800 40px system-ui, sans-serif";
            g.fillText(`${qty} in cart`, w / 2, h / 2 + 2);
          });
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, toneMapped: false }));
          s.scale.set(0.15, 0.047, 1);
          s.position.set(it.x0 + it.slotW / 2, it.row.y + 0.06, it.row.z + 0.12);
          bay.stocked.add(s);
          it.badge = s;
        }
      }
      this.invalidate();
    }

    // ---- moving around -----------------------------------------------------

    path(from, to) {
      const prev = new Map([[from, null]]);
      const queue = [from];
      while (queue.length) {
        const n = queue.shift();
        if (n === to) break;
        for (const m of n.links) {
          if (!prev.has(m)) {
            prev.set(m, n);
            queue.push(m);
          }
        }
      }
      const out = [];
      for (let n = to; n; n = prev.get(n)) out.unshift(n);
      return out;
    }

    walkTo(target, { lookAt = null, faceTravel = true, flash = null } = {}) {
      if (this.move) this.finishMove();
      const route = this.path(this.node, target);
      const pts = [{ x: this.pos.x, z: this.pos.z }, ...route.slice(1)];
      const segLen = [];
      let dist = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
        segLen.push(l);
        dist += l;
      }
      this.clearArrows();
      if (dist < 0.01) {
        this.node = target;
        this.arrive(lookAt, flash);
        return;
      }
      const speed = this.reduceMotion ? Infinity : Math.max(3.2, dist / 2.8);
      this.move = { pts, segLen, seg: 0, t: 0, speed, faceTravel, target, lookAt, flash };
    }

    finishMove() {
      const m = this.move;
      this.move = null;
      this.pos = { x: m.target.x, z: m.target.z };
      this.node = m.target;
      this.arrive(m.lookAt, m.flash);
    }

    arrive(lookAt, flash) {
      if (lookAt) {
        this.yawTarget = Math.atan2(lookAt.x - this.pos.x, lookAt.z - this.pos.z);
        this.pitchTarget = -0.12;
      }
      if (flash) {
        flash.flashUntil = performance.now() + 2600;
        this.flashing = flash;
      }
      this.showArrows();
      this.updateHud();
    }

    goToSection(place, sideIndex = 0, sectionIndex = 0) {
      const bay =
        this.bays.find((b) => b.place === place && b.sideIndex === sideIndex && b.sectionIndex === sectionIndex) ||
        this.bays.find((b) => b.place === place && b.sideIndex === sideIndex) ||
        this.bays.find((b) => b.place === place);
      if (!bay) return;
      this.walkTo(bay.node, { lookAt: { x: bay.x, z: bay.z }, flash: bay });
    }

    goToEntrance() {
      const e = this.nodes.get("entrance");
      this.walkTo(e, { lookAt: { x: e.x, z: e.z + 10 } });
    }

    lookDir() {
      return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    }

    step(dir) {
      if (this.move) return;
      const look = this.lookDir();
      let best = null;
      let bestDot = 0.55;
      for (const n of this.node.links) {
        const dx = n.x - this.node.x;
        const dz = n.z - this.node.z;
        const len = Math.hypot(dx, dz) || 1;
        const dot = ((dx * look.x + dz * look.z) / len) * dir;
        if (dot > bestDot) {
          bestDot = dot;
          best = n;
        }
      }
      if (best) this.walkTo(best, { faceTravel: false });
    }

    turn(dir) {
      const base = this.yawTarget ?? this.yaw;
      this.yawTarget = base - (dir * Math.PI) / 4; // yaw grows to the left
    }

    clearArrows() {
      for (const a of this.arrows) {
        this.scene.remove(a);
        a.material.dispose();
      }
      this.arrows = [];
      this.invalidate();
    }

    showArrows() {
      this.clearArrows();
      if (!this.arrowGeo) {
        const s = new THREE.Shape();
        s.moveTo(0, 0.32);
        s.lineTo(0.3, -0.05);
        s.lineTo(0.18, -0.16);
        s.lineTo(0, 0.08);
        s.lineTo(-0.18, -0.16);
        s.lineTo(-0.3, -0.05);
        s.closePath();
        this.arrowGeo = new THREE.ShapeGeometry(s);
        this.arrowGeo.rotateX(Math.PI / 2); // lie flat, pointing along +z
      }
      for (const n of this.node.links) {
        const dx = n.x - this.node.x;
        const dz = n.z - this.node.z;
        const len = Math.hypot(dx, dz);
        const mat = new THREE.MeshBasicMaterial({ color: 0x1f6b45, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
        const a = new THREE.Mesh(this.arrowGeo, mat);
        a.position.set(this.node.x + (dx / len) * 1.1, 0.02, this.node.z + (dz / len) * 1.1);
        a.rotation.y = Math.atan2(dx, dz);
        a.userData.arrow = n;
        a.renderOrder = 2;
        this.scene.add(a);
        this.arrows.push(a);
      }
    }

    // ---- input -------------------------------------------------------------

    bindInput() {
      const c = this.canvas;
      const pointers = new Map();
      let drag = null;
      let pinch = null;

      c.addEventListener("pointerdown", (e) => {
        c.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: this.camera.fov };
          drag = null;
        } else {
          drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
        }
        this.hint.classList.add("fade");
      });

      c.addEventListener("pointermove", (e) => {
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          this.setFov(pinch.fov * (pinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y))));
          return;
        }
        if (drag) {
          const dx = e.clientX - drag.x;
          const dy = e.clientY - drag.y;
          if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
          if (drag.moved) {
            const k = (this.camera.fov / 70) * 0.005;
            this.yaw += dx * k;
            this.pitch = clamp(this.pitch + dy * k, -1.1, 0.9);
            this.yawTarget = null;
            this.pitchTarget = null;
            this.hideTip();
            this.invalidate();
          }
          drag.x = e.clientX;
          drag.y = e.clientY;
          return;
        }
        this.hoverAt = { x: e.clientX, y: e.clientY };
      });

      const up = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (drag && !drag.moved && e.type === "pointerup") this.clickAt(e.clientX, e.clientY);
        drag = null;
      };
      c.addEventListener("pointerup", up);
      c.addEventListener("pointercancel", up);
      c.addEventListener("pointerleave", () => this.hideTip());
      c.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          this.setFov(this.camera.fov + e.deltaY * 0.03);
        },
        { passive: false }
      );
    }

    setFov(f) {
      this.camera.fov = clamp(f, 25, 75);
      this.camera.updateProjectionMatrix();
      this.invalidate();
    }

    pick(clientX, clientY) {
      const r = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hits = this.raycaster.intersectObjects([...this.arrows, ...this.pickables, ...this.solids, this.floor], false);
      // Arrows lie on the floor, so let them win over the floor itself.
      const arrow = hits.find((h) => h.object.userData.arrow);
      if (arrow && (hits[0] === arrow || hits[0].object.userData.floor)) return arrow;
      return hits[0] || null;
    }

    productFromHit(hit) {
      const u = hit.object.userData;
      if (u.product) return u.product;
      if (u.tags && hit.uv) {
        const x = u.tags.x0 + hit.uv.x * u.tags.w;
        const it = u.tags.items.find((i) => x >= i.x0 && x < i.x0 + i.slotW);
        return it ? it.p : null;
      }
      return null;
    }

    clickAt(x, y) {
      const hit = this.pick(x, y);
      if (!hit) return;
      const u = hit.object.userData;
      const product = this.productFromHit(hit);
      if (product) return this.store.openProduct(product);
      if (u.arrow) return this.walkTo(u.arrow);
      if (u.checkout) return this.store.toggleCart(true);
      if (u.retry) {
        this.unstock(u.retry);
        return this.stock(u.retry);
      }
      if (u.floor) {
        let best = null;
        let bestD = 3;
        for (const n of this.nodes.values()) {
          const d = Math.hypot(n.x - hit.point.x, n.z - hit.point.z);
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
        if (best && best !== this.node) this.walkTo(best);
      }
    }

    hover() {
      const at = this.hoverAt;
      if (!at) return;
      this.hoverAt = null;
      this.invalidate(); // highlights may change
      const hit = this.pick(at.x, at.y);
      const u = hit ? hit.object.userData : {};
      const product = hit && this.productFromHit(hit);

      if (this.hoveredMat && (!product || this.hoveredProduct !== product)) {
        this.hoveredMat.emissive.setHex(0x000000);
        this.hoveredMat = null;
        this.hoveredProduct = null;
      }
      for (const a of this.arrows) a.material.color.setHex(a === (hit && hit.object) ? 0xe2462f : 0x1f6b45);

      let text = null;
      if (product) {
        const qty = this.store.basket.get(product.id)?.qty;
        const price = product.price == null ? "" : `$${product.price.toFixed(2)}`;
        text = [product.name, [price, product.unitPrice && `(${product.unitPrice})`].filter(Boolean).join(" "), qty ? `${qty} in your cart` : "Click to pick it up"];
        const item = this.findItem(product);
        if (item && hit.object.userData.product) {
          item.front.emissive.setHex(0x2a2a2a);
          this.hoveredMat = item.front;
          this.hoveredProduct = product;
        }
      } else if (u.arrow) {
        const n = u.arrow;
        const here = this.node;
        text = [n.corridor !== here.corridor || n.zone !== here.zone ? `Walk to ${this.placeName(n)}` : "Walk this way"];
      } else if (u.checkout) {
        text = ["Checkout lane", "Click to look in your cart and pay"];
      } else if (u.retry) {
        text = ["Try stocking this shelf again"];
      }
      this.canvas.style.cursor = text ? "pointer" : u.floor ? "crosshair" : "grab";
      if (!text) return this.hideTip();
      const r = this.el.getBoundingClientRect();
      this.tooltip.replaceChildren(...text.map((t, i) => S.h(i ? "div" : "strong", {}, t)));
      this.tooltip.hidden = false;
      this.tooltip.style.left = `${clamp(at.x - r.left + 14, 8, r.width - 260)}px`;
      this.tooltip.style.top = `${clamp(at.y - r.top + 14, 8, r.height - 90)}px`;
    }

    hideTip() {
      this.tooltip.hidden = true;
    }

    findItem(p) {
      for (const b of this.bays) for (const it of b.items) if (it.p === p) return it;
      return null;
    }

    onKey(e) {
      const k = e.key.toLowerCase();
      if (k === "arrowup" || k === "w") this.step(1);
      else if (k === "arrowdown" || k === "s") this.step(-1);
      else if (k === "arrowleft" || k === "a" || k === "q") this.turn(-1);
      else if (k === "arrowright" || k === "d" || k === "e") this.turn(1);
      else return false;
      return true;
    }

    // ---- where am I? ------------------------------------------------------

    placeName(n) {
      if (n.zone === "entrance") return "the entrance";
      if (n.zone === "front") return "the front of the store";
      if (n.zone === "back") return "the back of the store";
      return this.corridors[n.corridor].label;
    }

    // The bay you're looking at, if you're close enough to read it.
    bayInView() {
      const look = this.lookDir();
      let best = null;
      let bestScore = 0.5;
      for (const b of this.bays) {
        // Only shelves whose front faces you: the one behind the shelving
        // you're looking at stands back to back with it, a few cm away.
        const ry = b.group.rotation.y;
        if ((this.pos.x - b.x) * Math.sin(ry) + (this.pos.z - b.z) * Math.cos(ry) <= 0) continue;
        // The part of the bay nearest to where you're looking (a long bay
        // runs well past what's in front of you).
        const ax = Math.cos(ry);
        const az = -Math.sin(ry);
        const ahead = { x: this.pos.x + look.x * 2, z: this.pos.z + look.z * 2 };
        const t = clamp((ahead.x - b.fx) * ax + (ahead.z - b.fz) * az, -b.w / 2, b.w / 2);
        const dx = b.fx + ax * t - this.pos.x;
        const dz = b.fz + az * t - this.pos.z;
        const d = Math.max(0.01, Math.hypot(dx, dz));
        if (d > 4.5) continue;
        const dot = (dx * look.x + dz * look.z) / d;
        const score = dot - d * 0.08;
        if (score > bestScore) {
          bestScore = score;
          best = b;
        }
      }
      return best;
    }

    updateHud() {
      if (this.move) {
        this.locTitle.textContent = `Walking to ${this.placeName(this.move.target)}…`;
        this.locSides.replaceChildren();
        return;
      }
      const n = this.node;
      const look = this.lookDir();
      let title;
      let sides = [];
      if (n.zone === "aisle") {
        const c = this.corridors[n.corridor];
        title = c.label + (c.number && /\d/.test(c.number) ? ` · ${c.sub}` : "");
        const bayAt = (faceSide) => {
          const list = this.bays.filter((b) => b.corridor === n.corridor && b.faceSide === faceSide);
          return list.sort((a, b) => Math.abs(a.z - n.z) - Math.abs(b.z - n.z))[0];
        };
        if (Math.abs(look.z) > 0.6) {
          const [l, r] = look.z > 0 ? ["left", "right"] : ["right", "left"];
          // A side can be a bare wall, with no shelves.
          const [bl, br] = [bayAt(l), bayAt(r)];
          sides = [bl && `◀ ${bl.section.name}`, br && `${br.section.name} ▶`].filter(Boolean);
        }
      } else if (n.zone === "back") title = ["Back of the store", ...new Set(S.LAYOUT.plan.back.map(([id]) => S.place(id).label))].join(" · ");
      else if (n.zone === "front") title = "Front of the store";
      else title = "Entrance";
      const bay = this.bayInView();
      if (bay && (sides.length === 0 || Math.abs(look.z) <= 0.6)) sides = [`Looking at: ${bay.section.name}`];
      this.locTitle.textContent = title;
      this.locSides.replaceChildren(...sides.map((s) => S.h("span", {}, s)));
      this.hudYaw = this.yaw;
    }

    openFlat() {
      const bay = this.bayInView();
      if (bay) this.store.goToFlat(bay.place, bay.sideIndex, bay.sectionIndex);
      else this.store.goMap();
    }

    drawMinimap() {
      const c = this.minimap;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      if (!cw || !ch) return;
      if (c.width !== cw * dpr) {
        c.width = cw * dpr;
        c.height = ch * dpr;
      }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pad = 6;
      const sx = (cw - pad * 2) / (this.xMax - this.xMin);
      const sz = (ch - pad * 2) / (this.zMax - this.zMin);
      // Looking into the store is "up"; your left (+x) is on the left.
      const X = (x) => pad + (this.xMax - x) * sx;
      const Y = (z) => ch - pad - (z - this.zMin) * sz;
      g.clearRect(0, 0, cw, ch);
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.fillRect(0, 0, cw, ch);
      g.fillStyle = "#b9c0c5";
      for (const b of this.bays) {
        const hw = b.w / 2;
        const along = Math.abs(Math.sin(b.group.rotation.y)) > 0.5; // side faces run along z
        if (along) g.fillRect(X(b.x) - 2, Y(b.z + hw), 4, hw * 2 * sz);
        else g.fillRect(X(b.x + hw), Y(b.z) - 2, hw * 2 * sx, 4);
      }
      g.fillStyle = "#e2462f";
      for (const c of this.checkouts) g.fillRect(X(c.x) - 2, Y(c.z + 1.2), 4, 2.4 * sz);
      // You.
      const px = X(this.pos.x);
      const py = Y(this.pos.z);
      const a = Math.atan2(-Math.sin(this.yaw), Math.cos(this.yaw)); // screen angle
      g.fillStyle = "rgba(31,107,69,0.25)";
      g.beginPath();
      g.moveTo(px, py);
      g.arc(px, py, 18, -Math.PI / 2 + a - 0.5, -Math.PI / 2 + a + 0.5);
      g.closePath();
      g.fill();
      g.fillStyle = "#1f6b45";
      g.beginPath();
      g.arc(px, py, 4, 0, Math.PI * 2);
      g.fill();
    }

    // ---- frame loop --------------------------------------------------------

    resize() {
      const w = this.el.clientWidth;
      const h = this.el.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.invalidate();
    }

    // Draw a frame only when something changed, so standing still in an
    // aisle doesn't keep the GPU (and a phone's battery) busy.
    invalidate() {
      this.dirty = true;
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.resize();
      this.invalidate();
      let last = performance.now();
      let stockClock = 0;
      const loop = (t) => {
        if (!this.running) return;
        const dt = Math.min(0.25, (t - last) / 1000);
        last = t;
        // Scheduled first: an error in one frame mustn't stop the store
        // (no more drawing, no more stocking).
        this.raf = requestAnimationFrame(loop);
        try {
          this.update(dt);
          stockClock -= dt;
          if (stockClock <= 0) {
            stockClock = 0.35;
            this.stockNearby();
          }
          if (this.dirty) {
            this.dirty = false;
            this.renderer.render(this.scene, this.camera);
            this.drawMinimap();
          }
        } catch (e) {
          if (!this.loggedError) console.error("Supermarket Mode:", e);
          this.loggedError = true;
        }
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.hideTip();
    }

    update(dt) {
      const m = this.move;
      const easing = this.reduceMotion ? 1 : null;
      if (m) {
        m.t += dt * m.speed;
        while (m.seg < m.segLen.length && m.t > m.segLen[m.seg]) {
          m.t -= m.segLen[m.seg];
          m.seg++;
        }
        if (m.seg >= m.segLen.length) this.finishMove();
        else {
          const a = m.pts[m.seg];
          const b = m.pts[m.seg + 1];
          const f = m.t / m.segLen[m.seg];
          this.pos = { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
          if (m.faceTravel) this.yawTarget = Math.atan2(b.x - a.x, b.z - a.z);
        }
        this.invalidate();
      }
      if (this.yawTarget != null) {
        const d = angleDiff(this.yaw, this.yawTarget);
        if (Math.abs(d) < 0.002) {
          this.yaw = this.yawTarget;
          this.yawTarget = null;
        } else this.yaw += d * (easing ?? Math.min(1, dt * 7));
        this.invalidate();
      }
      if (this.pitchTarget != null) {
        const d = this.pitchTarget - this.pitch;
        if (Math.abs(d) < 0.002) this.pitchTarget = null;
        this.pitch += d * (easing ?? Math.min(1, dt * 5));
        this.invalidate();
      }
      if (this.flashing) {
        const b = this.flashing;
        const left = b.flashUntil - performance.now();
        if (left <= 0) {
          b.signMat.color.setHex(0xffffff);
          this.flashing = null;
        } else b.signMat.color.setHex(Math.floor(left / 260) % 2 ? 0xffe066 : 0xffffff);
        this.invalidate();
      }

      if (this.dirty) {
        const cp = Math.cos(this.pitch);
        this.camera.position.set(this.pos.x, EYE, this.pos.z);
        this.camera.lookAt(this.pos.x + Math.sin(this.yaw) * cp, EYE + Math.sin(this.pitch), this.pos.z + Math.cos(this.yaw) * cp);
      }

      if (this.move !== this.hudMove || Math.abs(angleDiff(this.hudYaw ?? 0, this.yaw)) > 0.2) {
        this.hudMove = this.move;
        this.updateHud();
      }
      this.hover();
    }

    destroy() {
      if (this.destroyed) return;
      this.stop();
      this.destroyed = true;
      this.ro.disconnect();
      this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
      for (const b of this.bays) b.token = null;
      disposeTree(this.scene);
      for (const m of matCache.values()) m.dispose();
      matCache.clear();
      releaseAllTextures();
      if (this.stockingTex) this.stockingTex.dispose();
      for (const m of this.glassMats.values()) m.dispose();
      for (const geo of (this.heaps || new Map()).values()) geo.dispose();
      if (this.glowMat) this.glowMat.dispose();
      this.renderer.dispose();
      // Browsers allow only a handful of live WebGL contexts per page, so
      // give this one back now rather than whenever it's garbage collected.
      this.renderer.forceContextLoss();
    }
  }

  S.Walk3D = Walk3D;
  S.Walk3D.supported = supported;
})();
