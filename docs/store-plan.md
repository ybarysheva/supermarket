# Store plan

How Supermarket Mode's store is laid out, what the fixtures are, and how
every product in a real grocery catalog finds a place on a shelf.

## How it fits together

- **The store's own categories**: its departments (Produce, Pantry
  Staples, Pet…) and each department's subcategories (Cat Food, Dog
  Treats…). Amazon lists them on its department pages; the first visit
  reads them all (a few seconds) and keeps them for a week.
- **The floor plan is built from them** (`src/layout.js`): each department
  becomes a department or aisle, each subcategory a shelf, using Amazon's
  names. A shelf shows everything in its category, the store's best
  sellers first, so nothing needs matching and every product has a place.
- **General supermarket rules**, not a category list, decide where things
  go and what they're displayed on: a department called "…frozen…" gets
  glass-door freezers, "produce" gets tables by the entrance, meat, deli
  and bakery go around the back wall, and so on. They work for any grocery
  store's names.

## Floor plan

Standard US design: fresh food around the walls, packaged goods in the
middle, dairy at the back so you pass everything else on the way.

```
 ┌──────────── BACK WALL ─────────────────────────────┐
 │ DAIRY │ MEAT & SEAFOOD │ DELI │ BAKERY CASES        │
 ├───────┴────────────────┴──────┴─────────────────────┤
 │ D  │ FROZEN │ N … 3 2 1              │ PRODUCE        │
 │ A  │ (glass │ center aisles: every   │ (tables, misted│
 │ I  │ doors) │ other department, in   │  greens, bread │
 │ R  │        │ the store's own order  │  racks)        │
 │ Y  │ ice cream chests                │                │
 ├────┴──────────────────┬─────────────┴────────────────┤
 │ CHECKOUT LANES        │                  ENTRANCE ⇩   │
 └───────────────────────┴───────────────────────────────┘
```

- **Center aisles**: each department's shelves in runs of up to 8, one run
  per side of an aisle; a big department fills several aisles, two small
  ones share one.
- **Fresh departments** (by name): produce, bakery, meat & seafood, deli,
  dairy, frozen. Inside them, a category's name picks its fixture: herbs
  and salad greens on the misted rack, cut fruit on the cooler, bread on
  racks, cakes in the bakery case, ice cream novelties in the chests,
  seafood on its own counter on ice.
- Beer & wine: not in the first version (sold only in some areas, needs ID
  at delivery), so alcohol departments are left out.

## Fixtures

| Fixture | Used for | How products appear |
|---|---|---|
| Shelving, 5 shelves per 1.2 m section | Center aisles | Rows of packages, best sellers at eye level |
| Angled produce tables with crates | Fruit, vegetables | Piles of loose produce |
| Misted wall racks | Leafy greens, herbs | Bunches in angled crates |
| Open-front coolers | Dairy, drinks, packaged produce, prepared foods | Rows of cartons and bottles |
| Glass-door freezers | Frozen, ice cream | Boxes behind frosted glass |
| Chest freezers | Ice cream bars, novelties | Looking down into the chest |
| Glass service counters | Meat, seafood (on ice), deli | Trays behind curved glass |
| Wooden racks and a bakery case | Bread, pastries | Loaves on racks, pastries on trays |

## Every product, without a giant store

- Real-store shelf spacing: one of each product, about 20 cm each (30 cm
  per produce crate).
- A shelf carries the category's best sellers, as many as fit, like a
  real store's range (a store stocks ~120 pastas, not Amazon's 3,000).
  Anything else is a search away: "Excuse me, where's the…".
- Best sellers at eye level; less popular on high and low shelves.
- Shelves fill as you walk up, the one you're heading to first, two
  requests to the store at a time; far shelves are emptied to save memory.

## Phases

1. **New store and fixtures.** New floor plan and category list; shelves
   still filled by keyword searches.
2. **Category shelves.** Amazon translation table, More to explore.
3. **Full shelves.** Real density, "More →" restocking, eye-level order.
4. **The store's own aisles.** The floor plan is built from the store's
   departments and categories; no category list or translation table.
5. **Polish.** Aisle-end deals, seasonal display, flowers.

## What Amazon Fresh looks like (from a saved Produce page)

- Department pages live at `/alm/category/?almBrandId=…&node=<id>`.
- Top-level departments and their IDs: Produce 6506977011, Pantry Staples
  18787303011, Dairy, Eggs & Cheese 371460011, Meat & Seafood 371469011,
  Breads & Bakery 16318751, Snack Foods 16322721, Deli & Prepared Foods
  18773724011, Frozen Foods 6459122011, Beverages 16310231, Breakfast Foods
  16310251, Household 15342811, Personal Care 3760911, Pet 2619533011,
  Health & Wellness 3760941, Baby Food & Care 10787321, Office & School
  1064954.
