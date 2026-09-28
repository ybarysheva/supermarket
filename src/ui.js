// The supermarket overlay: an entrance, a floor map, aisles with shelves and
// price tags, a shopping cart you push around, and a paper shopping list.
//
// It renders into a shadow root so the host site's CSS can't reach in (and
// ours can't leak out). Usage:
//
//   Supermarket.open({ stores: ["fresh", "wholefoods"], cssText | cssHref, onClose })
(function () {
  const S = (window.Supermarket = window.Supermarket || {});

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  S.h = h;

  // Shelf searches waiting on the store at once. Stores throttle bursts of
  // searches (Amazon answers with a captcha), so walk the aisles politely.
  const MAX_REQUESTS = 2;
  const shelfKey = (section) => section.id || section.query;
  const MAX_MORE = 16; // extra category shelves in More to explore

  const money = (n) => `$${n.toFixed(2)}`;

  // Shelf-tag style price: big dollars, small raised cents.
  function tagPrice(p) {
    if (p.price == null) return h("span", { class: "sm-price-missing" }, "See price");
    const [d, c] = p.price.toFixed(2).split(".");
    return h("span", { class: "sm-price" }, h("span", { class: "sm-price-cur" }, "$"), d, h("sup", {}, c));
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode etc. — the trip just won't be remembered */
    }
  }

  // "eggs" should tick off when "Large Eggs, 12 ct" goes in the cart.
  function listItemMatches(itemText, productName) {
    const name = productName.toLowerCase();
    const words = itemText.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    if (!words.length) return false;
    return words.every((w) => name.includes(w) || (w.length > 3 && w.endsWith("s") && name.includes(w.slice(0, -1))));
  }

  class Store {
    constructor(opts) {
      this.opts = opts;
      this.view = "entrance";
      this.use3d = !!(S.Walk3D && S.Walk3D.supported()) && opts.use3d !== false;
      this.place = null;
      this.side = 0;
      this.focus = null;
      this.lastAsk = null;
      this.shelves = new Map();
      this.requests = { active: 0, queue: [] };
      this.basket = new Map();
      this.list = load("supermarket:list", []);
      this.listOpen = false;
      this.cartOpen = false;

      this.host = h("div", { id: "supermarket-overlay-host" });
      this.root = this.host.attachShadow({ mode: "open" });
      this.addStyles(opts);

      this.el = {
        app: h("div", { class: "sm-app" }),
        top: h("header", { class: "sm-top" }),
        main: h("main", { class: "sm-main" }),
        list: h("aside", { class: "sm-list", "aria-label": "Shopping list" }),
        cart: h("div", { class: "sm-cart" }),
        modal: h("div", { class: "sm-modal", hidden: true }),
        toast: h("div", { class: "sm-toast", role: "status" }),
      };
      const e = this.el;
      e.app.append(e.top, e.main, e.list, e.cart, e.modal, e.toast);
      this.root.append(e.app);

      this.onKey = this.onKey.bind(this);
    }

    // Constructed stylesheets aren't subject to the host page's Content
    // Security Policy. Where they can't be used, fall back to a <style>.
    addStyles({ cssText, cssHref }) {
      if (cssText) {
        try {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(cssText);
          this.root.adoptedStyleSheets = [sheet];
          return;
        } catch {
          this.root.append(h("style", {}, cssText));
          return;
        }
      }
      if (cssHref) this.root.append(h("link", { rel: "stylesheet", href: cssHref }));
    }

    mount() {
      this.prevOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
      document.body.append(this.host);
      document.addEventListener("keydown", this.onKey, true);

      const stores = this.opts.stores;
      if (this.opts.initialStore) this.enterStore(this.opts.initialStore);
      else if (stores.length === 1) this.enterStore(stores[0]);
      else this.render();
    }

    close() {
      document.removeEventListener("keydown", this.onKey, true);
      if (this.walker) this.walker.destroy();
      this.host.remove();
      document.documentElement.style.overflow = this.prevOverflow;
      if (this.aisleObserver) this.aisleObserver.disconnect();
      if (this.opts.onClose) this.opts.onClose();
    }

    // ---- store & navigation ------------------------------------------------

    enterStore(id) {
      this.adapter = S.adapters[id]();
      this.shelves.clear();
      this.basket = new Map(load(`supermarket:basket:${id}`, []).map((it) => [it.product.id, it]));
      this.fillMoreToExplore();
      if (this.walker) this.walker.destroy();
      this.walker = null;
      // With 3D available you start at the entrance, looking into the store.
      this.view = this.use3d ? "walk" : "map";
      this.render();
    }

    // Categories this store has that none of our shelves cover get their own
    // shelves in More to explore, so every product has a place. The store
    // learns its categories as you shop, so this grows over the first visits.
    fillMoreToExplore() {
      const more = S.place("more");
      if (!more) return;
      const side = more.sides[more.sides.length - 1];
      side.baseSections = side.baseSections || side.sections.slice();
      side.sections = side.baseSections.slice();
      const extra = this.adapter.moreSections ? this.adapter.moreSections(S.allPlaces()) : [];
      side.sections.push(...extra.slice(0, MAX_MORE));
    }

    // Walk to a shelf: in 3D when we can, otherwise the flat shelf view.
    goTo(place, sideIndex = 0, sectionIndex = null) {
      if (this.use3d && place.id !== "special") {
        this.view = "walk";
        this.renderMain();
        if (this.walker) return this.walker.goToSection(place, sideIndex, sectionIndex ?? 0);
      }
      this.goToFlat(place, sideIndex, sectionIndex);
    }

    goToFlat(place, sideIndex = 0, sectionIndex = null) {
      this.place = place;
      this.side = sideIndex;
      this.focus = sectionIndex;
      this.view = "aisle";
      this.renderMain();
      this.el.main.scrollTop = 0;
    }

    // The 3D view couldn't start or lost its graphics context (phones do this
    // under memory pressure). Carry on with the flat shelves.
    fallBackToFlat(reason) {
      console.warn("Supermarket Mode: 3D view unavailable,", reason);
      if (this.walker) this.walker.destroy();
      this.walker = null;
      this.use3d = false;
      this.view = "map";
      this.renderMain();
      this.toast("3D view isn't available here, so here's the store map instead.");
    }

    goMap() {
      this.view = "map";
      this.renderMain();
    }

    ask(phrase) {
      phrase = phrase.trim();
      if (!phrase) return;
      this.lastAsk = phrase;
      const hit = S.findShelf(phrase)[0];
      if (hit) {
        const side = hit.place.sides[hit.sideIndex];
        const sec = side.sections[hit.sectionIndex];
        this.goTo(hit.place, hit.sideIndex, hit.sectionIndex);
        const where = hit.place.sides.length > 1 ? `${hit.place.label}, ${side.label} side` : hit.place.label;
        this.toast(`"${phrase}" → ${where}, ${sec.name} shelf`);
      } else {
        this.searchWholeStore(phrase);
      }
    }

    // When nothing on the floor plan fits, set up a display just for it.
    searchWholeStore(phrase) {
      this.goTo({
        id: "special",
        label: "Special display",
        sign: "🔎",
        sides: [{ label: `"${phrase}"`, sections: [{ name: `Everything matching "${phrase}"`, query: phrase, keywords: [] }] }],
      });
    }

    // ---- shelves -----------------------------------------------------------

    // One shelf's products, fetched once per visit: the first page, then
    // more pages as they're wanted (more()). Every request to the store (3D
    // or flat view) goes through one queue that lets at most two out at a
    // time, first come first served; the 3D view decides what joins the
    // queue next.
    //
    // State: { status, products, total (null: unknown), next (where the
    // next page is; null: that's all) }.
    shelf(section, place) {
      const key = shelfKey(section);
      let s = this.shelves.get(key);
      if (!s || s.status === "error") {
        s = { status: "loading", products: [], total: null, next: null };
        s.promise = this.schedule(() => this.askShelf(section, place)).then(
          (r) => Object.assign(s, { status: "ready" }, r),
          (error) => Object.assign(s, { status: "error", error })
        );
        this.shelves.set(key, s);
      }
      return s;
    }

    async askShelf(section, place, cursor) {
      if (!this.adapter.searchShelf) return { products: await this.adapter.search(section.query), total: null, next: null };
      const r = await this.adapter.searchShelf(section, place, cursor);
      return Array.isArray(r) ? { products: r, total: null, next: null } : { products: r.products, total: r.total ?? null, next: r.next || null };
    }

    // The shelf's next page, added to what it has. Resolves with the shelf
    // state; its `products` becomes a new array when anything was added.
    more(section, place) {
      const s = this.shelfState(section);
      if (!s || s.status !== "ready" || !s.next) return Promise.resolve(s);
      if (!s.morePromise) {
        s.moreError = null;
        s.morePromise = this.schedule(() => this.askShelf(section, place, s.next))
          .then(
            (r) => {
              const have = new Set(s.products.map((p) => p.id));
              const added = r.products.filter((p) => !have.has(p.id));
              if (added.length) s.products = [...s.products, ...added];
              s.total = r.total ?? s.total;
              s.next = added.length ? r.next : null; // a page of repeats: that's all
            },
            (error) => {
              s.moreError = error;
            }
          )
          .then(() => {
            s.morePromise = null;
            return s;
          });
      }
      return s.morePromise;
    }

    shelfState(section) {
      return this.shelves.get(shelfKey(section));
    }

    // Requests waiting on the store or queued to go.
    pendingShelves() {
      return this.requests.active + this.requests.queue.length;
    }

    schedule(fn) {
      return new Promise((resolve, reject) => {
        this.requests.queue.push(() =>
          Promise.resolve()
            .then(fn)
            .then(resolve, reject)
            .finally(() => {
              this.requests.active--;
              this.pumpRequests();
            })
        );
        this.pumpRequests();
      });
    }

    pumpRequests() {
      while (this.requests.active < MAX_REQUESTS && this.requests.queue.length) {
        this.requests.active++;
        this.requests.queue.shift()();
      }
    }

    // ---- basket ------------------------------------------------------------

    saveBasket() {
      save(`supermarket:basket:${this.adapter.id}`, [...this.basket.values()]);
    }

    putInCart(product, qty = 1) {
      const item = this.basket.get(product.id);
      if (item) item.qty += qty;
      else this.basket.set(product.id, { product, qty });
      this.saveBasket();

      let ticked = false;
      for (const li of this.list) {
        if (!li.done && listItemMatches(li.text, product.name)) {
          li.done = true;
          ticked = true;
        }
      }
      if (ticked) {
        save("supermarket:list", this.list);
        this.renderList();
      }

      this.renderCart();
      this.updateBadges();
      this.toast(`In the cart: ${qty > 1 ? qty + " × " : ""}${product.name}${ticked ? " — ticked off your list ✓" : ""}`);
      const btn = this.el.cart.querySelector(".sm-cart-button");
      if (btn) {
        btn.classList.remove("bump");
        void btn.offsetWidth;
        btn.classList.add("bump");
      }
    }

    setQty(id, qty, { keepPanel = false } = {}) {
      if (qty <= 0) this.basket.delete(id);
      else this.basket.get(id).qty = qty;
      this.saveBasket();
      if (keepPanel) {
        // Just refresh the count on the cart button; leave the open panel as is.
        const { count, total, unpriced } = this.basketTotals();
        const btn = this.el.cart.querySelector(".sm-cart-button");
        if (btn) {
          btn.querySelector(".sm-cart-count").textContent = count;
          btn.querySelector(".sm-cart-total").textContent = money(total) + (unpriced ? "+" : "");
        }
      } else this.renderCart();
      this.updateBadges();
    }

    basketTotals() {
      let count = 0;
      let total = 0;
      let unpriced = 0;
      for (const { product, qty } of this.basket.values()) {
        count += qty;
        if (product.price == null) unpriced += qty;
        else total += product.price * qty;
      }
      return { count, total, unpriced };
    }

    updateBadges() {
      if (this.walker) this.walker.refreshBadges();
      for (const el of this.el.main.querySelectorAll("[data-pid]")) {
        const item = this.basket.get(el.getAttribute("data-pid"));
        const badge = el.querySelector(".sm-in-cart");
        badge.textContent = item ? `${item.qty} in cart` : "";
        badge.hidden = !item;
      }
    }

    async checkout() {
      const items = [...this.basket.values()];
      if (!items.length) return;
      const panel = this.el.cart.querySelector(".sm-cart-panel");
      const status = h("p", { class: "sm-scanning" }, "Scanning items…");
      panel.replaceChildren(h("h2", {}, "Checkout lane"), status);

      const failed = [];
      const fail = (it, message) => {
        it.manual = message || "Add this one on its product page.";
        failed.push({ ...it, message });
      };
      let added = [];
      for (let i = 0; i < items.length; i++) {
        status.textContent = `Scanning item ${i + 1} of ${items.length}: ${items[i].product.name}`;
        const r = await this.adapter.addToCart(items[i].product, items[i].qty);
        if (r.ok) added.push(items[i]);
        else fail(items[i], r.message);
      }

      // Check the store's cart really has them. Anything missing is tried
      // once more with a freshly looked-up Add button, then checked again.
      if (added.length && this.adapter.missingFromCart) {
        status.textContent = "Checking your cart…";
        for (let round = 0; round < 2 && added.length; round++) {
          const missing = await this.adapter.missingFromCart(added.map((it) => it.product.id));
          if (!missing || !missing.length) break;
          const retry = added.filter((it) => missing.includes(it.product.id));
          added = added.filter((it) => !missing.includes(it.product.id));
          for (const it of retry) {
            if (round === 1) {
              fail(it, `${this.adapter.name} didn't take this one. Add it on its page.`);
              continue;
            }
            status.textContent = `Scanning again: ${it.product.name}`;
            const r = await this.adapter.addToCart(it.product, it.qty, { fresh: true });
            if (r.ok) added.push(it);
            else fail(it, r.message);
          }
        }
      }
      for (const it of added) this.basket.delete(it.product.id);
      this.saveBasket();
      this.updateBadges();

      const cartUrl = this.adapter.cartUrl();
      if (!failed.length && cartUrl) {
        status.textContent = `All ${items.length} items are in your ${this.adapter.name} cart. Taking you to pay…`;
        location.href = cartUrl;
        return;
      }

      const total = items.reduce((t, it) => t + (it.product.price || 0) * it.qty, 0);
      const removeFailed = (f, li) => {
        this.setQty(f.product.id, 0, { keepPanel: true });
        li.remove();
      };
      panel.replaceChildren(
        ...[
        h("h2", {}, cartUrl ? "Almost done" : "Receipt"),
        !cartUrl && h("div", { class: "sm-receipt" }, items.map((it) => h("div", {}, h("span", {}, `${it.qty} × ${it.product.name}`), h("span", {}, it.product.price == null ? "—" : money(it.product.price * it.qty)))), h("div", { class: "sm-receipt-total" }, h("span", {}, "TOTAL"), h("span", {}, money(total)))),
        !cartUrl && h("p", {}, "Thanks for practising! This is the demo store, so nothing was bought."),
        failed.length > 0 && h("p", {}, `${failed.length} item${failed.length > 1 ? "s" : ""} couldn't be scanned automatically. Open each one and add it on its page:`),
        failed.length > 0 &&
          h("ul", { class: "sm-failed" },
            failed.map((f) => {
              const li = h("li", {},
                h("div", {},
                  h("a", { href: f.product.url, target: "_blank", rel: "noopener" }, `${f.qty} × ${f.product.name} ↗`),
                  f.message && h("small", {}, f.message)
                ),
                h("button", { class: "sm-ghost sm-remove", onclick: () => removeFailed(f, li), title: "Take it out of this cart" }, "Remove")
              );
              return li;
            })
          ),
        failed.length > 0 && h("p", { class: "sm-fine" }, "They stay in your cart here until you add them on Amazon or remove them."),
        cartUrl && h("a", { class: "sm-primary", href: cartUrl }, `Go to my ${this.adapter.name} cart`),
        h("button", { class: "sm-secondary", onclick: () => this.renderCart() }, "Back to shopping"),
        ].filter(Boolean)
      );
    }

    // ---- shopping list -----------------------------------------------------

    addToList(text) {
      const lines = text.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
      for (const t of lines) this.list.push({ id: Date.now() + Math.random(), text: t, done: false });
      save("supermarket:list", this.list);
      this.renderList();
      if (this.view === "map") this.renderMain(); // refresh the list pins
    }

    // Store walking order, so the list reads like a route through the store.
    locate(text) {
      const hit = S.findShelf(text)[0];
      if (!hit) return { order: Infinity };
      const placeIndex = S.allPlaces().indexOf(hit.place);
      return { ...hit, order: placeIndex * 1000 + hit.sideIndex * 100 + hit.sectionIndex };
    }

    // ---- rendering ---------------------------------------------------------

    render() {
      this.renderTop();
      this.renderMain();
      this.renderList();
      this.renderCart();
    }

    renderTop() {
      const inStore = !!this.adapter;
      const input = h("input", { type: "search", placeholder: "Excuse me, where's the…", "aria-label": "Ask where something is" });
      this.el.top.replaceChildren(
        h("button", { class: "sm-brand", onclick: () => inStore && this.goMap(), title: "Store map" }, h("span", { class: "sm-brand-icon" }, "🛒"), h("span", {}, inStore ? this.adapter.name : "Supermarket")),
        inStore &&
          h(
            "form",
            { class: "sm-ask", onsubmit: (e) => { e.preventDefault(); this.ask(input.value); input.blur(); } },
            h("span", { class: "sm-ask-icon", "aria-hidden": "true" }, "🙋"),
            input,
            h("button", { type: "submit" }, "Ask")
          ),
        h("div", { class: "sm-top-actions" },
          inStore && this.opts.stores.length > 1 && h("button", { class: "sm-ghost", onclick: () => { this.adapter = null; this.view = "entrance"; this.render(); } }, "Switch store"),
          inStore && h("button", { class: "sm-ghost", onclick: () => { this.listOpen = !this.listOpen; this.renderList(); } }, "📝 List"),
          h("button", { class: "sm-ghost sm-exit", onclick: () => this.close(), title: "Leave the supermarket and go back to the regular site" }, "Leave ✕")
        )
      );
    }

    renderMain() {
      const m = this.el.main;
      m.className = `sm-main view-${this.view}`;
      if (this.view !== "walk" && this.walker) this.walker.stop();
      if (this.aisleObserver) {
        this.aisleObserver.disconnect();
        this.aisleObserver = null;
      }
      if (this.view === "walk") {
        if (!this.walker) {
          try {
            this.walker = new S.Walk3D(this);
          } catch (e) {
            return this.fallBackToFlat(e);
          }
        }
        m.replaceChildren(this.walker.el);
        this.walker.start();
      } else if (this.view === "entrance") m.replaceChildren(this.renderEntrance());
      else if (this.view === "map") m.replaceChildren(this.renderMap());
      else m.replaceChildren(...this.renderAisle().filter(Boolean));
      if (this.view === "aisle") this.afterAisleMounted();
    }

    renderEntrance() {
      return h(
        "div",
        { class: "sm-entrance" },
        h("div", { class: "sm-storefront" },
          h("div", { class: "sm-storefront-sign" }, "SUPERMARKET"),
          h("div", { class: "sm-doors" }, h("div", { class: "sm-door" }), h("div", { class: "sm-door" }))
        ),
        h("h1", {}, "Where are we shopping today?"),
        h("div", { class: "sm-store-choices" },
          this.opts.stores.map((id) => {
            const a = S.adapters[id]();
            return h("button", { class: "sm-store-choice", onclick: () => this.enterStore(id) }, h("strong", {}, a.name), h("span", {}, a.tagline), h("em", {}, "Walk in →"));
          })
        )
      );
    }

    renderMap() {
      const plan = S.LAYOUT.plan;
      const P = S.place;

      // How many unticked list items live in each place — shown as a pin.
      const pins = new Map();
      for (const li of this.list) {
        if (li.done) continue;
        const loc = this.locate(li.text);
        if (loc.place) pins.set(loc.place, (pins.get(loc.place) || 0) + 1);
      }
      const pin = (place) => pins.get(place) && h("span", { class: "sm-pin", title: "Things from your list" }, `📝 ${pins.get(place)}`);

      const deptTile = (place, sideIndex = 0) =>
        h("button", { class: `sm-dept zone-${place.zone}`, onclick: () => this.goTo(place, sideIndex) },
          h("span", { class: "sm-dept-icon" }, place.sign || place.number),
          h("span", { class: "sm-dept-name" }, place.label),
          h("span", { class: "sm-dept-sub" }, place.sides[sideIndex].sections.map((s) => s.name).slice(0, 3).join(" · ")),
          pin(place)
        );

      const aisleTile = (place) =>
        h("button", { class: `sm-aisle-tile${place.cold ? " cold" : ""}`, onclick: () => this.goTo(place), title: place.label },
          h("span", { class: "sm-aisle-num" }, place.number),
          h("span", { class: "sm-aisle-contents" }, place.sides.map((s) => h("span", {}, s.label))),
          pin(place)
        );

      // Back wall, left to right; one tile per department.
      const back = [];
      for (const [id] of plan.back) if (back[back.length - 1] !== P(id)) back.push(P(id));

      return h("div", { class: "sm-map" },
        h("p", { class: "sm-map-hint" }, "Tap a department or aisle to walk over. Ask at the top if you can't find something."),
        h("div", { class: "sm-floor" },
          h("div", { class: "sm-back-row" }, back.map((p) => deptTile(p))),
          h("div", { class: "sm-middle" },
            h("div", { class: "sm-wall-col" }, deptTile(P("dairy"), 1), deptTile(P("drinks"))),
            plan.corridors.filter((c) => c.place).map((c) => aisleTile(P(c.place))),
            h("div", { class: "sm-wall-col wide" }, deptTile(P("bakery")), deptTile(P("produce")))
          ),
          h("div", { class: "sm-front-row" },
            h("button", { class: "sm-checkout-tile", onclick: () => this.toggleCart(true) }, "🧾 Checkout lanes"),
            h(this.use3d ? "button" : "div", { class: "sm-door-mat", onclick: this.use3d ? () => { this.view = "walk"; this.renderMain(); this.walker?.goToEntrance(); } : null }, h("span", {}, "🚪"), " Entrance", h("small", {}, this.use3d ? "Walk in from the door" : "You are here"))
          )
        )
      );
    }

    renderAisle() {
      const place = this.place;
      const side = place.sides[this.side];
      const places = S.allPlaces();
      const idx = places.indexOf(place);
      const prev = idx > 0 ? places[idx - 1] : null;
      const next = idx >= 0 && idx < places.length - 1 ? places[idx + 1] : null;

      const sign = h("div", { class: `sm-hanging-sign${place.cold ? " cold" : ""}` },
        h("div", { class: "sm-hanging-num" }, place.number || place.sign),
        h("div", { class: "sm-hanging-body" },
          h("div", { class: "sm-hanging-title" }, place.label),
          h("div", { class: "sm-hanging-list" }, place.sides.map((s, i) => h("span", { class: i === this.side ? "here" : "" }, s.label)))
        )
      );

      const turn =
        place.sides.length > 1 &&
        h("button", { class: "sm-turn", onclick: () => { this.side = (this.side + 1) % place.sides.length; this.focus = null; this.renderMain(); } },
          "↻ Turn around to ", h("strong", {}, place.sides[(this.side + 1) % place.sides.length].label)
        );

      const run = h("div", { class: "sm-run", tabindex: "0", "aria-label": `${side.label} shelves` },
        side.sections.map((sec, i) => this.renderBay(sec, i)),
        h("div", { class: "sm-endcap" },
          next ? h("button", { onclick: () => this.goToFlat(next) }, "End of aisle", h("strong", {}, `Walk to ${next.label} →`)) : h("button", { onclick: () => this.goMap() }, "End of the store", h("strong", {}, "Back to the map"))
        )
      );
      this.run = run;

      const walk = h("div", { class: "sm-walk" },
        h("button", { onclick: () => this.walk(-1), "aria-label": "Walk back" }, "◀"),
        h("span", {}, "Walk along the shelves (or use ← → keys)"),
        h("button", { onclick: () => this.walk(1), "aria-label": "Walk forward" }, "▶")
      );

      const ask =
        this.lastAsk &&
        place.id !== "special" &&
        h("p", { class: "sm-not-here" }, `Not seeing "${this.lastAsk}"? `, h("button", { class: "sm-link", onclick: () => this.searchWholeStore(this.lastAsk) }, "Search the whole store for it"));

      const nav = h("nav", { class: "sm-aisle-nav" },
        prev ? h("button", { onclick: () => this.goToFlat(prev) }, `← ${prev.label}`) : h("span"),
        h("button", { class: "sm-map-btn", onclick: () => this.goMap() }, "🗺️ Store map"),
        next ? h("button", { onclick: () => this.goToFlat(next) }, `${next.label} →`) : h("span")
      );

      const walk3d =
        this.use3d &&
        place.id !== "special" &&
        h("button", { class: "sm-turn", onclick: () => this.goTo(place, this.side, this.focus ?? 0) }, "🚶 Walk here in 3D");

      return [h("div", { class: "sm-aisle-head" }, sign, turn, walk3d), ask, run, walk, nav];
    }

    renderBay(sec, i) {
      const shelves = h("div", { class: "sm-bay-shelves" });
      const bay = h("section", { class: "sm-bay", "data-bay": String(i) }, h("header", { class: "sm-bay-sign" }, sec.name), shelves);
      bay.stock = () => this.stockBay(shelves, sec);
      return bay;
    }

    stockBay(container, sec) {
      if (container.dataset.stocked) return;
      container.dataset.stocked = "1";
      const s = this.shelf(sec, this.place);
      const draw = () => {
        if (s.status === "ready") {
          const more =
            s.next &&
            h("button", {
              class: "sm-secondary sm-more",
              onclick: (e) => {
                e.currentTarget.disabled = true;
                e.currentTarget.textContent = "Stocking…";
                this.more(sec, this.place).then(() => container.isConnected && draw());
              },
            }, `More from this shelf (${s.products.length}${s.total ? ` of ${s.total}` : "+"})`);
          container.replaceChildren(...this.renderShelves(s.products), ...[more].filter(Boolean));
        }
        else if (s.status === "error") {
          container.replaceChildren(
            h("div", { class: "sm-out-of-stock" },
              h("strong", {}, "Couldn't stock this shelf"),
              h("span", {}, s.error.message),
              h("button", { onclick: () => { delete container.dataset.stocked; this.stockBay(container, sec); } }, "Try again")
            )
          );
        }
      };
      if (s.status === "loading") {
        container.replaceChildren(...[0, 1, 2].map(() => h("div", { class: "sm-shelf loading" }, [0, 1, 2].map(() => h("div", { class: "sm-item ghost" })))));
        s.promise.then(() => container.isConnected && draw());
      } else draw();
    }

    renderShelves(products) {
      if (!products.length) {
        return [h("div", { class: "sm-out-of-stock" }, h("strong", {}, "Empty shelf"), h("span", {}, "Nothing here right now — try asking at the top."))];
      }
      const perRow = Math.min(8, Math.max(2, Math.ceil(products.length / 3)));
      const rows = [];
      for (let i = 0; i < products.length; i += perRow) rows.push(products.slice(i, i + perRow));
      return rows.map((row) => h("div", { class: "sm-shelf" }, row.map((p) => this.renderItem(p))));
    }

    renderItem(p) {
      const inCart = this.basket.get(p.id);
      return h("div", { class: "sm-item", "data-pid": p.id },
        h("button", { class: "sm-pack", onclick: () => this.openProduct(p), title: `Pick up: ${p.name}` },
          p.image ? h("img", { src: p.image, alt: "", loading: "lazy" }) : h("span", { class: "sm-pack-blank" }, "🛒"),
          h("span", { class: "sm-in-cart", hidden: !inCart }, inCart ? `${inCart.qty} in cart` : "")
        ),
        h("div", { class: "sm-tag" },
          h("div", { class: "sm-tag-name" }, p.name),
          h("div", { class: "sm-tag-row" },
            tagPrice(p),
            h("button", { class: "sm-grab", onclick: () => this.putInCart(p, 1), "aria-label": `Put ${p.name} in cart` }, "+")
          ),
          p.unitPrice && h("div", { class: "sm-tag-unit" }, p.unitPrice)
        )
      );
    }

    afterAisleMounted() {
      const run = this.run;
      const bays = [...run.querySelectorAll(".sm-bay")];
      // Only stock shelves you're about to walk past.
      const io = (this.aisleObserver = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.stock();
              io.unobserve(e.target);
            }
          }
        },
        { root: run, rootMargin: "0px 900px 0px 900px" }
      ));
      bays.forEach((b) => io.observe(b));

      if (this.focus != null && bays[this.focus]) {
        const bay = bays[this.focus];
        bay.stock();
        requestAnimationFrame(() => {
          run.scrollTo({ left: bay.offsetLeft - run.offsetLeft - 24, behavior: "smooth" });
          bay.classList.add("flash");
        });
      }
    }

    walk(dir) {
      if (!this.run) return;
      this.run.scrollBy({ left: dir * Math.max(320, this.run.clientWidth * 0.7), behavior: "smooth" });
    }

    renderList() {
      const e = this.el.list;
      e.classList.toggle("open", this.listOpen && !!this.adapter);
      const input = h("textarea", { rows: "2", placeholder: "Add things… (one per line, or commas)" });
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          this.addToList(input.value);
        }
      });

      const items = this.list.map((li) => ({ li, loc: this.locate(li.text) })).sort((a, b) => a.li.done - b.li.done || a.loc.order - b.loc.order);

      e.replaceChildren(
        h("div", { class: "sm-list-paper" },
          h("header", {}, h("h2", {}, "Shopping list"), h("button", { class: "sm-ghost", onclick: () => { this.listOpen = false; this.renderList(); }, "aria-label": "Put list away" }, "✕")),
          h("p", { class: "sm-list-hint" }, "Sorted in the order you'll walk past things."),
          h("ul", {},
            items.map(({ li, loc }) => {
              const where = loc.place
                ? h("button", { class: "sm-where", onclick: () => { this.lastAsk = li.text; this.putListAwayOnPhones(); this.goTo(loc.place, loc.sideIndex, loc.sectionIndex); } }, `${loc.place.label} · ${loc.place.sides[loc.sideIndex].sections[loc.sectionIndex].name}`)
                : h("button", { class: "sm-where unknown", onclick: () => { this.putListAwayOnPhones(); this.ask(li.text); } }, "Ask for it");
              const box = h("input", { type: "checkbox", "aria-label": `Got ${li.text}` });
              box.checked = li.done;
              box.addEventListener("change", () => { li.done = box.checked; save("supermarket:list", this.list); this.renderList(); });
              return h("li", { class: li.done ? "done" : "" }, h("label", {}, box, h("span", {}, li.text)), !li.done && where);
            })
          ),
          h("form", { class: "sm-list-add", onsubmit: (ev) => { ev.preventDefault(); this.addToList(input.value); } }, input, h("button", { type: "submit" }, "Add")),
          this.list.some((l) => l.done) && h("button", { class: "sm-link", onclick: () => { this.list = this.list.filter((l) => !l.done); save("supermarket:list", this.list); this.renderList(); } }, "Cross off & remove got items")
        )
      );
      if (this.listOpen) setTimeout(() => input.focus(), 0);
    }

    // On a phone the list covers the whole store, so put it in your pocket.
    putListAwayOnPhones() {
      if (window.innerWidth > 760) return;
      this.listOpen = false;
      this.renderList();
    }

    toggleCart(open = !this.cartOpen) {
      this.cartOpen = open;
      this.renderCart();
    }

    renderCart() {
      const e = this.el.cart;
      if (!this.adapter) return e.replaceChildren();
      const { count, total, unpriced } = this.basketTotals();
      const button = h("button", { class: "sm-cart-button", onclick: () => this.toggleCart() },
        h("span", { class: "sm-cart-icon" }, "🛒"),
        h("span", { class: "sm-cart-count" }, count),
        h("span", { class: "sm-cart-total" }, money(total), unpriced ? "+" : "")
      );
      e.classList.toggle("open", this.cartOpen);
      if (!this.cartOpen) return e.replaceChildren(button);

      const items = [...this.basket.values()];
      const panel = h("div", { class: "sm-cart-panel" },
        h("header", {}, h("h2", {}, "Your cart"), h("button", { class: "sm-ghost", onclick: () => this.toggleCart(false), "aria-label": "Close cart" }, "✕")),
        !items.length && h("p", { class: "sm-empty" }, "Your cart is empty. Pick things up off the shelves!"),
        items.length > 0 &&
          h("ul", { class: "sm-cart-items" },
            items.map(({ product: p, qty, manual }) =>
              h("li", {},
                p.image ? h("img", { src: p.image, alt: "" }) : h("span"),
                h("div", { class: "sm-cart-name" },
                  p.name,
                  p.price != null && h("small", {}, `${money(p.price)} each`),
                  manual && h("small", { class: "sm-manual" }, "Couldn't add automatically: ", h("a", { href: p.url, target: "_blank", rel: "noopener" }, "add it on its page ↗"))
                ),
                h("div", { class: "sm-stepper" },
                  h("button", { onclick: () => this.setQty(p.id, qty - 1), "aria-label": "One fewer" }, qty === 1 ? "🗑" : "−"),
                  h("span", {}, qty),
                  h("button", { onclick: () => this.setQty(p.id, qty + 1), "aria-label": "One more" }, "+")
                ),
                h("div", { class: "sm-cart-line" }, p.price == null ? "—" : money(p.price * qty))
              )
            )
          ),
        items.length > 0 && h("div", { class: "sm-cart-sum" }, h("span", {}, `${count} item${count === 1 ? "" : "s"}`), h("strong", {}, money(total)), unpriced > 0 && h("small", {}, `+ ${unpriced} without a shown price`)),
        items.length > 0 && h("button", { class: "sm-primary", onclick: () => this.checkout() }, "Go to the checkout lane"),
        items.length > 0 && this.adapter.cartUrl() && h("p", { class: "sm-fine" }, `At the checkout lane these go into your real ${this.adapter.name} cart, where you pick a delivery time and pay.`)
      );
      e.replaceChildren(panel, button);
    }

    openProduct(p) {
      let qty = 1;
      const qtyEl = h("span", {}, "1");
      const setQ = (n) => { qty = Math.max(1, n); qtyEl.textContent = qty; };
      const m = this.el.modal;
      const close = () => { m.hidden = true; m.replaceChildren(); };
      this.closeModal = close;
      m.replaceChildren(
        h("div", { class: "sm-modal-backdrop", onclick: close }),
        h("div", { class: "sm-closeup", role: "dialog", "aria-label": p.name },
          h("button", { class: "sm-ghost sm-close", onclick: close, "aria-label": "Put it back" }, "✕"),
          h("div", { class: "sm-closeup-img" }, p.image ? h("img", { src: p.image, alt: "" }) : "🛒"),
          h("div", { class: "sm-closeup-body" },
            h("h2", {}, p.name),
            h("div", { class: "sm-tag big" }, h("div", { class: "sm-tag-row" }, tagPrice(p)), p.unitPrice && h("div", { class: "sm-tag-unit" }, p.unitPrice)),
            h("div", { class: "sm-stepper big" },
              h("button", { onclick: () => setQ(qty - 1), "aria-label": "One fewer" }, "−"),
              qtyEl,
              h("button", { onclick: () => setQ(qty + 1), "aria-label": "One more" }, "+")
            ),
            h("button", { class: "sm-primary", onclick: () => { this.putInCart(p, qty); close(); } }, "Put in cart"),
            h("button", { class: "sm-secondary", onclick: close }, "Put it back on the shelf"),
            p.url && p.url !== "#" && h("a", { class: "sm-link", href: p.url, target: "_blank", rel: "noopener" }, "Read the label (ingredients, reviews) ↗")
          )
        )
      );
      m.hidden = false;
      m.querySelector(".sm-primary").focus();
    }

    toast(msg) {
      const t = this.el.toast;
      t.textContent = msg;
      t.classList.add("show");
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
    }

    onKey(e) {
      const target = e.composedPath()[0];
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (e.key === "Escape") {
        if (!this.el.modal.hidden) this.closeModal();
        else if (this.cartOpen) this.toggleCart(false);
        else if (this.listOpen) { this.listOpen = false; this.renderList(); }
        else return;
        e.stopPropagation();
        return;
      }
      // Leave browser shortcuts (Cmd+W, Ctrl+D, …) alone.
      if (typing || !this.el.modal.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
      if (this.view === "walk") {
        if (this.walker && this.walker.onKey(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (this.view !== "aisle") return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      this.walk(e.key === "ArrowRight" ? 1 : -1);
      e.preventDefault();
      e.stopPropagation();
    }
  }

  let current = null;

  S.open = function (opts) {
    if (current) return current;
    current = new Store({
      ...opts,
      onClose() {
        current = null;
        if (opts.onClose) opts.onClose();
      },
    });
    current.mount();
    return current;
  };

  S.isOpen = () => !!current;
  S.current = () => current; // for tests and debugging
  S.close = () => current && current.close();
})();
