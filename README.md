# 🛒 Supermarket Mode

A browser extension that turns online grocery shopping back into a **walk
through a supermarket**. It works on **Amazon Fresh** and **Whole Foods
Market** (both on amazon.com).

Online grocery sites make you type searches and scroll long lists. A real
store lets you **walk around and look at the shelves**. Supermarket Mode
lays a store over the grocery site:

- **Walk through it in 3D, like Street View.** You start at the entrance.
  Drag to look around, and click the green arrows on the floor (or anywhere
  on the floor) to walk. Arrow keys / WASD work too. Scroll or pinch to
  zoom in and read the price tags. Click a product on the shelf to pick it
  up. The real products are put on the shelves as you walk up to them.
- **A full-size store.** Produce by the entrance, bakery, deli, meat &
  seafood and dairy around the walls, 12 numbered aisles plus frozen and
  "More to explore" in the middle, about 200 categories in all. Each
  department uses the display it would in a real store: produce tables and
  misted racks, open coolers, glass-door freezers, service counters, bread
  racks, chest freezers. See [docs/store-plan.md](docs/store-plan.md).
- **Floor map.** The whole store from above. Tap a spot to walk there.
- **Flat shelf view.** If 3D is too much (or your computer is slow), tap
  **Flat shelves** to see the same aisle as a flat wall of products.
- **Aisles with shelves.** Each aisle has a hanging sign. Items sit on
  shelves with shelf-edge price tags that show the price and unit price.
  Scroll sideways (or press ← →) to walk along the aisle. Tap **Turn
  around** to see the other side.
- **"Excuse me, where's the…?"** Type what you're after and it takes you to
  the right aisle and shelf, just like asking a store employee.
- **Pick things up.** Tap an item to see it up close and choose how many.
  Tap **+** on its tag to drop one straight into the cart.
- **A shopping cart you push around.** It stays in the corner with a running
  total, like adding up prices in your head.
- **A paper shopping list.** It's sorted in the order you'll walk past
  things, and it shows which aisle each item is in. Items tick themselves
  off when you put them in the cart.
- **Checkout lane.** Everything in your cart goes into your real Amazon
  Fresh or Whole Foods cart. Then you pick a delivery time and pay on
  Amazon as usual.

## Try it without Amazon

Open `playground/index.html` in a browser (it's also at `/playground` on the
website). It's a practice store with made-up products, and nothing is really
bought.

## Install the extension (Chrome, Edge, Brave, Arc)

1. Download this repo (**Code → Download ZIP**) and unzip it somewhere you'll
   keep it; the browser loads the extension from that folder.
