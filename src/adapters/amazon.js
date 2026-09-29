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
  const MAX_GROUPS = 16; // sub-category sections read for one shelf

  // Results are kept in memory while the store is open, not in the page's
  // sessionStorage: Amazon's own scripts need that space (a full store's
  // pages filled its 5 MB and Amazon's page started failing).
  const MAX_CACHED = 400;
  const cache = new Map();
  try {
    // Free what earlier versions put there.
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (/^supermarket:(fresh|wholefoods):/.test(k)) sessionStorage.removeItem(k);
    }
  } catch {
    /* blocked: nothing to free */
  }

  function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit || Date.now() - hit.at > CACHE_MINUTES * 60 * 1000) return null;
    return hit.data;
  }

  function cacheSet(key, data) {
    cache.delete(key);
    cache.set(key, { at: Date.now(), data });
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value); // the oldest
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
    // On a store page (its Add buttons post to the store's cart), only
    // products you can add to the store's cart are the store's: others
    // (Amazon's regular cart, or no Add button) are outside sellers, like a
    // $50 celeriac or a dinner spoon. Leave them off the shelf, and
    // anything without a price ("See price": currently unavailable).
    const fresh = (p) => p.addForm && /\/local-market\//.test(p.addForm.action);
    if (products.some(fresh)) {
      for (let i = products.length - 1; i >= 0; i--) if (!fresh(products[i]) || products[i].price == null) products.splice(i, 1);
    }

    // The category's brands, from the sidebar's Brands filter.
    const brands = [...doc.querySelectorAll('[id*="brandsRefinements"] li')]
      .map((li) => text(li.querySelector(".a-size-base.a-color-base") || li))
      .filter((b) => b && b.length < 40 && !/^see (more|all)|^any brand/i.test(b));
    for (const p of products) p.brand = S.brandOf ? S.brandOf(p.name, brands) : "";
    // The sidebar's Department list: the current category in bold, and its
    // sub-categories indented below it, each a link.
    const nav = [...doc.querySelectorAll('#departments li[id^="n/"]')];
    const indent = (li) => Number((li.className.match(/s-navigation-indent-(\d+)/) || [])[1] || 0);
    // Only the links directly under the bold current category, after it; if
    // there's no bold category, the list isn't about this category (it can
    // list other Amazon departments), so there are no sub-categories.
    const current = nav.findIndex((li) => !li.querySelector("a") && li.querySelector(".a-text-bold"));
    const here = current >= 0 ? indent(nav[current]) : -1;
    const children = [];
    for (const li of current >= 0 ? nav.slice(current + 1) : []) {
      if (indent(li) <= here) break;
      if (indent(li) !== here + 1 || !li.querySelector("a")) continue;
      const c = { node: li.id.slice(2), name: text(li.querySelector("a .a-size-base") || li.querySelector("a")) };
      if (/^\d+$/.test(c.node) && c.name) children.push(c);
    }
    const total = totalOf(doc);
    const next = doc.querySelector(".s-pagination-next");
    const more = next ? !next.matches(".s-pagination-disabled, [aria-disabled='true']") : total != null && total > cardsBefore(doc, cards.length);
    // Which category the list is about (the bold one), so a caller can tell
    // whether `children` are really its own sub-categories.
    const here_node = current >= 0 ? nav[current].id.slice(2) : null;
    return { products, total, more, children, here: here_node };
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
  // department page has a bar listing its subcategories. The store's aisles
  // are built from them (layout.js), so the first visit reads every
  // department page; the result is kept for a week.

  const CATEGORY_DAYS = 7;

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

  function makeAdapter(store) {
    const origin = location.origin.includes("amazon.") ? location.origin : "https://www.amazon.com";


    // The store's category tree, read lazily and kept for a week:
    // { at, departments: [{ node, name, subs: null | [{ node, name }] }] }
    const treeKey = `supermarket:catalog:${store.id}`;
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

    // Every department with its subcategories, for building the store.
    async function catalog() {
      await departments();
      const needed = tree.departments.filter((d) => !d.subs);
      await Promise.all(needed.map((d) => once(d.node, () => readSubcategories(d))));
      return tree.departments;
    }

    async function readSubcategories(d) {
      try {
        d.subs = parseSubcategories(await fetchPage(`${origin}/alm/category/?almBrandId=${store.almBrandId}&node=${d.node}`), d.node);
      } catch {
        d.subs = []; // try again next week
      }
      saveTree();
    }


    // `best`: in best-seller order (a shelf), rather than Amazon's default
    // "Featured" order, which for a category with no search words mixes in
    // oddities.
    async function fetchResults(query, node, page = 1, best = false) {
      const url = new URL("/s", origin);
      if (query) url.searchParams.set("k", query);
      url.searchParams.set("i", store.searchIndex);
      if (node) url.searchParams.set("rh", `n:${node}`);
      if (best) url.searchParams.set("s", "exact-aware-popularity-rank");
      if (page > 1) url.searchParams.set("page", String(page));
      const r = parsePage(await fetchPage(url.href), origin);
      // A page with nothing you can add to the store's cart (Office &
      // School's "Presentation Supplies" is all regular Amazon) has
      // nothing from this store on it.
      if (!r.products.some((p) => p.addForm && /\/local-market\//.test(p.addForm.action))) r.products = [];
      return r;
    }

    // One page of a search, as { products, total, next }: `next` is where
    // the page after it is, for searchShelf.
    async function cachedResults(query, node, page = 1, best = false) {
      const key = `supermarket:${store.id}:${node || ""}:${query}:${page}${best ? ":best" : ""}`;
      let r = cacheGet(key);
      if (!r) {
        r = await fetchResults(query, node, page, best);
        cacheSet(key, r);
      }
      return { products: r.products, total: r.total ?? null, children: r.children || [], here: r.here || null, next: r.more ? { node: node || null, page: page + 1, best } : null };
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

      // The store's departments and their subcategories, which the aisles
      // are built from: [{ node, name, subs: [{ node, name }] }].
      catalog,

      // A shelf's products: everything in its category, the store's best
      // sellers first (or a search, for a display of "everything matching").
      // Returns { products, total, next }; pass `next` back for the page after.
      //
      // A category with sub-categories (Fresh Vegetables: Onions, Peppers…)
      // is stocked like a real shelf, one section per sub-category: after
      // the first page, each `next` is a sub-category's best sellers, their
      // products marked with its name (`group`).
      async searchShelf(section, place, cursor) {
        if (cursor && cursor.groups) {
          const g = cursor.groups[cursor.i];
          const c = await cachedResults("", g.node, 1, true);
          const next = cursor.i + 1 < cursor.groups.length ? { ...cursor, i: cursor.i + 1 } : null;
          return { products: c.products.map((p, i) => ({ ...p, group: g.name, groupRank: i })), total: null, next };
        }
        if (cursor) return cachedResults(cursor.query ?? section.query, cursor.node, cursor.page, !!cursor.best);
        const cat = section.category;
        // A category shelf carries its best sellers; a display of
        // "everything matching…" keeps Amazon's relevance order.
        const r = await cachedResults(section.query, cat && cat.node, 1, !!cat);
        // Only when the sidebar is about this category: on some pages it's
        // about all of Amazon Fresh, and its "sub-categories" are whole
        // departments (Frozen, Pantry Staples… under Fruit Snacks).
        if (cat && r.here === String(cat.node) && r.children.length >= 2) return { ...r, next: { groups: r.children.slice(0, MAX_GROUPS), i: 0 } };
        if (r.products.length || !cat) return r;
        // Amazon lists nothing when some categories are browsed directly;
        // search for the category's name instead, within its department,
        // then the whole store.
        const words = cat.name.replace(/&/g, " ").replace(/\s+/g, " ").trim();
        for (const node of [section.departmentNode, null]) {
          if (node === undefined) continue;
          const w = await cachedResults(words, node, 1, true);
          if (w.products.length) return { ...w, next: w.next && { ...w.next, query: words } };
        }
        return r;
      },

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
  S.adapters._amazonCategories = { parseDepartments, parseSubcategories };
})();
