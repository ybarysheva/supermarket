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
  const MAX_PER_SECTION = 18;

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
    return { action: new URL(form.getAttribute("action") || "/cart/add-to-cart", base).href, fields };
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
      const unitMatch = text(card).match(/\((\$[\d.,]+\s*\/\s*[^)]{1,24})\)/);
      const img = card.querySelector("img.s-image");
      const link = card.querySelector('a[href*="/dp/"]') || card.querySelector("h2 a");

      products.push({
        id: asin,
        name,
        price: parsePrice(priceText),
        priceText: priceText || "",
        unitPrice: unitMatch ? unitMatch[1].replace(/\s+/g, "") : "",
        image: img ? img.getAttribute("src") : null,
        url: link ? new URL(link.getAttribute("href"), base).href : new URL(`/dp/${asin}`, base).href,
        addForm: readAddForm(card, base),
      });
      if (products.length >= MAX_PER_SECTION) break;
    }
    return products;
  }

  function makeAdapter(store) {
    const origin = location.origin.includes("amazon.") ? location.origin : "https://www.amazon.com";

    return {
      id: store.id,
      name: store.name,
      tagline: store.tagline,

      async search(query) {
        const key = `supermarket:${store.id}:${query}`;
        const cached = cacheGet(key);
        if (cached) return cached;

        const url = new URL("/s", origin);
        url.searchParams.set("k", query);
        url.searchParams.set("i", store.searchIndex);
        const html = await throttle(async () => {
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) throw new Error(`The store didn't answer (HTTP ${res.status}).`);
          return res.text();
        });
        const products = parseResults(html, origin);
        cacheSet(key, products);
        return products;
      },

      async addToCart(product, qty) {
        const form = product.addForm;
        if (!form) {
          return { ok: false, message: "This one has to be added from its product page." };
        }
        const body = new URLSearchParams();
        for (const [name, value] of form.fields) {
          body.append(name, /quantity/i.test(name) ? String(qty) : value);
        }
        if (!form.fields.some(([n]) => /quantity/i.test(n))) body.append("quantity", String(qty));
        try {
          const res = await fetch(form.action, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
          });
          if (!res.ok) return { ok: false, message: `Amazon said no (HTTP ${res.status}).` };
          return { ok: true };
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