2. Go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
4. Go to [Amazon Fresh](https://www.amazon.com/alm/storefront?almBrandId=QW1hem9uIEZyZXNo)
   or Whole Foods on Amazon, signed in to your account. A green
   **🛒 Shop like a supermarket** button appears in the corner. You can also
   click the extension's toolbar icon on any Amazon page.

To update, replace the folder's contents with the new version and click
the ↻ reload arrow on the extension's card in `chrome://extensions`.

### Firefox

Firefox needs one setting different from Chrome, so it gets its own copy.
Run `npm run build:firefox` (needs [Node.js](https://nodejs.org)), which
writes it to `dist/firefox`. Then go to `about:debugging#/runtime/this-firefox`,
click **Load Temporary Add-on…** and pick `dist/firefox/manifest.json`. Firefox asks extensions to request
site access, so the first time, click the extensions (puzzle piece) button
and allow Supermarket Mode on amazon.com. Temporary add-ons are removed
when Firefox restarts; installing permanently needs the add-on to be
signed by Mozilla (free, through addons.mozilla.org).

## Browser support

| Browser | Status |
| --- | --- |
| Chrome, Edge, Brave, Arc, Opera (121+) | Supported, and tested automatically (`test/extension.mjs`) |
| Firefox (128+) | Built for it, not yet tested in Firefox itself |
| Safari (Mac, 16.4+) | Should work, untested; needs packaging as a Safari app with Xcode |

### On phones

The store itself works on phone screens (touch to look around, tap to
walk, pinch to zoom; the layout is tested at iPhone size). The limit is
where extensions can run:

- **iPhone / iPad:** only as a Safari Web Extension, which has to be wrapped
  in an app with Xcode on a Mac. You can run it on your own phone with a
  free Apple account; sharing it means the App Store ($99/year).
- **Android:** Firefox for Android runs extensions. Chrome for Android
  doesn't.
- **The Amazon app** can't be extended at all.

## How it works

The extension doesn't use a server. The shelves are filled by running
ordinary Amazon searches in the background of the page you're already
signed in to, one search per shelf section. For example, the "Peanut
Butter & Spreads" shelf searches for `peanut butter jam nutella`.

Each shelf searches within Amazon's own category for it when it can. The
first time you shop a department, the extension reads that department's
page on Amazon to learn its subcategories (kept for a week), and matches
them to our shelves by name: Cereal searches within Cereals, Apples within
Fresh Fruit. If a category turns out too narrow, the shelf widens to the
whole department, then to all of Amazon Fresh, so it's never emptier than
a plain search. Categories that none of our shelves cover get their own
shelves in the **More to explore** aisle, so every product has a place.

Only the shelves you walk past get loaded, and at most two searches go to
Amazon at a time, so Amazon doesn't think you're a bot.

```
src/
  layout.js          our categories and the floor plan: departments, aisles, sections
  fixtures.js        what each display looks like and where products sit on it
  ui.js              the supermarket itself (renders in a shadow DOM)
  walk3d.js          the 3D walk-through (three.js), built from layout.js
  store.css          how it looks
  adapters/
    amazon.js        Amazon Fresh + Whole Foods: search, add to cart, cart link
    demo.js          the pretend practice store
  content.js         runs on every amazon.com page; kept tiny, adds the button
  background.js      loads the store into the tab when it's opened, handles
                     the toolbar icon, fetches product photos for 3D shelves
  vendor/three.min.js  three.js r159 (MIT), bundled because extensions can't load remote code
index.html           the website's homepage (placeholder for a landing page)
playground/          the demo store; open index.html in a browser
```

### Adding another store (e.g. NetCost)

A store is an *adapter* with three functions: `search(query)`,
`addToCart(product, qty)` and `cartUrl()`. See `src/adapters/amazon.js`.
To add NetCost Market, you would write `src/adapters/netcost.js`, add its
site to `manifest.json`, and list it in `content.js`. You could also give it
its own `layout.js` so the aisles match the real store.

## Known limits

- Amazon changes its page layout often. If shelves come up empty, the
  parser in `src/adapters/amazon.js` probably needs new selectors.
- If Amazon shows a "are you a robot?" check, open any Amazon page, solve
  it, then tap **Try again** on the shelf.
- Some items can't be added from search results. At checkout they're
  listed with a link, so you can add them on their product page.
- Removing an item from your cart *after* checkout has to be done in
  Amazon's own cart.

### Keeping it light

- Ordinary Amazon pages only get `content.js` (a few KB). The 3D engine and
  the rest of the store load when you open it.
- The 3D view only draws when something changes, so standing still costs
  nothing.
- Shelves you've walked more than ~24 m away from are emptied and their
  photos freed; they restock when you come back (from memory, not Amazon).
- Phones draw at 1.5× resolution instead of 3×.
- If the browser takes the 3D view away (phones do under memory pressure),
  the store falls back to the map and flat shelves.
- "Reduce motion" in your system settings turns walking into jumping.

## Development

```
npm install
npx playwright install chromium   # once
npm test
```

The tests run headless Chromium:

- `test/parser.mjs`: the Amazon page parser and add-to-cart requests,
  against `test/amazon-fixture.html` and product cards from a real Amazon
  Fresh search (`test/amazon-fresh-search.html`, scrubbed).
- `test/demo.mjs`: walks through the playground on desktop and phone sizes
  (asking, picking up, the list, checkout, emptying far shelves, idle
  drawing, falling back when 3D dies, reduced motion).
- `test/extension.mjs`: loads the real extension and runs it against a fake
  amazon.com, from the button on the Fresh storefront through checkout.

They also run on GitHub for every push (`.github/workflows/test.yml`).
