// The store's fixtures: what each kind of display looks like, and where
// products sit on it. Used by walk3d.js, which places one fixture per shelf
// section along the floor plan in layout.js.
//
// Each fixture is drawn in its own local space: x runs across its width
// (centred on 0), y is up, z runs from the back (0) to the front (depth),
// which faces the shopper.
//
//   depth, height   how much floor it takes and how tall it is
//   build(api, g, w, unit)
//                   draws it into group g, `w` wide; `unit` is the width of
//                   one standard section (posts go between sections)
//   rows            where products go, eye-level rows first:
//                     y, z     where a row's products stand (their base, centre depth)
//                     maxH     tallest product that fits
//                     lean     how far products lean back (0 = upright)
//                     kind     "box" (packages) or "crate" (loose produce)
//                     tag      { y, z, lean } for the row's price tags
//   sign            { y, z } for the section's sign
//   cold            true for fridges and freezers (blue signs)
(function () {
  const S = (window.Supermarket = window.Supermarket || {});

  const METAL = 0xc3c9ce;
  const PANEL = 0xe4e7e9;
  const KICK = 0x6f777d;
  const POST = 0x9aa2a8;
  const WOOD = 0xb98a5c;
  const WOOD_DARK = 0x8a6440;
  const COOLER_BACK = 0x2f373c;
  const COOLER_BODY = 0xf3f4f2;
  const STEEL = 0xd4d9dc;

  // Posts between standard-width sections, so long runs read as real shelving.
  function posts(api, g, w, unit, height, depth, color = POST) {
    const n = Math.max(1, Math.round(w / unit));
    for (let i = 0; i <= n; i++) api.block(g, color, 0.04, height, depth, -w / 2 + (i * w) / n, height / 2, depth / 2, true);
  }

  // Refrigerated case body shared by open coolers and glass-door freezers.
  function coolerBody(api, g, w, unit, f, boardYs) {
    api.block(g, COOLER_BACK, w, f.height, 0.05, 0, f.height / 2, 0.025, true);
    api.block(g, COOLER_BODY, w, 0.34, f.depth - 0.05, 0, 0.17, f.depth / 2, true);
    api.block(g, 0x1f2427, w, 0.08, 0.02, 0, 0.12, f.depth - 0.01);
    api.block(g, COOLER_BODY, w, 0.2, f.depth, 0, f.height - 0.1, f.depth / 2, true);
    api.block(g, 0xffffff, w - 0.04, 0.03, 0.03, 0, f.height - 0.215, f.depth - 0.06, false, true);
    for (const y of boardYs) {
      api.block(g, METAL, w - 0.04, 0.025, f.depth - 0.18, 0, y - 0.0125, (f.depth - 0.1) / 2 + 0.03, true);
      api.block(g, 0xffffff, w - 0.06, 0.012, 0.02, 0, y - 0.03, f.depth - 0.14, false, true);
    }
    posts(api, g, w, unit, f.height - 0.2, f.depth, 0xdadedf);
  }

  const shelfRows = [1.27, 1.62, 0.92, 0.57, 0.19];
  const coolerRows = [1.16, 0.83, 1.49, 0.39];

  const F = {
    // Regular grocery shelving (gondola): five shelves.
    shelf: {
      depth: 0.45,
      height: 2.05,
      rows: shelfRows.map((y) => ({ y, z: 0.33, maxH: y > 1.5 ? 0.36 : 0.31, lean: 0, kind: "box", tag: { y: y - 0.04, z: 0.452, lean: 0 } })),
      sign: { y: 2.2, z: 0.2 },
      build(api, g, w, unit) {
        api.block(g, PANEL, w, this.height, 0.04, 0, this.height / 2, 0.02, true);
        api.block(g, KICK, w, 0.12, this.depth, 0, 0.06, this.depth / 2, true);
        for (const y of shelfRows) api.block(g, METAL, w - 0.02, 0.03, this.depth, 0, y - 0.015, this.depth / 2, true);
        posts(api, g, w, unit, this.height, this.depth);
      },
    },

    // Open-front refrigerated case: dairy, drinks, packaged produce.
    cooler: {
      depth: 0.9,
      height: 2.15,
      cold: true,
      rows: coolerRows.map((y) => ({ y, z: 0.62, maxH: 0.29, lean: 0, kind: "box", tag: { y: y - 0.045, z: 0.77, lean: 0 } })),
      sign: { y: 2.3, z: 0.45 },
      build(api, g, w, unit) {
        coolerBody(api, g, w, unit, this, coolerRows);
      },
    },

    // Reach-in freezer with glass doors: frozen food, ice cream.
    freezer: {
      depth: 0.9,
      height: 2.15,
      cold: true,
      rows: coolerRows.map((y) => ({ y, z: 0.58, maxH: 0.29, lean: 0, kind: "box", tag: { y: y - 0.045, z: 0.77, lean: 0 } })),
      sign: { y: 2.3, z: 0.45 },
      build(api, g, w, unit) {
        coolerBody(api, g, w, unit, this, coolerRows);
        const doors = Math.max(1, Math.round(w / 0.76));
        const dw = w / doors;
        const glassH = this.height - 0.6;
        api.glass(g, w, glassH, 0, 0.35 + glassH / 2, this.depth - 0.01, 0xe6f4ff, 0.2);
        for (let d = 0; d <= doors; d++) api.block(g, 0xb8c2c8, 0.045, glassH, 0.05, -w / 2 + d * dw, 0.35 + glassH / 2, this.depth - 0.01, true);
        for (let d = 0; d < doors; d++) api.block(g, 0x9aa4aa, 0.025, 0.5, 0.04, -w / 2 + d * dw + dw - 0.08, 1.2, this.depth + 0.02);
      },
    },

    // Angled produce table, one side of an island: two tiers of crates.
    table: {
      depth: 0.85,
      height: 1.1,
      rows: [
        { y: 0.8, z: 0.6, maxH: 0.14, lean: 0.38, kind: "crate", crateD: 0.36, tag: { y: 0.66, z: 0.86, lean: 0.25 } },
        { y: 1.0, z: 0.22, maxH: 0.14, lean: 0.38, kind: "crate", crateD: 0.34, tag: { y: 0.66, z: 0.86, lean: 0.25 } },
      ],
      sign: { y: 1.6, z: 0.1 },
      build(api, g, w) {
        api.block(g, WOOD_DARK, w, 0.72, this.depth - 0.05, 0, 0.36, (this.depth - 0.05) / 2, true);
        api.block(g, WOOD, w, 0.04, 0.5, 0, 0.74, 0.62, true);
        api.block(g, WOOD, w, 0.24, 0.1, 0, 0.84, 0.05, true);
        api.block(g, 0x6d8f4e, 0.04, 0.8, 0.04, 0, 1.2, 0.05);
      },
    },

    // Misted wall rack for greens and herbs: three steep tiers under a canopy.
    wetrack: {
      depth: 0.95,
      height: 2.3,
      rows: [
        { y: 1.02, z: 0.46, maxH: 0.12, lean: 0.5, kind: "crate", crateD: 0.3, tag: { y: 0.66, z: 0.94, lean: 0.25 } },
        { y: 0.8, z: 0.72, maxH: 0.12, lean: 0.5, kind: "crate", crateD: 0.3, tag: { y: 0.66, z: 0.94, lean: 0.25 } },
        { y: 1.24, z: 0.2, maxH: 0.12, lean: 0.5, kind: "crate", crateD: 0.3, tag: { y: 0.66, z: 0.94, lean: 0.25 } },
      ],
      sign: { y: 2.45, z: 0.5 },
      build(api, g, w, unit) {
        api.block(g, 0x3f5a47, w, this.height, 0.05, 0, this.height / 2, 0.025, true);
        api.block(g, WOOD_DARK, w, 0.7, this.depth - 0.05, 0, 0.35, (this.depth - 0.05) / 2, true);
        api.block(g, 0x2d4034, w, 0.14, this.depth, 0, this.height - 0.07, this.depth / 2, true);
        api.block(g, 0xffffff, w - 0.05, 0.03, 0.03, 0, this.height - 0.16, this.depth - 0.08, false, true);
        // A little mist hanging over the greens.
        for (let i = 0; i < Math.max(1, Math.round(w / 1.2)); i++) {
          api.glass(g, 0.9, 0.35, -w / 2 + (i + 0.5) * (w / Math.max(1, Math.round(w / 1.2))), 1.55, 0.55, 0xffffff, 0.12);
        }
        posts(api, g, w, unit, this.height, 0.1, 0x2d4034);
      },
    },

    // Bread rack: open wooden shelves.
    rack: {
      depth: 0.55,
      height: 1.9,
      rows: [1.08, 1.42, 0.74, 0.4].map((y) => ({ y, z: 0.36, maxH: 0.3, lean: 0.12, kind: "box", tag: { y: y - 0.04, z: 0.555, lean: 0 } })),
      sign: { y: 2.05, z: 0.25 },
      build(api, g, w, unit) {
        api.block(g, WOOD_DARK, w, this.height, 0.03, 0, this.height / 2, 0.015, true);
        for (const y of [1.42, 1.08, 0.74, 0.4]) api.block(g, WOOD, w - 0.02, 0.035, this.depth, 0, y - 0.0175, this.depth / 2, true);
        api.block(g, WOOD_DARK, w, 0.1, this.depth, 0, 0.05, this.depth / 2, true);
        posts(api, g, w, unit, this.height, this.depth, WOOD_DARK);
      },
    },

    // Service counter with curved glass: meat, seafood, deli.
    counter: {
      depth: 1.35,
      height: 1.4,
      cold: true,
      rows: [
        { y: 0.97, z: 1.02, maxH: 0.2, lean: 1.05, kind: "box", tag: { y: 0.93, z: 1.25, lean: 0.9 } },
        { y: 1.1, z: 0.74, maxH: 0.2, lean: 1.0, kind: "box", tag: { y: 1.06, z: 0.95, lean: 0.9 } },
      ],
      sign: { y: 2.2, z: 0.3 },
      build(api, g, w, unit, opts = {}) {
        const deck = opts.ice ? 0xeef6fb : 0xf4f4f1;
        api.block(g, STEEL, w, 0.92, 0.7, 0, 0.46, 1.0, true); // front body
        api.block(g, 0x2b3033, w, 0.1, 0.02, 0, 0.1, 1.355); // kick
        api.block(g, deck, w - 0.04, 0.03, 0.6, 0, 0.95, 1.0, true); // display deck
        api.block(g, deck, w - 0.04, 0.12, 0.3, 0, 1.03, 0.74, true); // raised back tier
        api.glass(g, w, 0.48, 0, 1.19, 1.24, 0xeaf6ff, 0.18, -0.75); // sloped front glass
        api.glass(g, w, 0.35, 0, 1.4, 0.95, 0xeaf6ff, 0.14, -Math.PI / 2); // top glass
        api.block(g, STEEL, w, 0.92, 0.35, 0, 0.46, 0.2, true); // staff-side counter
        posts(api, g, w, unit, 0.95, 1.3, 0xb8c0c4);
      },
    },

    // Bakery display case: like a counter, in wood.
    case: {
      depth: 1.35,
      height: 1.4,
      rows: [
        { y: 0.97, z: 1.02, maxH: 0.2, lean: 1.05, kind: "box", tag: { y: 0.93, z: 1.25, lean: 0.9 } },
        { y: 1.1, z: 0.74, maxH: 0.2, lean: 1.0, kind: "box", tag: { y: 1.06, z: 0.95, lean: 0.9 } },
      ],
      sign: { y: 2.2, z: 0.3 },
      build(api, g, w, unit) {
        api.block(g, WOOD, w, 0.92, 0.7, 0, 0.46, 1.0, true);
        api.block(g, 0xf6efe2, w - 0.04, 0.03, 0.6, 0, 0.95, 1.0, true);
        api.block(g, 0xf6efe2, w - 0.04, 0.12, 0.3, 0, 1.03, 0.74, true);
        api.glass(g, w, 0.48, 0, 1.19, 1.24, 0xfff6e8, 0.16, -0.75);
        api.glass(g, w, 0.35, 0, 1.4, 0.95, 0xfff6e8, 0.12, -Math.PI / 2);
        api.block(g, WOOD_DARK, w, 0.92, 0.35, 0, 0.46, 0.2, true);
        posts(api, g, w, unit, 0.95, 1.3, WOOD_DARK);
      },
    },

    // Chest freezer: look down through the lids at products lying inside.
    coffin: {
      depth: 1.0,
      height: 0.88,
      cold: true,
      rows: [
        { y: 0.5, z: 0.7, maxH: 0.22, lean: 1.2, kind: "box", tag: { y: 0.84, z: 1.005, lean: 0 } },
        { y: 0.5, z: 0.3, maxH: 0.22, lean: 1.2, kind: "box", tag: { y: 0.53, z: 0.5, lean: 1.25 } },
      ],
      sign: { y: 1.5, z: 0.5 },
      build(api, g, w, unit) {
        api.block(g, 0xf7f8f8, w, 0.45, this.depth, 0, 0.225, this.depth / 2, true);
        api.block(g, 0xf7f8f8, w, 0.43, 0.06, 0, 0.665, 0.03, true);
        api.block(g, 0xf7f8f8, w, 0.43, 0.06, 0, 0.665, this.depth - 0.03, true);
        api.block(g, 0x3b6f9e, w, 0.06, 0.02, 0, 0.84, this.depth + 0.005);
        api.glass(g, w, this.depth - 0.1, 0, 0.87, this.depth / 2, 0xe6f4ff, 0.18, -Math.PI / 2);
        posts(api, g, w, unit, 0.88, this.depth, 0xf7f8f8);
      },
    },
  };

  S.FIXTURES = F;
})();
