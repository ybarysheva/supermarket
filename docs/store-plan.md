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

- Real-store shelf density: a 1.2 m section holds 50–100 products.
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
