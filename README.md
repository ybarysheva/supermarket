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
- **Floor map.** Produce by the entrance, bakery and meat along the back
  wall, dairy on the right, and numbered aisles in the middle. Tap a spot to
  walk there.
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

Open `demo.html` in a browser. It's a practice store with made-up
products, and nothing is really bought.

## Install the extension (Chrome, Edge, Brave, Arc)

1. Download this repo (**Code → Download ZIP**) and unzip it.
2. Go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
4. Go to [Amazon Fresh](https://www.amazon.com/alm/storefront?almBrandId=QW1hem9uIEZyZXNo)
   or Whole Foods on Amazon, signed in to your account. A green
   **🛒 Shop like a supermarket** button appears in the corner. You can also
   click the extension's toolbar icon on any Amazon page.

## How it works

The extension doesn't use a server. The shelves are filled by running
ordinary Amazon searches in the background of the page you're already
signed in to, one search per shelf section. For example, the "Spreads"
shelf searches for `peanut butter jam nutella`. Only the shelves you walk
past get loaded, and at most two load at a time, so Amazon doesn't think
you're a bot.

```
src/
  layout.js          the store's floor plan: departments, aisles, shelf sections
  ui.js              the supermarket itself (renders in a shadow DOM)
  walk3d.js          the 3D walk-through (three.js), built from layout.js
  store.css          how it looks
  adapters/
    amazon.js        Amazon Fresh + Whole Foods: search, add to cart, cart link
    demo.js          the pretend practice store
  content.js         adds the button on amazon.com
  background.js      toolbar icon; fetches product photos for the 3D shelves
  vendor/three.min.js  three.js r159 (MIT), bundled because extensions can't load remote code
demo.html            open this to try it offline
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

## Development

```
npm install
npm test        # checks the Amazon parser against test/amazon-fixture.html
```
