// The store's floor plan, built from the store's own categories: each of
// its departments becomes a department or aisle, and each subcategory a
// shelf (a "section"). Nothing here is a list of products or categories;
// only general supermarket rules about where kinds of departments go and
// what they're displayed on (see docs/store-plan.md).
//
// A place (department or aisle) has sides; a side is one kind of fixture
// (shelving, cooler, freezer, produce table…) holding a run of sections;
// a section is one category. `bays` is how much shelf space it gets.
(function () {
  const S = (window.Supermarket = window.Supermarket || {});

  // ---- general rules -------------------------------------------------------

  // What kind of department is this, by its name. Everything else becomes a
  // center aisle. `skip`: not sold here (alcohol needs ID at delivery and
  // isn't in the first version).
  const ROLES = [
    ["skip", /alcohol|wine|beer|spirits|liquor/],
    ["produce", /produce|fruits? (&|and) veg/],
    ["bakery", /bakery|bread/],
    ["meat", /meat|seafood|fish|poultry|butcher/],
    ["deli", /deli|prepared/],
    ["dairy", /dairy|eggs|cheese/],
    ["frozen", /frozen/],
  ];
  const roleOf = (name) => (ROLES.find(([, re]) => re.test(name.toLowerCase())) || ["aisle"])[0];

  // Which fixture a category goes on inside a fresh department, by its name.
  // The first matching rule wins; `null` is the department's default.
  const FIXTURE_RULES = {
    produce: [
      ["wetrack", /herb|salad|lettuce|greens|spinach|kale/],
      ["cooler", /cut|packaged|juice|tofu|dip|dressing|refrigerated|kit/],
      ["shelf", /nut|seed|dried/],
      ["table", null],
    ],
    bakery: [["rack", /bread|bagel|bun|roll|tortilla|wrap|pita|naan|muffin/], ["case", null]],
    meat: [["counter", null]],
    deli: [["counter", /meat|cheese|olive|antipast|charcuterie/], ["cooler", null]],
    dairy: [["cooler", null]],
    frozen: [["coffin", /novelt|pop|bars?\b|cones?/], ["freezer", null]],
  };
  const fixtureFor = (role, name) => {
    const n = name.toLowerCase();
    return FIXTURE_RULES[role].find(([, re]) => !re || re.test(n))[0];
  };

  const SIGNS = { produce: "🥬", bakery: "🥖", meat: "🥩", deli: "🥪", dairy: "🥛", frozen: "❄" };
  const SIDE_LABELS = { table: "Fruit & Vegetables", wetrack: "Salad & Herbs", cooler: "Refrigerated", shelf: "Nuts & Dried Fruit", rack: "Bread", case: "Cakes & Pastries", coffin: "Ice Cream Chests" };
  const MAX_PER_SIDE = 8; // sections on one side of a center aisle

  // ---- building ------------------------------------------------------------

  // Words a shopper might ask for: "Nut & Seed Butters" → "nut", "seed
  // butters", "butter"…
  const STOP = new Set(["and", "the", "for", "fresh", "food", "foods", "more", "other", "all", "your", "products", "items", "supplies", "care", "essentials"]);
  function keywordsFor(name) {
    const n = name.toLowerCase();
    const parts = n.split(/\s*(?:&|,|\band\b|\/)\s*/).map((p) => p.trim()).filter((p) => p.length > 2 && !STOP.has(p));
    const words = n.split(/[^a-z]+/).filter((w) => w.length > 3 && !STOP.has(w));
    const singular = words.map((w) => (/ies$/.test(w) ? w.slice(0, -3) + "y" : /[^s]s$/.test(w) ? w.slice(0, -1) : w));
    return [...new Set([...parts, ...words, ...singular])];
  }

  const slug = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // A department's shelves: its subcategories, or the department itself if
  // it has none.
  function sectionsOf(dept, placeId) {
    const cats = dept.subs && dept.subs.length ? dept.subs : [{ node: dept.node, name: dept.name }];
    return cats.map((c) => ({
      id: `${placeId}/${slug(c.name)}-${c.node}`,
      name: c.name,
      query: "",
      keywords: keywordsFor(c.name),
      department: dept.name,
      departmentNode: dept.node,
      category: { node: c.node, name: c.name },
      bays: 1,
    }));
  }

  // Split a list into n runs of about the same length.
  function split(list, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(list.slice(Math.round((i * list.length) / n), Math.round(((i + 1) * list.length) / n)));
    return out.filter((r) => r.length);
  }

  // `catalog`: the store's departments, in its own order:
  // [{ node, name, subs: [{ node, name }] }]. Returns { places, plan }.
  function buildLayout(catalog) {
    const places = [];
    const byRole = { produce: [], bakery: [], meat: [], deli: [], dairy: [], frozen: [], aisle: [] };
    for (const d of catalog) {
      const role = roleOf(d.name);
      if (role !== "skip") byRole[role].push(d);
    }

    // A fresh department: one place, its sections sorted onto fixtures.
    // Returns the place, or null if the store doesn't have one.
    const fresh = (role) => {
      const depts = byRole[role];
      if (!depts.length) return null;
      const sections = depts.flatMap((d) => sectionsOf(d, role));
      const groups = new Map();
      // Seafood gets its own counter, on ice.
      const seafood = (name) => role === "meat" && /fish|seafood|shrimp|salmon|shellfish|crab|lobster|scallop/.test(name.toLowerCase());
      for (const s of sections) {
        const f = fixtureFor(role, s.name) + (seafood(s.name) ? "|Seafood" : "");
        if (!groups.has(f)) groups.set(f, []);
        groups.get(f).push(s);
      }
      const place = {
        id: role,
        label: depts.map((d) => d.name).join(" · "),
        sign: SIGNS[role],
        zone: role,
        cold: ["dairy", "frozen"].includes(role),
        sides: [],
      };
      for (const [key, secs] of groups) {
        const [fixture, special] = key.split("|");
        const label = special || (role === "meat" || role === "dairy" ? place.label : SIDE_LABELS[fixture] || place.label);
        // Long runs split over two sides, as a real store would; frozen
        // food gets an aisle of its own, with freezers on both sides.
        let n = Math.ceil(secs.length / (fixture === "table" ? 9 : 8));
        if (fixture === "freezer" && secs.length >= 4) n = Math.max(n, 2);
        const runs = fixture === "coffin" ? [secs] : split(secs, n);
        for (const run of runs) place.sides.push({ label, fixture, sections: run });
      }
      places.push(place);
      return place;
    };

    const produce = fresh("produce");
    const bakery = fresh("bakery");
    const meat = fresh("meat");
    const deli = fresh("deli");
    const dairy = fresh("dairy");
    const frozen = fresh("frozen");

    // Center aisles: each department's shelves in runs of up to 8, two runs
    // (the two sides) to an aisle. A small department shares its aisle.
    const runs = [];
    for (const d of byRole.aisle) {
      const secs = sectionsOf(d, "a");
      for (const r of split(secs, Math.ceil(secs.length / MAX_PER_SIDE))) runs.push({ label: d.name, sections: r });
    }
    if (runs.length % 2) {
      // An odd number of sides: split the longest in two.
      const longest = runs.reduce((a, b) => (b.sections.length > a.sections.length ? b : a), runs[0]);
      if (longest && longest.sections.length > 1) {
        const [a, b] = split(longest.sections, 2);
        runs.splice(runs.indexOf(longest), 1, { label: longest.label, sections: a }, { label: longest.label, sections: b });
      }
    }
    const aisles = [];
    for (let i = 0; i < runs.length; i += 2) {
      const n = aisles.length + 1;
      const sides = runs.slice(i, i + 2).map((r) => ({ label: r.label, fixture: "shelf", sections: r.sections }));
      const place = { id: `a${n}`, label: `Aisle ${n}`, number: String(n), zone: "aisle", sides };
      for (const sd of sides) for (const x of sd.sections) x.id = x.id.replace(/^a\//, `a${n}/`);
      aisles.push(place);
      places.push(place);
    }
    // Walking order: fresh food first, center aisles, then cold things.
    places.sort((a, b) => order(a) - order(b));

    // ---- the floor plan ----
    const sidesOf = (place, fixtures) => (place ? place.sides.map((sd, i) => [place.id, i, sd]).filter(([, , sd]) => !fixtures || fixtures.includes(sd.fixture)) : []);
    const ref = ([id, i]) => [id, i];


    // Dairy with more than one run puts its first on the back wall.
    const dairyBack = !!dairy && dairy.sides.length > 1;
    const leftRuns = () => [...sidesOf(dairy).slice(dairyBack ? 1 : 0), ...sidesOf(frozen, ["freezer"])];
    const rightRuns = () => [...sidesOf(produce), ...sidesOf(bakery, ["rack"])];

    // Short runs share a stretch of wall, as in a real store (cut fruit
    // and nuts side by side), so no single category runs down a whole
    // aisle; each stretch faces another across a corridor.
    const pack = (runs) => {
      const faces = [];
      for (const r of runs) {
        const n = r[2].sections.length;
        const last = faces[faces.length - 1];
        if (last && last.n < 5 && last.n + n <= 8) {
          last.refs.push(ref(r));
          last.n += n;
        } else faces.push({ refs: [ref(r)], n });
      }
      // An odd number of stretches: give a shared one's last run its own.
      if (faces.length % 2) {
        const k = faces.findIndex((f) => f.refs.length > 1);
        if (k >= 0) faces.splice(k + 1, 0, { refs: [faces[k].refs.pop()], n: 0 });
      }
      const out = [];
      for (let i = 0; i < faces.length; i += 2) out.push({ left: faces[i].refs, right: faces[i + 1] ? faces[i + 1].refs : [] });
      return out;
    };

    // Left wing: dairy coolers on the wall, then the freezers.
    const leftCorridors = pack(leftRuns()).map((c) => withPlace(c));
    // Right wing, by the entrance: produce and the bread racks.
    const rightCorridors = pack(rightRuns()).map((c) => withPlace({ ...c, wide: true }));

    const corridors = [
      ...leftCorridors,
      ...aisles.slice().reverse().map((a) => ({ place: a.id, left: [[a.id, 0]], right: a.sides[1] ? [[a.id, 1]] : [] })),
      ...rightCorridors,
    ];

    // Back wall, left to right: dairy, meat & seafood, deli, bakery cases.
    const back = [...(dairyBack ? sidesOf(dairy).slice(0, 1) : []), ...sidesOf(meat), ...sidesOf(deli), ...sidesOf(bakery, ["case"])].map(ref);

    // Ice cream chests in the wide aisle along the front, by the freezers.
    const chestSides = sidesOf(frozen, ["coffin"]).map(ref);
    const frozenCorridor = corridors.findIndex((c) => [...c.left, ...c.right].some(([id]) => id === "frozen"));
    const chests = chestSides.length && frozenCorridor >= 0 ? { corridor: frozenCorridor, sides: chestSides } : null;

    // For the flat map: the departments along each side wall.
    const wallPlaces = (cs) => [...new Set(cs.filter((c) => !c.place).flatMap((c) => [...c.left, ...c.right].map(([id]) => id)))];
    const plan = { corridors, back, chests, map: { left: wallPlaces(leftCorridors), right: wallPlaces(rightCorridors).reverse() } };

    for (const p of places) for (const sd of p.sides) for (const x of sd.sections) x.id = x.id || `${p.id}/${slug(x.name)}`;
    return { places, plan };

    // A corridor between two runs of one department is that department's aisle.
    function withPlace(c) {
      const ids = new Set([...c.left, ...c.right].map(([id]) => id));
      if (ids.size === 1 && [...ids][0] === "frozen") return { ...c, place: "frozen" };
      const labels = [...ids].map((id) => places.find((p) => p.id === id).label);
      return { ...c, label: labels.join(" & ") };
    }
  }

  const ORDER = ["produce", "bakery", "deli", "meat", "aisle", "frozen", "dairy"];
  const order = (p) => ORDER.indexOf(p.zone) * 1000 + (Number(p.number) || 0);

  // ---- brands ----------------------------------------------------------------
  //
  // A real shelf keeps each brand together. Product cards don't say the
  // brand, so it's read from the name: against the category's brand list
  // (the Brands filter on the store's search pages) when there is one,
  // otherwise its first word ("Barilla Rigatoni…"), or first two when the
  // first is short ("De Cecco…").
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  S.brandOf = function (name, known = []) {
    const n = norm(name);
    const squashed = n.replace(/ /g, "");
    let best = null;
    for (const b of known) {
      const nb = norm(b);
      if (!nb) continue;
      if (n === nb || n.startsWith(nb + " ")) {
        if (!best || nb.length > norm(best).length) best = b;
        continue;
      }
      // "Justin's Nut Butter" is the brand of "Justins, Almond Butter…".
      const first = nb.split(" ")[0];
      if (!best && first.length >= 4 && (n.startsWith(first + " ") || squashed.startsWith(first))) best = b;
    }
    if (best) return best;
    const words = String(name || "").replace(/,.*$/, "").trim().split(/\s+/);
    return words[0] && words[0].length <= 3 && !/^\d+$/.test(words[0]) && words[1] ? `${words[0]} ${words[1]}` : words[0] || "";
  };

  // The store's own brand sits beside the best seller, as in a real store.
  const STORE_BRAND = /^(365|amazon|happy belly|whole foods|wickedly prime|amazon grocery|amazon fresh|store brand)\b/;

  // Products in shelf order: each brand together, brands in order of their
  // best seller, brands with a single product at the end. Within a brand,
  // the store's order (best sellers first) is kept.
  S.byBrand = function (products) {
    const groups = new Map();
    for (const p of products) {
      const key = norm(p.brand || S.brandOf(p.name)) || p.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const keys = [...groups.keys()];
    const big = keys.filter((k) => groups.get(k).length > 1);
    const own = big.findIndex((k) => STORE_BRAND.test(k));
    if (own > 1) big.splice(1, 0, ...big.splice(own, 1));
    const singles = keys.filter((k) => groups.get(k).length === 1);
    return [...big, ...singles].flatMap((k) => groups.get(k));
  };
  S.brandKey = (p) => norm(p.brand || S.brandOf(p.name));

  // ---- the current store ---------------------------------------------------

  let byId = new Map();
  S.useLayout = function (layout) {
    S.LAYOUT = layout;
    byId = new Map(layout.places.map((p) => [p.id, p]));
    for (const p of layout.places) if (p.id === "frozen") p.number = "❄";
  };
  S.buildLayout = buildLayout;
  S.place = (id) => byId.get(id);

  // Every place, in the order you'd walk the store.
  S.allPlaces = () => (S.LAYOUT ? S.LAYOUT.places : []);

  // Does the keyword appear at the start of a word? "apple" matches "apples"
  // but "corn" doesn't match "unicorn".
  const startsAWord = (q, kw) => {
    for (let i = q.indexOf(kw); i >= 0; i = q.indexOf(kw, i + 1)) if (i === 0 || !/[a-z0-9]/.test(q[i - 1])) return true;
    return false;
  };

  // "Excuse me, where's the peanut butter?" — find the shelf for a phrase.
  // Returns [{ place, sideIndex, sectionIndex, score }] best first.
  S.findShelf = function (phrase) {
    const q = String(phrase || "").toLowerCase().trim();
    if (!q) return [];
    const words = q.split(/\s+/).filter((w) => w.length > 2);
    const hits = [];
    for (const place of S.allPlaces()) {
      place.sides.forEach((side, sideIndex) => {
        side.sections.forEach((sec, sectionIndex) => {
          // Whole-keyword matches always beat partial ones ("bread" is
          // Sandwich Bread, not Breadcrumbs); longer matches beat shorter.
          let score = 0;
          for (const kw of sec.keywords) {
            if (startsAWord(q, kw)) score = Math.max(score, 100 + kw.length);
            else {
              const w = words.find((w) => kw.startsWith(w) || w.startsWith(kw));
              if (w) score = Math.max(score, 5 + Math.min(w.length, kw.length));
            }
          }
          const name = sec.name.toLowerCase();
          if (name === q) score = Math.max(score, 200);
          else if (name.includes(q)) score = Math.max(score, 99 + q.length);
          if (score > 0) hits.push({ place, sideIndex, sectionIndex, score });
        });
      });
    }
    return hits.sort((a, b) => b.score - a.score);
  };
})();
