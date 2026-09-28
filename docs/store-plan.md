# Store plan

How Supermarket Mode's store is laid out, what the fixtures are, and how
every product in a real grocery catalog finds a place on a shelf.

## How it fits together

- **Our category list** (`src/layout.js`): about 150 grocery categories
  (Cereal, Yogurt, Frozen Pizza…). Each one knows its aisle, its fixture and
  how much shelf space it gets. The list is the same for every store,
  because grocery categories are nearly the same everywhere.
- **The floor plan**: fixed aisles and departments, like a real supermarket.
- **One translation table per store**: e.g. "Amazon Fresh: Fresh Fruit →
  our Fruit". Anything unmapped goes to **More to explore**, so every
  product has a place. A shelf with no matching store category falls back
  to a keyword search (what shelves did before categories).

## Floor plan (full size)

Standard US design: fresh food around the walls, packaged goods in the
middle, dairy at the back so you pass everything else on the way.

```
 ┌──────────── BACK WALL ─────────────────────────────┐
 │ DAIRY │ SEAFOOD │ MEAT │ PREPARED │ DELI │ BAKERY   │
 ├───────┴─────────┴──────┴──────────┴──────┴─────────┤
 │ D  │ FROZEN │ More │ 12 11 … 2 1 │ PRODUCE          │
 │ R  │ (glass │  to  │ center      │ (tables, misted  │
 │ I  │ doors) │explore│ aisles     │  greens, bread   │
 │ N  │        │      │             │  racks on wall)  │
 │ K  │        │      │             │                  │
 │ S  │ ice cream chests            │                  │
 ├────┴──────────────┬──────────────┴──────────────────┤
 │ CHECKOUT LANES    │                  ENTRANCE ⇩      │
 └───────────────────┴──────────────────────────────────┘
```

Center aisles: 1 Breakfast & coffee · 2 Baking & spices · 3 Soup & canned
· 4 Pasta, rice & beans · 5 International · 6 Condiments, oils & dressings
· 7 Snacks · 8 Cookies, crackers & candy · 9 Water, soda & drinks
· 10 Household & paper · 11 Health & personal care · 12 Baby & pet.

Beer & wine: not in the first version (sold only in some areas, needs ID
at delivery). Space is kept for it; until then Amazon's alcohol goes to
More to explore.

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
  per produce crate), so a 1.2 m section with 5 shelves holds 25.
- Fixed shelf space per category; if the store has more products than
  fit, the last section gets a "More →" tag that restocks with the next
  page while you stand there.
- Best sellers at eye level; less popular on high and low shelves.
- Shelves fill as you walk up, the one you're heading to first, two
  requests to the store at a time; far shelves are emptied to save memory.

## Phases

1. **New store and fixtures.** New floor plan and category list; shelves
   still filled by keyword searches.
2. **Category shelves.** Amazon translation table, More to explore.
3. **Full shelves.** Real density, "More →" restocking, eye-level order.
4. **Polish.** Aisle-end deals, seasonal display, flowers.

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

## Phase 2: category shelves (built)

In `src/adapters/amazon.js`:

1. **Departments** come from the browse bar on the store's front page
   (`…_aislesNode__…` links, each with `data-browse-node-id`). If it can't
   be read, Amazon Fresh's known list is used.
2. **Subcategories** are read lazily: the first time a shelf in a place is
   stocked, the department pages that place lives in are read
   (`…_categoryNode__…` entries). Each page is read once, even when several
   shelves need it at the same moment, and the tree is kept for a week.
3. **Which departments a place lives in** is a short table (`DEPARTMENTS`):
   produce → Produce, aisle 1 → Breakfast / Beverages / Pantry, and so on.
   Departments that belong to one place entirely (Produce, Dairy, Frozen…)
   are marked `whole`.
4. **Matching**: each subcategory is scored against a shelf's name and
   keywords (strong) and its side's label (weak); the best one wins.
5. **Searching**: a shelf searches its words within its subcategory, then
   its whole department (if `whole`), then all of the store, stopping at
   the first that returns 4 or more products. A shelf named like a whole
   department (Office & School) also searches that department. If the
   words find little anywhere, the shelf shows its category's own
   products instead (no search words).
6. **More to explore**: subcategories no shelf searches within get their
   own shelves in the More to explore aisle (up to 16), filled by browsing
   the category with no search words. This grows as departments are read.

If a match turns out wrong in real use, the fix is a keyword on our side or
an entry in `DEPARTMENTS`, not a store-specific table.

## Phase 3: full shelves (built)

1. **Spacing**: every product gets a fixed slot (20 cm; 30 cm for a crate),
   one of each, packed left to right starting at eye level. A bay holds
   `slots per shelf × shelves`; shelves not needed yet stay empty.
2. **Pages**: a shelf's first 24 products come as before. While you stand
   at a shelf ("Looking at"), its next page is fetched before the shelves
   around you, and then the next, until the bay is full or the category
   runs out. Amazon: `&page=N`; the total comes from "1-24 of 119 results"
   and the Next button says whether there's another page.
3. **More ▸**: if a category has more products than its bay holds, a yellow
   tag under the eye-level price tags shows which ones are up ("1–25 of
   119") and puts up the next ones, back to the first after the last. The
   new stock goes up before the old comes down, so nothing flickers. The
   flat view has a "More from this shelf" button.
4. **Looking at** only counts shelves whose front faces you (the shelf
   behind the shelving you're facing no longer wins).
5. **Checkout check**: Amazon can answer OK and still drop an item, so
   checkout reads the cart back, retries missing items once with a freshly
   looked-up Add button, and lists what's still missing.
