// Walk through the store in 3D, Street View style: drag to look around,
// click the arrows on the floor (or anywhere on the floor) to walk there, and
// click a product on the shelf to pick it up.
//
// The building is generated from the floor plan in layout.js. Shelves are
// stocked lazily with real search results as you walk up to them.
(function () {
  const S = (window.Supermarket = window.Supermarket || {});
  const THREE = window.THREE;

  // Store dimensions, in meters.
  const W = 2.4; // aisle width (walkway between two shelf faces)
  const FACE_D = 0.42; // shelf depth
  const D = FACE_D * 2 + 0.06; // a gondola: two shelf faces back to back
  const SPACING = W + D;
  const Z0 = 4.4; // where the aisles start, measured from the front wall
  const L = 12; // aisle length
  const STEP = 1.5; // distance between standing spots inside an aisle
  const EYE = 1.6;
  const BOARDS = [1.32, 0.72, 0.12]; // shelf heights, top shelf first
  const SHELF_H = 2.0;
  const CEILING = 4.5;
  const TAG_H = 0.08;
  const PX_PER_M = 700; // price tag text resolution
  const STOCK_RADIUS = 10; // stock shelves within this distance…
  const UNSTOCK_RADIUS = 24; // …and empty them again past this one, to save memory

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
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = clamp(Math.round(256 * aspect), 32, 512);
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
      if (o.geometry && o.geometry !== keep) o.geometry.dispose();
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
      const Lay = S.LAYOUT;
      const dept = (id) => Lay.departments.find((d) => d.id === id);
      const face = (place, sideIndex, from = 0, to) => ({
        place,
        sideIndex,
        offset: from,
        sections: place.sides[sideIndex].sections.slice(from, to),
      });

      // Walking into the store you face +z, so your left is +x. Corridors
      // run left to right: produce, aisles 1–7, then deli & dairy.
      const produce = dept("produce");
      const corridors = [{ label: "Produce", sub: "Fruit · Vegetables", icon: produce.sign, left: face(produce, 0), right: face(produce, 1), style: "wood" }];
      for (const a of Lay.aisles) {
        const two = a.sides.length > 1;
        const half = Math.ceil(a.sides[0].sections.length / 2);
        corridors.push({
          label: a.label,
          number: a.label.replace("Aisle ", ""),
          sub: a.sides.map((s) => s.label).join(" · "),
          cold: a.cold,
          left: two ? face(a, 0) : face(a, 0, 0, half),
          right: two ? face(a, 1) : face(a, 0, half),
        });
      }
      const deli = dept("deli");
      const dairy = dept("dairy");
      corridors.push({ label: "Deli & Dairy", sub: "Deli · Dairy & Eggs", icon: dairy.sign, left: face(deli, 0), right: face(dairy, 0), coldRight: true });
      this.corridors = corridors;

      const N = corridors.length;
      const xk = (k) => -k * SPACING;
      this.xMax = W / 2 + FACE_D + 0.05;
      this.xMin = xk(N - 1) - W / 2 - FACE_D - 0.05;
      this.cx = (this.xMax + this.xMin) / 2;
      this.zMin = -1.8;
      this.zMax = Z0 + L + 3.0 + FACE_D + 0.05;
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

      // Ceiling with long light panels over every aisle.
      block(this.scene, C.ceiling, width, 0.05, depth, this.cx, CEILING, zMid);
      const lightMat = new THREE.MeshBasicMaterial({ color: C.light });
      for (let k = 0; k < N; k++) {
        for (let z = Z0 - 2; z < Z0 + L + 2; z += 3) block(this.scene, lightMat, 0.35, 0.03, 2.2, xk(k), CEILING - 0.04, z + 1.1);
      }

      // Walls.
      const wallH = CEILING;
      block(this.scene, C.wall, 0.1, wallH, depth, this.xMax + 0.05, wallH / 2, zMid, this.solids);
      block(this.scene, C.wall, 0.1, wallH, depth, this.xMin - 0.05, wallH / 2, zMid, this.solids);
      block(this.scene, C.wall, width, wallH, 0.1, this.cx, wallH / 2, this.zMax + 0.05, this.solids);
      block(this.scene, C.wall, width, wallH, 0.1, this.cx, wallH / 2, this.zMin - 0.05, this.solids);

      // Big department signs on the walls.
      const wallSign = (text, x, z, rotY, w = 5, color = C.sign) => {
        const m = plane(signTexture([text], color, 1024, 180), w, w * 0.176);
        m.position.set(x, 3.3, z);
        m.rotation.y = rotY;
        this.scene.add(m);
      };
      wallSign("PRODUCE", this.xMax - 0.01, Z0 + L / 2, -Math.PI / 2);
      wallSign("DAIRY & EGGS", this.xMin + 0.01, Z0 + L / 2, Math.PI / 2, 5, C.cold);
      wallSign("BAKERY", this.cx + 5, this.zMax - 0.01, Math.PI);
      wallSign("MEAT & SEAFOOD", this.cx - 5, this.zMax - 0.01, Math.PI);

      // Shelves along each corridor.
      corridors.forEach((c, k) => {
        const x = xk(k);
        this.buildFace(c.left, k, x + W / 2 + FACE_D, -Math.PI / 2, c.style, c.cold);
        this.buildFace(c.right, k, x - W / 2 - FACE_D, Math.PI / 2, c.style, c.cold || c.coldRight);
        this.hangingSign(c, x);
      });

      // End caps closing off the gondolas between corridors.
      for (let k = 0; k < N - 1; k++) {
        const gx = xk(k) - W / 2 - D / 2;
        block(this.scene, C.endcap, D, SHELF_H, 0.05, gx, SHELF_H / 2, Z0 - 0.025, this.solids);
        block(this.scene, C.endcap, D, SHELF_H, 0.05, gx, SHELF_H / 2, Z0 + L + 0.025, this.solids);
        block(this.scene, C.accent, D + 0.01, 0.12, 0.06, gx, SHELF_H - 0.1, Z0 - 0.03);
      }

      // Back wall: bakery on the left, meat & seafood on the right.
      const bakery = dept("bakery");
      const meat = dept("meat");
      const back = [...face(bakery, 0).sections.map((s, i) => ({ f: face(bakery, 0), i })), ...face(meat, 0).sections.map((s, i) => ({ f: face(meat, 0), i }))];
      const bw = 20 / back.length;
      back.forEach(({ f, i }, j) => {
        const x = this.cx + 10 - (j + 0.5) * bw;
        this.buildBay(f, i, x, this.zMax - 0.05, Math.PI, bw, "wood", false, null);
      });

      this.buildFront();
      this.buildNodes();
    }

    buildFace(face, k, originX, theta, style, cold) {
      const n = face.sections.length;
      const bw = L / n;
      face.sections.forEach((sec, i) => {
        // Section 0 sits nearest the front of the store.
        const z = Z0 + (i + 0.5) * bw;
        this.buildBay(face, i, originX, z, theta, bw, style, cold, k);
      });
    }

    buildBay(face, i, x, z, theta, w, style, cold, corridor) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = theta;
      this.scene.add(g);

      const board = style === "wood" ? C.wood : C.board;
      block(g, C.panel, w, SHELF_H, 0.04, 0, SHELF_H / 2, 0.02, this.solids);
      block(g, C.kick, w, 0.1, FACE_D, 0, 0.05, FACE_D / 2, this.solids);
      for (const y of BOARDS) block(g, board, w - 0.02, 0.03, FACE_D, 0, y - 0.015, FACE_D / 2, this.solids);
      block(g, C.upright, 0.04, SHELF_H, FACE_D, -w / 2, SHELF_H / 2, FACE_D / 2, this.solids);
      block(g, C.upright, 0.04, SHELF_H, FACE_D, w / 2, SHELF_H / 2, FACE_D / 2, this.solids);

      const sec = face.sections[i];
      const signMat = new THREE.MeshBasicMaterial({ map: signTexture([sec.name.toUpperCase()], cold ? C.cold : C.sign, 768, 128), toneMapped: false });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w * 0.9, 1.8), 0.26), signMat);
      sign.position.set(0, SHELF_H + 0.16, FACE_D * 0.4);
      g.add(sign);

      if (cold) {
        // Fridge / freezer doors.
        const glass = new THREE.MeshLambertMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.16 });
        block(g, glass, w, SHELF_H - 0.1, 0.02, 0, SHELF_H / 2 + 0.05, FACE_D + 0.04);
        const doors = Math.max(1, Math.round(w / 0.75));
        for (let d = 0; d <= doors; d++) block(g, 0xb8c2c8, 0.035, SHELF_H - 0.1, 0.04, -w / 2 + (d * w) / doors, SHELF_H / 2 + 0.05, FACE_D + 0.04);
      }

      // Where to stand to look at it: the point just in front of the bay.
      const front = new THREE.Vector3(0, 0, FACE_D + 0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), theta);
      this.bays.push({
        face,
        index: i,
        section: sec,
        group: g,
        w,
        x,
        z,
        fx: x + front.x,
        fz: z + front.z,
        corridor,
        signMat,
        state: "empty",
        items: [],
      });
    }

    hangingSign(c, x) {
      const tex = canvasTexture(768, 256, (g, w, h) => {
        g.fillStyle = c.cold ? C.cold : C.sign;
        g.fillRect(0, 0, w, h);
        g.fillStyle = "rgba(0,0,0,0.18)";
        g.fillRect(0, 0, 220, h);
        g.fillStyle = "#fff";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = c.number ? "900 150px system-ui, sans-serif" : "110px system-ui, sans-serif";
        g.fillText(c.number || c.icon, 110, h / 2 + 8);
        g.textAlign = "left";
        const parts = c.sub.split(" · ");
        const lh = h / (parts.length + 1);
        parts.forEach((p, i) => g.fillText(fit(g, p, w - 270, 52, 800, 20), 250, lh * (i + 1) + 4));
      });
      // Two single-sided faces so it reads correctly from both ends.
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      for (const rot of [Math.PI, 0]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.63), mat);
        m.position.set(x, 3.05, Z0 + 0.6 + (rot ? -0.01 : 0.01));
        m.rotation.y = rot;
        this.scene.add(m);
      }
      for (const dx of [-0.8, 0.8]) block(this.scene, 0x888888, 0.01, CEILING - 3.36, 0.01, x + dx, (CEILING + 3.36) / 2, Z0 + 0.6);
    }

    buildFront() {
      // Checkout lanes to the right of the entrance.
      for (let j = 0; j < 3; j++) {
        const x = this.cx - 2 - j * 2.8;
        const g = new THREE.Group();
        g.position.set(x, 0, -0.1);
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
      }

      // Sliding doors behind the entrance.
      const ex = this.cx + 5;
      const glass = new THREE.MeshLambertMaterial({ color: 0xa9d2ea, transparent: true, opacity: 0.55 });
      block(this.scene, glass, 1.2, 2.4, 0.04, ex - 0.62, 1.2, this.zMin + 0.03);
      block(this.scene, glass, 1.2, 2.4, 0.04, ex + 0.62, 1.2, this.zMin + 0.03);
      block(this.scene, 0x6b7780, 2.6, 0.12, 0.08, ex, 2.44, this.zMin + 0.04);
      const welcome = plane(signTexture(["WELCOME", this.store.adapter.name], C.sign, 1024, 256), 3.6, 0.9);
      welcome.position.set(ex, 3.2, this.zMin + 0.02);
      this.scene.add(welcome);
      const lanes = plane(signTexture(["CHECKOUT"], "#e2462f", 768, 160), 2.4, 0.5);
      lanes.position.set(this.cx - 4.8, 3.0, -0.1);
      lanes.rotation.y = Math.PI;
      this.scene.add(lanes);
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
      const N = this.corridors.length;
      const stops = Math.round(L / STEP);
      let prevFront = null;
      let prevBack = null;
      for (let k = 0; k < N; k++) {
        const x = -k * SPACING;
        const f = add(`f${k}`, x, Z0 - 1.5, { zone: "front", corridor: k });
        const b = add(`b${k}`, x, Z0 + L + 1.5, { zone: "back", corridor: k });
        let prev = f;
        for (let i = 0; i < stops; i++) {
          const s = add(`c${k}_${i}`, x, Z0 + (i + 0.5) * STEP, { zone: "aisle", corridor: k });
          link(prev, s);
          prev = s;
        }
        link(prev, b);
        if (prevFront) link(prevFront, f);
        if (prevBack) link(prevBack, b);
        prevFront = f;
        prevBack = b;
      }
      const ex = this.cx + 5;
      const entrance = add("entrance", ex, 0.4, { zone: "entrance" });
      const fronts = [...this.nodes.values()].filter((n) => n.zone === "front").sort((a, b) => Math.abs(a.x - ex) - Math.abs(b.x - ex));
      fronts.slice(0, 2).forEach((n) => link(entrance, n));

      // Each bay remembers the closest standing spot.
      for (const bay of this.bays) {
        let best = null;
        let bestD = Infinity;
        for (const n of this.nodes.values()) {
          if (bay.corridor != null && n.corridor !== bay.corridor) continue;
          if (bay.corridor != null && n.zone !== "aisle") continue;
          if (bay.corridor == null && n.zone !== "back") continue;
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

    stockNearby() {
      const near = [];
      for (const b of this.bays) {
        const d = Math.hypot(b.fx - this.pos.x, b.fz - this.pos.z);
        if (b.state === "empty" && d < STOCK_RADIUS) near.push([d, b]);
        else if (b.state !== "empty" && d > UNSTOCK_RADIUS) this.unstock(b);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (const [, b] of near) this.stock(b);
    }

    // Everything put on a bay's shelves lives in bay.stocked, so emptying
    // the bay is one remove plus freeing what it used.
    stock(bay) {
      bay.state = "loading";
      bay.stocked = new THREE.Group();
      bay.group.add(bay.stocked);
      bay.items = [];
      bay.imageUrls = [];
      const token = (bay.token = {});
      const s = this.store.shelf(bay.section.query);
      const done = () => {
        if (this.destroyed || bay.token !== token) return;
        if (s.status === "ready") this.fill(bay, s.products);
        else this.shelfNote(bay, "Couldn't stock this shelf — click to try again", true);
        this.invalidate();
      };
      if (s.status === "loading") s.promise.then(done);
      else done();
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
      m.position.set(0, 1.0, FACE_D + 0.02);
      if (retry) {
        m.userData.retry = bay;
        this.pickables.add(m);
      }
      bay.stocked.add(m);
    }

    fill(bay, products) {
      bay.state = "ready";
      if (!products.length) return this.shelfNote(bay, "Sold out today", false);

      const rows = BOARDS.length;
      const perRow = Math.ceil(products.length / rows);
      const inner = bay.w - 0.12;
      const slotW = inner / perRow;
      const pw = Math.min(0.22, slotW * 0.8);
      const gap = 0.015;
      // Wide shelves get several facings of each product, like a real store.
      const facings = clamp(Math.floor((slotW * 0.92) / (pw + gap)), 1, 4);
      const sideMat = lambert(0xf1f1ee);
      const tagRows = BOARDS.map(() => []);

      products.forEach((p, idx) => {
        const row = Math.floor(idx / perRow);
        const col = idx % perRow;
        const y = BOARDS[row];
        const x0 = -inner / 2 + col * slotW;
        const front = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const mats = [sideMat, sideMat, sideMat, sideMat, front, sideMat];
        const span = facings * pw + (facings - 1) * gap;
        const start = x0 + (slotW - span) / 2 + pw / 2;
        const meshes = [];
        const h0 = pw * 1.3;
        for (let f = 0; f < facings; f++) {
          const m = new THREE.Mesh(unitBox, mats);
          m.scale.set(pw, h0, 0.12);
          m.position.set(start + f * (pw + gap), y + h0 / 2, FACE_D - 0.1);
          m.userData.product = p;
          bay.stocked.add(m);
          this.pickables.add(m);
          meshes.push(m);
        }
        const setHeight = (aspect) => {
          const ht = clamp(pw * aspect, 0.08, 0.5);
          for (const m of meshes) {
            m.scale.y = ht;
            m.position.y = y + ht / 2;
          }
        };
        const token = bay.token;
        if (p.image) {
          bay.imageUrls.push(p.image);
          acquireTexture(p.image).then(
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
        } else {
          front.map = labelTexture(p.name);
        }
        const item = { p, meshes, front, x0, slotW, y, row };
        bay.items.push(item);
        tagRows[row].push(item);
      });

      tagRows.forEach((items, r) => items.length && this.tagStrip(bay, BOARDS[r], items));
      this.refreshBadges();
    }

    // The price tags along the front edge of one shelf.
    tagStrip(bay, y, items) {
      const cw = Math.min(4096, Math.round(bay.w * PX_PER_M));
      const ch = Math.round(TAG_H * PX_PER_M);
      const px = (m) => ((m + bay.w / 2) / bay.w) * cw;
      const tex = canvasTexture(cw, ch, (g) => {
        g.fillStyle = "#8d959c";
        g.fillRect(0, 0, cw, ch);
        for (const it of items) {
          const tw = Math.min(it.slotW * 0.94, 0.34) * (cw / bay.w);
          const tx = px(it.x0) + (it.slotW * (cw / bay.w) - tw) / 2;
          g.fillStyle = "#fff";
          g.fillRect(tx, 4, tw, ch - 8);
          g.fillStyle = "#ffd84a";
          g.fillRect(tx, 4, 8, ch - 8);
          g.fillStyle = "#56605a";
          g.textBaseline = "alphabetic";
          g.textAlign = "left";
          g.fillText(fit(g, it.p.name, tw - 22, 14, 500, 10), tx + 14, 22);
          g.fillStyle = "#1d2320";
          const price = it.p.price == null ? "See price" : `$${it.p.price.toFixed(2)}`;
          g.fillText(fit(g, price, tw * 0.62, it.p.price == null ? 18 : 34, 900, 12), tx + 14, ch - 14);
          if (it.p.unitPrice) {
            g.fillStyle = "#56605a";
            g.textAlign = "right";
            g.fillText(fit(g, it.p.unitPrice, tw * 0.36, 12, 500, 8), tx + tw - 6, ch - 16);
          }
        }
      });
      const m = plane(tex, bay.w, TAG_H);
      m.position.set(0, y - TAG_H / 2, FACE_D + 0.003);
      m.userData.tags = { bay, items };
      bay.stocked.add(m);
      this.pickables.add(m);
    }

    refreshBadges() {
      for (const bay of this.bays) {
        for (const it of bay.items) {
          const qty = this.store.basket.get(it.p.id)?.qty || 0;
          if (it.badgeQty === qty) continue;
          it.badgeQty = qty;
          if (it.badge) {
            bay.stocked.remove(it.badge);
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
          s.position.set(it.x0 + it.slotW / 2, it.y + 0.04, FACE_D + 0.02);
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
        this.bays.find((b) => b.face.place === place && b.face.sideIndex === sideIndex && b.index + b.face.offset === sectionIndex) ||
        this.bays.find((b) => b.face.place === place && b.face.sideIndex === sideIndex) ||
        this.bays.find((b) => b.face.place === place);
      if (!bay) return;
      this.walkTo(bay.node, { lookAt: { x: bay.x, z: bay.z }, flash: bay });
    }

    goToEntrance() {
      this.walkTo(this.nodes.get("entrance"), { lookAt: { x: this.nodes.get("entrance").x, z: 10 } });
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
        const x = hit.uv.x * u.tags.bay.w - u.tags.bay.w / 2;
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
        const dx = b.x - this.pos.x;
        const dz = b.z - this.pos.z;
        const d = Math.hypot(dx, dz);
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
        title = c.label + (c.number ? ` · ${c.sub}` : "");
        const bayAt = (face) => {
          const list = this.bays.filter((b) => b.face === face);
          return list.sort((a, b) => Math.abs(a.z - n.z) - Math.abs(b.z - n.z))[0];
        };
        if (Math.abs(look.z) > 0.6) {
          const [l, r] = look.z > 0 ? [c.left, c.right] : [c.right, c.left];
          sides = [`◀ ${bayAt(l).section.name}`, `${bayAt(r).section.name} ▶`];
        }
      } else if (n.zone === "back") title = "Back of the store · Bakery · Meat & Seafood";
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
      if (bay && bay.face.place) this.store.goToFlat(bay.face.place, bay.face.sideIndex, bay.index + bay.face.offset);
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
      for (let j = 0; j < 3; j++) g.fillRect(X(this.cx - 2 - j * 2.8) - 2, Y(1.1), 4, 2.4 * sz);
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
        this.raf = requestAnimationFrame(loop);
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
      this.renderer.dispose();
      // Browsers allow only a handful of live WebGL contexts per page, so
      // give this one back now rather than whenever it's garbage collected.
      this.renderer.forceContextLoss();
    }
  }

  S.Walk3D = Walk3D;
  S.Walk3D.supported = supported;
})();