- Each department page has a "browse bar" of subcategories
  (`data-node-link="…node=<id>"`). Produce: Fresh Vegetables 16319281,
  Fresh Fruit 16318981, Fresh Cut & Packaged 6507187011, Fresh Herbs
  6507079011, Nuts & Seeds 16322881, Dried Fruits & Vegetables 9865332011.
- Department pages show products in carousels whose add-to-cart buttons
  are script-driven (no form to post), so they're for finding categories,
  not for stocking shelves. Shelves use search results limited to a
  category instead; to confirm with a saved search results page.

## What Amazon Fresh search looks like (from a saved search page)

- Search: `/s?k=<words>&i=amazonfresh`. 24 products per page, and the page
  says the total ("1-24 of 119 results"). `&page=N` for more.
- Every sidebar filter is a search limited by category IDs in `rh`:
  `rh=n:10329849011` is all of Amazon Fresh, and adding a department or
  subcategory narrows it (`rh=n:10329849011,n:18787303011` = Pantry
  Staples). Keywords and categories combine, so a shelf can be "apples
  within Fresh Fruit".
- Other filters in the same `rh` list, useful later: brand (`p_123:`),
  price (`p_36:`), dietary (Organic, Gluten Free, Vegan, Kosher, Keto…),
  SNAP EBT eligible, deals.
- Product cards match what the parser reads. Add-to-cart forms post to
  `/cart/add-to-cart/local-market/<almBrandId>/` with a token, the product,
  its offer and a quantity. Unit prices are written "($1.56/ounce)" with the
  price repeated for screen readers. `test/amazon-fresh-search.html` holds
  scrubbed cards from this page for the parser tests.

## Phase 2: category shelves (replaced by phase 4)

Shelves came from our own list of about 200 categories, each matched by
name to Amazon's subcategories, with keyword searches as a fallback and a
More to explore aisle for categories nothing matched. Mismatches (an
Office & School shelf that found nothing) led to phase 4.

## Phase 3: full shelves (built)

1. **Spacing**: every product gets a fixed slot (20 cm; 30 cm for a crate),
   one of each, packed left to right starting at eye level. A bay holds
   `slots per shelf × shelves`; shelves not needed yet stay empty.
2. **Pages**: a shelf's first 24 products come as before. While you stand
   at a shelf ("Looking at"), its next page is fetched before the shelves
   around you, and then the next, until the bay is full or the category
   runs out. Amazon: `&page=N`; the total comes from "1-24 of 119 results"
   and the Next button says whether there's another page.
3. **More ▸** (removed later: shelves now carry only the best sellers that
   fit): if a category has more products than its bay holds, a yellow
   tag under the eye-level price tags shows which ones are up ("1–25 of
   119") and puts up the next ones, back to the first after the last. The
   new stock goes up before the old comes down, so nothing flickers. The
   flat view has a "More from this shelf" button.
4. **Looking at** only counts shelves whose front faces you (the shelf
   behind the shelving you're facing no longer wins).
5. **Checkout check**: Amazon can answer OK and still drop an item, so
   checkout reads the cart back, retries missing items once with a freshly
   looked-up Add button, and lists what's still missing.

## Phase 4: the store's own aisles (built)

1. **Reading the store**: its front page's browse bar lists the
   departments, and each department page lists its subcategories. All of
   them are read the first time the store opens ("Setting up the
   store…"), two pages at a time, and kept for a week.
2. **Building** (`S.buildLayout(catalog)` in `src/layout.js`): departments
   are sorted into fresh departments and center aisles by name, shelves
   onto fixtures by name, and runs of shelves are paired into corridors.
   A department with no subcategories is one shelf.
3. **Shelves** browse their category (`rh=n:<category>`, no search words).
   Some categories list nothing when browsed directly; then the shelf
   searches for the category's name, within its department, then the
   whole store.
   "Excuse me, where's the…" matches the words of the shelf names.
4. **The demo store** has its own made-up departments and categories in
   the same shape, and is built the same way.

## Brand blocks (built)

- Real shelves keep each brand together in a vertical block. Product
  cards on Amazon don't name the brand, but each search page's sidebar has
  a Brands filter listing the category's brands; product names are matched
  against it ("Justins, Almond Butter…" → Justin's Nut Butter), and
  otherwise the brand is the name's first word (first two when the first
  is short: "De Cecco").
- Order on the shelf (`S.byBrand`): brands in order of their best seller,
  the store's own brand (365, Amazon Grocery…) second, brands with a
  single product at the end. Each brand fills columns top to bottom, eye
  level first, so its best sellers are at eye level; a dark line on the
  price-tag strip marks where brands change.
- Next: sections inside a shelf by sub-category (Spaghetti, Penne…), from
  the same sidebar's department list, fetched in place of more pages of
  the mixed list.
