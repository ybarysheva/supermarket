// The supermarket overlay: an entrance, a floor map, aisles with shelves and
// price tags, a shopping cart you push around, and a paper shopping list.
//
// It renders into a shadow root so the host site's CSS can't reach in (and
// ours can't leak out). Usage:
//
//   Supermarket.open({ stores: ["fresh", "wholefoods"], cssHref, onClose })
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
      this.place = null;
      this.side = 0;
      this.focus = null;
      this.lastAsk = null;
      this.shelves = new Map();
      this.basket = new Map();
      this.list = load("supermarket:list", []);
      this.listOpen = false;
      this.cartOpen = false;

      this.host = h("div", { id: "supermarket-overlay-host" });
      this.root = this.host.attachShadow({ mode: "open" });
      if (opts.cssHref) this.root.append(h("link", { rel: "stylesheet", href: opts.cssHref }));

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
      this.host.remove();
      document.documentElement.style.overflow = this.prevOverflow;
      if (this.opts.onClose) this.opts.onClose();
    }

    // ---- store & navigation ------------------------------------------------

    enterStore(id) {
      this.adapter = S.adapters[id]();
      this.shelves.clear();
      this.basket = new Map(load(`supermarket:basket:${id}`, []).map((it) => [it.product.id, it]));
      this.view = "map";
      this.render();
    }

    goTo(place, sideIndex = 0, sectionIndex = null) {
      this.place = place;
      this.side = sideIndex;
      this.focus = sectionIndex;
      this.view = "aisle";
      this.renderMain();
      this.el.main.scrollTop = 0;
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

    shelf(query) {
      let s = this.shelves.get(query);
      if (!s || s.status === "error") {
        s = { status: "loading" };
        s.promise = this.adapter.search(query).then(
          (products) => Object.assign(s, { status: "ready", products }),
          (error) => Object.assign(s, { status: "error", error })
        );
        this.shelves.set(query, s);
      }
      return s;
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

    setQty(id, qty) {
      if (qty <= 0) this.basket.delete(id);
      else this.basket.get(id).qty = qty;
      this.saveBasket();
      this.renderCart();
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
      for (let i = 0; i < items.length; i++) {
        status.textContent = `Scanning item ${i + 1} of ${items.length}: ${items[i].product.name}`;
        const r = await this.adapter.addToCart(items[i].product, items[i].qty);
        if (r.ok) this.basket.delete(items[i].product.id);
        else failed.push({ ...items[i], message: r.message });
      }
      this.saveBasket();
      this.updateBadges();

      const cartUrl = this.adapter.cartUrl();
      if (!failed.length && cartUrl) {
        status.textContent = `All ${items.length} items are in your ${this.adapter.name} cart. Taking you to pay…`;
        location.href = cartUrl;
        return;
      }

      const total = items.reduce((t, it) => t + (it.product.price || 0) * it.qty, 0);
      panel.replaceChildren(
        h("h2", {}, cartUrl ? "Almost done" : "Receipt"),
        !cartUrl && h("div", { class: "sm-receipt" }, items.map((it) => h("div", {}, h("span", {}, `${it.qty} × ${it.product.name}`), h("span", {}, it.product.price == null ? "—" : money(it.product.price * it.qty)))), h("div", { class: "sm-receipt-total" }, h("span", {}, "TOTAL"), h("span", {}, money(total)))),
        !cartUrl && h("p", {}, "Thanks for practising! This is the demo store, so nothing was bought."),
        failed.length > 0 && h("p", {}, `${failed.length} item${failed.length > 1 ? "s" : ""} couldn't be scanned automatically. Open each one and add it on its page:`),
        failed.length > 0 && h("ul", { class: "sm-failed" }, failed.map((f) => h("li", {}, h("a", { href: f.product.url, target: "_blank", rel: "noopener" }, `${f.qty} × ${f.product.name} ↗`), f.message && h("small", {}, f.message)))),
        cartUrl && h("a", { class: "sm-primary", href: cartUrl }, `Go to my ${this.adapter.name} cart`),
        h("button", { class: "sm-secondary", onclick: () => this.renderCart() }, "Back to shopping")
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
      if (this.view === "entrance") m.replaceChildren(this.renderEntrance());
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
      const L = S.LAYOUT;
      const dept = (id) => L.departments.find((d) => d.id === id);

      // How many unticked list items live in each place — shown as a pin.
      const pins = new Map();
      for (const li of this.list) {
        if (li.done) continue;
        const loc = this.locate(li.text);
        if (loc.place) pins.set(loc.place, (pins.get(loc.place) || 0) + 1);
      }
      const pin = (place) => pins.get(place) && h("span", { class: "sm-pin", title: "Things from your list" }, `📝 ${pins.get(place)}`);

      const deptTile = (d) =>
        h("button", { class: `sm-dept area-${d.id}`, onclick: () => this.goTo(d) },
          h("span", { class: "sm-dept-icon" }, d.sign),
          h("span", { class: "sm-dept-name" }, d.label),
          h("span", { class: "sm-dept-sub" }, d.sides[0].sections.map((s) => s.name).slice(0, 4).join(" · ")),
          pin(d)
        );

      const aisleTile = (a) =>
        h("button", { class: `sm-aisle-tile${a.cold ? " cold" : ""}`, onclick: () => this.goTo(a) },
          h("span", { class: "sm-aisle-num" }, a.label.replace("Aisle ", "")),
          h("span", { class: "sm-aisle-contents" }, a.sides.map((s) => h("span", {}, s.label))),
          pin(a)
        );

      return h("div", { class: "sm-map" },
        h("p", { class: "sm-map-hint" }, "Tap a department or aisle to walk over. Ask at the top if you can't find something."),
        h("div", { class: "sm-floor" },
          ["bakery", "meat", "produce", "dairy", "deli"].map((id) => deptTile(dept(id))),
          h("div", { class: "sm-aisles area-aisles" }, L.aisles.map(aisleTile)),
          h("div", { class: "sm-door-mat area-door" }, h("span", {}, "🚪"), " Entrance", h("small", {}, "You are here")),
          h("button", { class: "sm-checkout-tile area-checkout", onclick: () => this.toggleCart(true) }, "🧾 Checkout lanes")
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
      const isAisle = /^Aisle/.test(place.label);

      const sign = h("div", { class: `sm-hanging-sign${place.cold ? " cold" : ""}` },
        h("div", { class: "sm-hanging-num" }, isAisle ? place.label.replace("Aisle ", "") : place.sign),
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
          next ? h("button", { onclick: () => this.goTo(next) }, "End of aisle", h("strong", {}, `Walk to ${next.label} →`)) : h("button", { onclick: () => this.goMap() }, "End of the store", h("strong", {}, "Back to the map"))
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
        prev ? h("button", { onclick: () => this.goTo(prev) }, `← ${prev.label}`) : h("span"),
        h("button", { class: "sm-map-btn", onclick: () => this.goMap() }, "🗺️ Store map"),
        next ? h("button", { onclick: () => this.goTo(next) }, `${next.label} →`) : h("span")
      );

      return [h("div", { class: "sm-aisle-head" }, sign, turn), ask, run, walk, nav];
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
      const s = this.shelf(sec.query);
      const draw = () => {
        if (s.status === "ready") container.replaceChildren(...this.renderShelves(s.products));
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
      const perRow = Math.max(2, Math.ceil(products.length / 3));
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
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.stock();
              io.unobserve(e.target);
            }
          }
        },
        { root: run, rootMargin: "0px 900px 0px 900px" }
      );
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
                ? h("button", { class: "sm-where", onclick: () => { this.lastAsk = li.text; this.goTo(loc.place, loc.sideIndex, loc.sectionIndex); } }, `${loc.place.label} · ${loc.place.sides[loc.sideIndex].sections[loc.sectionIndex].name}`)
                : h("button", { class: "sm-where unknown", onclick: () => this.ask(li.text) }, "Ask for it");
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
            items.map(({ product: p, qty }) =>
              h("li", {},
                p.image ? h("img", { src: p.image, alt: "" }) : h("span"),
                h("div", { class: "sm-cart-name" }, p.name, p.price != null && h("small", {}, `${money(p.price)} each`)),
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
      if (typing || !this.el.modal.hidden || this.view !== "aisle") return;
      if (e.key === "ArrowRight") { this.walk(1); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { this.walk(-1); e.preventDefault(); }
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
  S.close = () => current && current.close();
})();
