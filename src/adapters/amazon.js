// Adapter for grocery stores that live on amazon.com: Amazon Fresh and
// Whole Foods Market. Both use the same search results page, just with a
// different store filter, so one adapter covers both.
//
// An adapter is anything with:
//   id, name, tagline
//   search(query)            -> Promise<Product[]>
//   addToCart(product, qty)  -> Promise<{ ok, message? }>
//   cartUrl()                -> string
//
// Product: { id, name, price, priceText, unitPrice, image, url, addForm }
(function () {
  const S = (window.Supermarket = window.Supermarket || {});

  const STORES = {
    fresh: {
      id: "fresh",
      name: "Amazon Fresh",
      tagline: "Fresh groceries, delivered",
      searchIndex: "amazonfresh",
      almBrandId: "QW1hem9uIEZyZXNo", // base64("Amazon Fresh")
    },
    wholefoods: {
      id: "wholefoods",
      name: "Whole Foods Market",
      tagline: "Whole Foods, on Amazon",
      searchIndex: "wholefoods",
      almBrandId: "VUZHIFdob2xlIEZvb2Rz", // base64("UFG Whole Foods")
    },
  };

  const CACHE_MINUTES = 30;
  const MAX_PER_SECTION = 60; // a whole results page

  function cacheGet(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const { at, data } = JSON.parse(raw);
      if (Date.now() - at > CACHE_MINUTES * 60 * 1000) return null;
      return data;
    } catch {
      return null;
    }
  }

  function cacheSet(key, data) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
    } catch {
      /* storage full or blocked — fine, just don't cache */
    }
  }

  // Amazon throttles bursts of searches with a captcha, so walk the aisle
  // politely: at most two searches in flight.
  let active = 0;
  const waiting = [];
  function throttle(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            if (waiting.length) waiting.shift()();
          });
      };
      if (active < 2) run();
      else waiting.push(run);
    });
  }

  // Firefox gives content scripts a page-context fetch (see content.js).
  const pageFetch = (...args) => (S.pageFetch || fetch)(...args);

  const signedOut = (res) => /\/ap\/signin/.test(res.url);
  const SIGN_IN = "You're signed out of Amazon. Sign in on amazon.com, then come back.";

  // Only ever link to real web pages, never javascript: or data: URLs.
  function webUrl(href, base) {
    try {
      const u = new URL(href, base);
      return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
    } catch {
      return null;
    }
  }

  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

  function parsePrice(s) {
    const m = String(s || "").replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  }

  // Search result cards carry an "Add" form with the ASIN, offer id and a
  // CSRF token. Grab it so the overlay can put things in the real cart.
  function readAddForm(card, base) {
    const forms = [...card.querySelectorAll("form")];
    const form = forms.find(
      (f) => f.querySelector('input[name*="asin" i]') || /cart/i.test(f.getAttribute("action") || "")
    );
    if (!form) return null;
    const inputs = [...form.querySelectorAll("input[name]")];
    const fields = inputs.filter((i) => i.type !== "submit" && i.type !== "button").map((i) => [i.name, i.value]);
    if (!fields.length) return null;
    // A browser sends the Add button's name too (submit.addToCart), and
    // Amazon may ignore a post without it.
    const submit = inputs.find((i) => i.type === "submit");
    if (submit) fields.push([submit.name, submit.getAttribute("value") || "Submit"]);
    const action = webUrl(form.getAttribute("action") || "/cart/add-to-cart", base);
    return action ? { action, fields } : null;
  }

  // "($1.56/ounce)": Amazon repeats the price inside for screen readers, so
  // read the number from its price element and the unit from the text.
  function unitPriceOf(card) {
    for (const el of card.querySelectorAll(".a-color-secondary")) {
      const unit = text(el).match(/\/\s*([A-Za-z][A-Za-z .]{0,20}?)\s*\)/);
      const price = el.querySelector(".a-price .a-offscreen");
      if (unit && price) return `${text(price)}/${unit[1].trim()}`;
    }
    const plain = text(card).match(/\((\$[\d.,]+\s*\/\s*[^)]{1,24})\)/);
    return plain ? plain[1].replace(/\s+/g, "") : "";
  }

  // "1-24 of 119 results for…" (or "of over 1,000"): how many there are in all.
  function totalOf(doc) {
    for (const el of doc.querySelectorAll('[data-component-type="s-result-info-bar"] span, h1 span, .s-breadcrumb span')) {
      const m = text(el).match(/(?:^|\s)of\s+(?:over\s+)?([\d,]+)\s+results/i);
      if (m) return Number(m[1].replace(/,/g, ""));
    }
    return null;
  }

  // One page of search results: { products, total, more }. `more`: there's
  // another page after this one.
  function parsePage(html, base) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (doc.querySelector('form[action*="validateCaptcha"]')) {
      const err = new Error("Amazon wants to check you're human. Open any Amazon page, solve the check, then come back.");
      err.captcha = true;
      throw err;
    }
    const cards = doc.querySelectorAll('[data-component-type="s-search-result"][data-asin]');
    const products = [];
    for (const card of cards) {
      const asin = card.getAttribute("data-asin");
      if (!asin) continue;
      if (card.querySelector(".puis-sponsored-label-text, .s-sponsored-label-text")) continue;

      const name = text(card.querySelector("h2")) || text(card.querySelector("[data-cy='title-recipe']"));
      if (!name) continue;

      const priceEl = card.querySelector(".a-price:not(.a-text-price) .a-offscreen");
      const priceText = text(priceEl);
      const img = card.querySelector("img.s-image");
      const link = card.querySelector('a[href*="/dp/"]') || card.querySelector("h2 a");

      products.push({
        id: asin,
        name,
        price: parsePrice(priceText),
        priceText: priceText || "",
        unitPrice: unitPriceOf(card),
        image: img ? webUrl(img.getAttribute("src"), base) : null,
        url: (link && webUrl(link.getAttribute("href"), base)) || new URL(`/dp/${encodeURIComponent(asin)}`, base).href,
        addForm: readAddForm(card, base),
      });
      if (products.length >= MAX_PER_SECTION) break;
    }
    const total = totalOf(doc);
    const next = doc.querySelector(".s-pagination-next");
    const more = next ? !next.matches(".s-pagination-disabled, [aria-disabled='true']") : total != null && total > cardsBefore(doc, cards.length);
    return { products, total, more };
  }

  // How many results come before the end of this page ("25-48 of 119" → 48).
  function cardsBefore(doc, count) {
    for (const el of doc.querySelectorAll('[data-component-type="s-result-info-bar"] span, h1 span, .s-breadcrumb span')) {
      const m = text(el).match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)\s+of/);
      if (m) return Number(m[2].replace(/,/g, ""));
    }
    return count;
  }

  const parseResults = (html, base) => parsePage(html, base).products;

  // ---- the store's own categories ----------------------------------------
  //
  // Amazon Fresh sorts every product into departments (Produce, Pantry
  // Staples…) and subcategories (Fresh Fruit, Nut & Seed Butters…). Each
  // department page has a bar listing its subcategories. We read those
  // pages lazily (the first time a shelf in that department is needed),
  // keep them for a week, and give each shelf of ours the subcategory that
  // matches it best, so its search stays within the right part of the store.

  const CATEGORY_DAYS = 7;

  // Where each of our places lives among Amazon's departments (matched by
  // name). `whole`: every product in that department belongs to the place,
  // so a shelf with no better match can still search within it.
  const DEPARTMENTS = {
    produce: { names: ["produce"], whole: true },
    bakery: { names: ["bakery"], whole: true },
    deli: { names: ["deli"], whole: true },
    meat: { names: ["meat"], whole: true },
    dairy: { names: ["dairy"], whole: true },
    frozen: { names: ["frozen"], whole: true },
    drinks: { names: ["beverage"] },
    a1: { names: ["breakfast", "beverage", "pantry"] },
    a2: { names: ["pantry"] },
    a3: { names: ["pantry"] },
    a4: { names: ["pantry"] },
    a5: { names: ["pantry"] },
    a6: { names: ["pantry"] },
    a7: { names: ["snack"] },
    a8: { names: ["snack", "pantry"] },
    a9: { names: ["beverage"] },
    a10: { names: ["household"] },
    a11: { names: ["personal care", "health"] },
    a12: { names: ["baby", "pet"] },
    more: { names: ["office"] },
  };

  // If a store's front page can't be read, Amazon Fresh's departments as of
  // September 2026 (see docs/store-plan.md).
  const FRESH_DEPARTMENTS = [
    ["6506977011", "Produce"], ["18787303011", "Pantry Staples"], ["371460011", "Dairy, Eggs & Cheese"],
    ["371469011", "Meat & Seafood"], ["16318751", "Breads & Bakery"], ["16322721", "Snack Foods"],
    ["18773724011", "Deli & Prepared Foods"], ["6459122011", "Frozen Foods"], ["16310231", "Beverages"],
    ["16310251", "Breakfast Foods"], ["15342811", "Household"], ["3760911", "Personal Care"],
    ["2619533011", "Pet"], ["3760941", "Health & Wellness"], ["10787321", "Baby Food & Care"],
    ["1064954", "Office & School"],
  ].map(([node, name]) => ({ node, name }));

  // Amazon's browse bar, on every store page: departments are "aisles"
  // (class …_aislesNode__…, plus the current one, …_categoryNodeDesktop__…)
  // and the current department's subcategories are …_categoryNode__….
  // Each carries its category id in data-browse-node-id (or id="x<id>").
  function browseBar(html, selector) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = [];
    const seen = new Set();
    for (const el of doc.querySelectorAll(selector)) {
      const link = el.getAttribute("data-node-link") || "";
      const node = el.getAttribute("data-browse-node-id") || (el.id.match(/^x(\d+)$/) || [])[1] || (link.match(/[?&]node=(\d+)/) || [])[1];
      const name = text(el) || el.querySelector("img[alt]")?.getAttribute("alt") || "";
      if (!node || !name || name.length > 50 || seen.has(node) || /^featured$/i.test(name)) continue;
      seen.add(node);
      out.push({ node, name });
    }
    return out;
  }

  const parseDepartments = (html) => browseBar(html, '[class*="_aislesNode__"], [class*="_categoryNodeDesktop__"]');
  const parseSubcategories = (html, deptNode) => browseBar(html, '[class*="_categoryNode__"]').filter((c) => c.node !== deptNode);

  // Words that say what a category is ("Fresh" and "&" don't).
  const STOP = new Set(["fresh", "and", "the", "for", "foods", "food", "more", "other", "all", "your"]);
  const words = (s) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const sameWord = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

  // Where a shelf should search, narrowest first: its best-matching
  // subcategory, then its whole department when that department belongs to
  // it entirely (Produce, Dairy…). Empty means search the whole store.
  // `tree` is { departments: [{ node, name, subs: [{ node, name }] }] }.
  function categoryChain(section, place, tree) {
    if (section.category) return [section.category];
    const hint = place && DEPARTMENTS[place.id];
    if (!hint || !tree) return [];
    const depts = tree.departments.filter((d) => hint.names.some((n) => d.name.toLowerCase().includes(n)));
    const side = place.sides.find((sd) => sd.sections.includes(section));
    const strong = words([section.name, ...section.keywords].join(" "));
    const weak = side ? words(side.label) : [];
    let best = null;
    let bestScore = 0;
    for (const d of depts) {
      for (const sub of d.subs || []) {
        const score = words(sub.name).reduce((t, w) => t + (strong.some((x) => sameWord(x, w)) ? 2 : weak.some((x) => sameWord(x, w)) ? 1 : 0), 0);
        if (score > bestScore) {
          best = sub;
          bestScore = score;
        }
      }
    }
    const chain = [];
    if (best) chain.push(best);
    // A shelf named like a whole department (Office & School) searches it too.
    const named = depts.find((d) => words(d.name).reduce((t, w) => t + (strong.some((x) => sameWord(x, w)) ? 2 : 0), 0) >= 2);
    if (hint.whole && depts.length) chain.push(depts[0]);
    else if (named) chain.push(named);
    return chain.filter((c, i) => chain.indexOf(c) === i);
  }

  const categoryFor = (section, place, tree) => categoryChain(section, place, tree)[0] || null;

  // Subcategories no shelf searches within, for More to explore.
  function unclaimed(tree, places) {
    if (!tree) return [];
    const claimed = new Set();
    for (const place of places) for (const side of place.sides) for (const sec of side.sections) {
      const cat = categoryFor(sec, place, tree);
      if (cat) claimed.add(cat.node);
    }
    const out = [];
    for (const d of tree.departments) for (const sub of d.subs || []) if (!claimed.has(sub.node)) out.push({ ...sub, department: d.name });
    return out;
  }

  function makeAdapter(store) {
    const origin = location.origin.includes("amazon.") ? location.origin : "https://www.amazon.com";


    // The store's category tree, read lazily and kept for a week:
    // { at, departments: [{ node, name, subs: null | [{ node, name }] }] }
    const treeKey = `supermarket:categories:${store.id}`;
    let tree = loadTree();

    function loadTree() {
      try {
        const t = JSON.parse(localStorage.getItem(treeKey));
        if (t && Date.now() - t.at < CATEGORY_DAYS * 86400000) return t;
      } catch {
        /* no stored tree */
      }
      return null;
    }

    function saveTree() {
      try {
        localStorage.setItem(treeKey, JSON.stringify(tree));
      } catch {
        /* full or blocked: it'll be read again next time */
      }
    }

    async function fetchPage(url) {
      const res = await throttle(() => pageFetch(url, { credentials: "include" }));
      if (signedOut(res)) throw new Error(SIGN_IN);
      if (!res.ok) throw new Error(`The store didn't answer (HTTP ${res.status}).`);
      return res.text();
    }

    // Pages being read right now, shared by every shelf that needs them.
    const reading = new Map();
    const once = (key, fn) => {
      if (!reading.has(key)) reading.set(key, fn().finally(() => reading.delete(key)));
      return reading.get(key);
    };

    function departments() {
      return tree ? Promise.resolve(tree) : once("departments", readDepartments);
    }

    async function readDepartments() {
      let depts = [];
      try {
        depts = parseDepartments(await fetchPage(`${origin}/alm/storefront?almBrandId=${store.almBrandId}`));
      } catch {
        /* fall back below */
      }
      if (depts.length < 5 && store.id === "fresh") depts = FRESH_DEPARTMENTS;
      tree = { at: Date.now(), departments: depts.map((d) => ({ ...d, subs: null })) };
      saveTree();
      return tree;
    }

    // Make sure the departments a place lives in have their subcategories.
    async function ensureTreeFor(place) {
      const hint = place && DEPARTMENTS[place.id];
      if (!hint) return tree;
      await departments();
      const needed = tree.departments.filter((d) => !d.subs && hint.names.some((n) => d.name.toLowerCase().includes(n)));
      await Promise.all(needed.map((d) => once(d.node, () => readSubcategories(d))));
      return tree;
    }

    async function readSubcategories(d) {
      try {
        d.subs = parseSubcategories(await fetchPage(`${origin}/alm/category/?almBrandId=${store.almBrandId}&node=${d.node}`), d.node);
      } catch {
        d.subs = []; // try again next week
      }
      saveTree();
    }


    async function fetchResults(query, node, page = 1) {
      const url = new URL("/s", origin);
      if (query) url.searchParams.set("k", query);
      url.searchParams.set("i", store.searchIndex);
      if (node) url.searchParams.set("rh", `n:${node}`);
      if (page > 1) url.searchParams.set("page", String(page));
      return parsePage(await fetchPage(url.href), origin);
    }

    // One page of a search, as { products, total, next }: `next` is where
    // the page after it is, for searchShelf.
    async function cachedResults(query, node, page = 1) {
      const key = `supermarket:${store.id}:${node || ""}:${query}:${page}`;
      let r = cacheGet(key);
      if (!r) {
        r = await fetchResults(query, node, page);
        cacheSet(key, r);
      }
      return { products: r.products, total: r.total ?? null, next: r.more ? { node: node || null, page: page + 1 } : null };
    }

    async function postForm(form, qty) {
      const body = new URLSearchParams();
      for (const [name, value] of form.fields) body.append(name, /quantity/i.test(name) ? String(qty) : value);
      if (!form.fields.some(([n]) => /quantity/i.test(n))) body.append("quantity", String(qty));
      const res = await pageFetch(form.action, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (signedOut(res)) return { ok: false, message: SIGN_IN, final: true };
      if (!res.ok) return { ok: false, message: `Amazon said no (HTTP ${res.status}).` };
      return { ok: true };
    }

    return {
      id: store.id,
      name: store.name,
      tagline: store.tagline,


      async search(query) {
        return (await cachedResults(query)).products;
      },

      // A shelf's products: its words, within its category when we know it.
      // If a category turns out too narrow (under 4 products), widen to the
      // next one, then the whole store, so a wrong match never empties a shelf.
      // Returns { products, total, next }; pass `next` back for the page after.
      async searchShelf(section, place, cursor) {
        if (cursor) return cachedResults(section.query, cursor.node, cursor.page);
        let chain = [];
        try {
          chain = categoryChain(section, place, await ensureTreeFor(place));
        } catch {
          /* no categories: plain search */
        }
        for (const cat of chain) {
          const r = await cachedResults(section.query, cat.node);
          if (r.products.length >= 4 || !section.query) return r;
        }
        const all = await cachedResults(section.query);
        // The words found little anywhere: show the category itself instead
        // (everything in it, the store's best sellers first).
        if (all.products.length < 4 && chain.length) {
          const browse = await cachedResults("", chain[0].node);
          if (browse.products.length > all.products.length) return browse;
        }
        return all;
      },

      // Categories no shelf covers, for the More to explore aisle.
      moreSections(places) {
        return unclaimed(tree, places).map((c) => ({
          id: `more/${store.id}-${c.node}`,
          name: c.name,
          query: "",
          keywords: [c.name.toLowerCase()],
          bays: 1,
          category: c,
        }));
      },

      categoryFor: (section, place) => categoryFor(section, place, tree),

      // The add form carries a one-time token that expires, and carts are
      // kept between visits. If the saved form fails (or there isn't one),
      // look the product up again for a fresh form and try once more.
      // `fresh`: don't trust the saved form, look it up again first.
      async addToCart(product, qty, { fresh = false } = {}) {
        try {
          if (product.addForm && !fresh) {
            const r = await postForm(product.addForm, qty);
            if (r.ok || r.final) return r;
          }
          const found = (await fetchResults(product.id)).products.find((p) => p.id === product.id);
          if (!found || !found.addForm) return { ok: false, message: "This one has to be added from its product page." };
          product.addForm = found.addForm;
          return await postForm(found.addForm, qty);
        } catch (e) {
          return { ok: false, message: e.message };
        }
      },

      // Amazon answers "OK" even when it quietly drops an item (an expired
      // token, say), so after checkout read the cart back: which of these
      // products aren't in it? null if the cart page can't be read.
      async missingFromCart(ids) {
        let html;
        try {
          html = await fetchPage(this.cartUrl());
        } catch {
          return null;
        }
        const listed = /data-asin="[A-Z0-9]+"/.test(html);
        if (!listed && !/cart is empty/i.test(html)) return null;
        return ids.filter((id) => !html.includes(`data-asin="${id}"`));
      },

      cartUrl() {
        return `${origin}/cart/localmarket?almBrandId=${store.almBrandId}`;
      },
    };
  }

  S.adapters = S.adapters || {};
  S.adapters.fresh = () => makeAdapter(STORES.fresh);
  S.adapters.wholefoods = () => makeAdapter(STORES.wholefoods);
  S.adapters._parseAmazonResults = parseResults; // exposed for tests
  S.adapters._parseAmazonPage = parsePage;
  S.adapters._amazonCategories = { parseDepartments, parseSubcategories, categoryFor, categoryChain, unclaimed };
})();
