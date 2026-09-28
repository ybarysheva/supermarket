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
    const fields = [...form.querySelectorAll("input[name]")]
      .filter((i) => i.type !== "submit" && i.type !== "button")
      .map((i) => [i.name, i.value]);
    if (!fields.length) return null;
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

  function parseResults(html, base) {
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
    return products;
  }

  function makeAdapter(store) {
    const origin = location.origin.includes("amazon.") ? location.origin : "https://www.amazon.com";

    async function fetchResults(query) {
      const url = new URL("/s", origin);
      url.searchParams.set("k", query);
      url.searchParams.set("i", store.searchIndex);
      const html = await throttle(async () => {
        const res = await pageFetch(url.href, { credentials: "include" });
        if (signedOut(res)) throw new Error(SIGN_IN);
        if (!res.ok) throw new Error(`The store didn't answer (HTTP ${res.status}).`);
        return res.text();
      });
      return parseResults(html, origin);
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
        const key = `supermarket:${store.id}:${query}`;
        const cached = cacheGet(key);
        if (cached) return cached;
        const products = await fetchResults(query);
        cacheSet(key, products);
        return products;
      },

      // The add form carries a one-time token that expires, and carts are
      // kept between visits. If the saved form fails (or there isn't one),
      // look the product up again for a fresh form and try once more.
      async addToCart(product, qty) {
        try {
          if (product.addForm) {
            const r = await postForm(product.addForm, qty);
            if (r.ok || r.final) return r;
          }
          const fresh = (await fetchResults(product.id)).find((p) => p.id === product.id);
          if (!fresh || !fresh.addForm) return { ok: false, message: "This one has to be added from its product page." };
          product.addForm = fresh.addForm;
          return await postForm(fresh.addForm, qty);
        } catch (e) {
          return { ok: false, message: e.message };
        }
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
})();
