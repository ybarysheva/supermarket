// A pretend store with made-up products, so the supermarket can be tried
// without an Amazon account (and so the UI can be worked on offline).
(function () {
  const S = (window.Supermarket = window.Supermarket || {});

  // keyword -> [emoji, product names...]
  const CATALOG = [
    ["apple", "🍎", "Honeycrisp Apples", "Gala Apples, 3 lb bag", "Granny Smith Apple", "Organic Fuji Apples", "Bartlett Pears", "Pink Lady Apples"],
    ["banana", "🍌", "Bananas, bunch", "Organic Bananas", "Baby Bananas", "Plantains"],
    ["berr", "🍓", "Strawberries, 1 lb", "Blueberries, 6 oz", "Raspberries, 6 oz", "Blackberries, 6 oz", "Organic Strawberries"],
    ["orange", "🍊", "Navel Oranges", "Lemons, 2 lb bag", "Limes", "Clementines, 3 lb", "Ruby Red Grapefruit"],
    ["grape", "🍇", "Red Seedless Grapes", "Green Grapes", "Cantaloupe", "Mini Watermelon", "Honeydew Melon"],
    ["avocado", "🥑", "Hass Avocados, 4 ct", "Mango", "Pineapple", "Kiwi, 1 lb", "Papaya"],
    ["lettuce", "🥬", "Romaine Hearts", "Baby Spinach, 5 oz", "Spring Mix", "Curly Kale", "Arugula", "Iceberg Lettuce"],
    ["tomato", "🍅", "Roma Tomatoes", "Cherry Tomatoes", "Tomatoes on the Vine", "English Cucumber", "Mini Cucumbers"],
    ["onion", "🧅", "Yellow Onions, 3 lb", "Red Onion", "Garlic, 3 ct", "Russet Potatoes, 5 lb", "Sweet Potatoes", "Shallots"],
    ["pepper", "🫑", "Green Bell Pepper", "Red Bell Pepper", "Zucchini", "Yellow Squash", "Eggplant", "Jalapeños"],
    ["carrot", "🥕", "Carrots, 2 lb", "Baby Carrots", "Celery Hearts", "Beets", "Radishes", "Ginger Root"],
    ["broccoli", "🥦", "Broccoli Crowns", "Cauliflower", "Brussels Sprouts", "Green Cabbage", "Broccoli Florets"],
    ["herb", "🌿", "Cilantro", "Italian Parsley", "Basil", "Dill", "Mint"],
    ["mushroom", "🍄", "White Mushrooms, 8 oz", "Baby Bella Mushrooms", "Portobello Caps", "Shiitake"],
    ["bread", "🍞", "White Sandwich Bread", "Whole Wheat Bread", "Multigrain Loaf", "Potato Bread", "Rye Bread"],
    ["baguette", "🥖", "French Baguette", "Sourdough Boule", "Ciabatta", "Seeded Rustic Loaf"],
    ["bagel", "🥯", "Plain Bagels, 6 ct", "Everything Bagels", "English Muffins", "Blueberry Muffins"],
    ["tortilla", "🌯", "Flour Tortillas", "Corn Tortillas", "Pita Bread", "Garlic Naan"],
    ["croissant", "🥐", "Butter Croissants, 4 ct", "Cinnamon Rolls", "Chocolate Cake Slice", "Glazed Donuts"],
    ["chicken", "🍗", "Chicken Breasts, 1.5 lb", "Chicken Thighs", "Whole Chicken", "Chicken Drumsticks", "Ground Chicken"],
    ["beef", "🥩", "Ground Beef 85/15, 1 lb", "Ribeye Steak", "Sirloin Steak", "Beef Stew Meat", "Burger Patties"],
    ["pork", "🥓", "Pork Chops", "Thick-cut Bacon", "Pork Tenderloin", "Sliced Ham"],
    ["sausage", "🌭", "Beef Hot Dogs", "Italian Sausage", "Breakfast Sausage", "Chicken Apple Sausage"],
    ["salmon", "🐟", "Atlantic Salmon Fillet", "Raw Shrimp, 1 lb", "Cod Fillets", "Tilapia", "Sea Scallops"],
    ["oat milk", "🥛", "Oat Milk, half gallon", "Almond Milk", "Soy Milk", "Coconut Milk Beverage"],
    ["milk", "🥛", "Whole Milk, 1 gal", "2% Milk, 1 gal", "Skim Milk", "Organic Whole Milk", "Lactose-free Milk"],
    ["egg", "🥚", "Large Eggs, 12 ct", "Organic Brown Eggs", "Pasture-raised Eggs", "Egg Whites"],
    ["butter", "🧈", "Salted Butter", "Unsalted Butter", "European-style Butter", "Plant Butter"],
    ["yogurt", "🥣", "Greek Yogurt, plain", "Vanilla Yogurt", "Strawberry Yogurt Cups", "Kefir"],
    ["cheese", "🧀", "Sharp Cheddar Block", "Shredded Mozzarella", "Sliced Swiss", "Parmesan Wedge", "Brie"],
    ["sour cream", "🍦", "Heavy Cream", "Sour Cream", "Cream Cheese", "Half & Half"],
    ["turkey", "🥪", "Oven-roasted Turkey", "Black Forest Ham", "Genoa Salami", "Prosciutto"],
    ["hummus", "🫙", "Classic Hummus", "Fresh Salsa", "Guacamole", "Tzatziki"],
    ["prepared", "🍱", "Rotisserie Chicken", "Chicken Caesar Salad", "Mac & Cheese", "Sushi Roll"],
    ["cereal", "🥣", "Honey Nut Cereal", "Corn Flakes", "Frosted Mini Wheats", "Rice Crisps", "Raisin Bran"],
    ["oatmeal", "🌾", "Old-fashioned Oats", "Instant Oatmeal Packets", "Honey Granola", "Muesli"],
    ["pancake", "🥞", "Pancake Mix", "Pure Maple Syrup", "Waffle Mix", "Pancake Syrup"],
    ["peanut butter", "🥜", "Creamy Peanut Butter", "Strawberry Jam", "Hazelnut Spread", "Clover Honey", "Almond Butter"],
    ["coffee", "☕", "Medium Roast Ground Coffee", "Dark Roast Coffee", "Decaf Coffee", "Espresso Beans"],
    ["coffee k-cups", "☕", "Coffee Pods, 24 ct", "Espresso Capsules", "Decaf Pods"],
    ["tea", "🍵", "Green Tea, 20 bags", "English Breakfast Tea", "Chamomile Tea", "Earl Grey"],
    ["pasta sauce", "🥫", "Marinara Sauce", "Tomato Basil Sauce", "Basil Pesto", "Alfredo Sauce"],
    ["pasta", "🍝", "Spaghetti, 1 lb", "Penne Rigate", "Rotini", "Elbow Macaroni", "Linguine"],
    ["rice", "🍚", "Jasmine Rice, 2 lb", "Basmati Rice", "Brown Rice", "Quinoa", "Couscous"],
    ["lentils", "🫘", "Red Lentils", "Green Lentils", "Dried Chickpeas", "Black Beans, dry"],
    ["soup", "🍲", "Chicken Noodle Soup", "Tomato Soup", "Chicken Broth", "Vegetable Broth"],
    ["canned tomatoes", "🥫", "Diced Tomatoes", "Crushed Tomatoes", "Tomato Paste", "Sweet Corn"],
    ["canned black", "🥫", "Black Beans", "Chickpeas", "Kidney Beans", "Refried Beans"],
    ["canned tuna", "🐟", "Chunk Light Tuna", "Albacore Tuna", "Canned Salmon", "Sardines"],
    ["ketchup", "🍅", "Tomato Ketchup", "Yellow Mustard", "Mayonnaise", "Dijon Mustard"],
    ["dressing", "🥗", "Ranch Dressing", "Balsamic Vinaigrette", "Caesar Dressing", "Italian Dressing"],
    ["olive oil", "🫒", "Extra Virgin Olive Oil", "Canola Oil", "Balsamic Vinegar", "Apple Cider Vinegar"],
    ["soy sauce", "🌶️", "Soy Sauce", "Sriracha", "Hot Sauce", "Teriyaki Sauce"],
    ["pickles", "🥒", "Dill Pickles", "Kalamata Olives", "Green Olives", "Pickled Jalapeños"],
    ["flour", "🌾", "All-purpose Flour", "Granulated Sugar", "Brown Sugar", "Powdered Sugar"],
    ["baking powder", "🧁", "Baking Powder", "Baking Soda", "Active Dry Yeast", "Vanilla Extract", "Chocolate Chips"],
    ["spices", "🧂", "Ground Cinnamon", "Smoked Paprika", "Ground Cumin", "Dried Oregano", "Garlic Powder"],
    ["black pepper", "🧂", "Sea Salt", "Kosher Salt", "Black Peppercorns", "Ground Black Pepper"],
    ["potato chips", "🥔", "Classic Potato Chips", "Tortilla Chips", "Kettle Chips", "Nacho Cheese Chips"],
    ["pretzels", "🥨", "Mini Pretzels", "Butter Popcorn", "Kettle Corn", "Pretzel Rods"],
    ["nuts", "🥜", "Roasted Almonds", "Cashews", "Trail Mix", "Raisins", "Dried Mango"],
    ["bars", "🍫", "Chewy Granola Bars", "Protein Bars", "Fruit & Nut Bars"],
    ["cookies", "🍪", "Chocolate Sandwich Cookies", "Chocolate Chip Cookies", "Shortbread", "Oatmeal Cookies"],
    ["crackers", "🍘", "Saltine Crackers", "Cheese Crackers", "Rice Cakes", "Graham Crackers"],
    ["chocolate", "🍫", "Milk Chocolate Bar", "Dark Chocolate Bar", "Gummy Bears", "Peanut Butter Cups"],
    ["water", "💧", "Spring Water, 24 pk", "Sparkling Water, 12 pk", "Lemon Seltzer", "Alkaline Water"],
    ["orange juice", "🧃", "Orange Juice, 52 oz", "Apple Juice", "Lemonade", "Cranberry Juice"],
    ["soda", "🥤", "Cola, 12 pk", "Diet Cola", "Lemon-Lime Soda", "Ginger Ale", "Root Beer"],
    ["sports", "⚡", "Sports Drink", "Energy Drink", "Kombucha", "Coconut Water"],
    ["frozen meals", "🍱", "Frozen Lasagna", "Chicken Burrito Bowl", "Frozen Pot Pie", "Frozen Dumplings"],
    ["pizza", "🍕", "Frozen Pepperoni Pizza", "Frozen Margherita", "Pizza Rolls", "French Bread Pizza"],
    ["frozen vegetables", "🫛", "Frozen Peas", "Frozen Corn", "Frozen Broccoli", "Mixed Vegetables"],
    ["frozen fruit", "🫐", "Frozen Blueberries", "Frozen Mango Chunks", "Frozen Strawberries", "Mixed Berries"],
    ["ice cream", "🍨", "Vanilla Ice Cream", "Chocolate Ice Cream", "Mint Chip", "Fruit Popsicles", "Mango Sorbet"],
    ["waffles", "🧇", "Frozen Waffles", "Breakfast Burritos", "Frozen Pancakes"],
    ["paper towels", "🧻", "Paper Towels, 6 rolls", "Toilet Paper, 12 rolls", "Napkins", "Facial Tissues"],
    ["dish soap", "🧴", "Dish Soap", "Laundry Detergent", "Dishwasher Pods", "Fabric Softener"],
    ["cleaning", "🧽", "All-purpose Cleaner", "Disinfecting Wipes", "Bleach", "Sponges, 6 ct"],
    ["trash bags", "🗑️", "Tall Kitchen Trash Bags", "Aluminum Foil", "Plastic Wrap", "Zip Storage Bags"],
    ["toothpaste", "🪥", "Toothpaste", "Soft Toothbrushes", "Dental Floss", "Mouthwash"],
    ["body wash", "🧼", "Body Wash", "Shampoo", "Conditioner", "Bar Soap", "Deodorant"],
    ["baby", "🍼", "Diapers, size 3", "Baby Wipes", "Baby Food Pouches", "Baby Formula"],
    ["dog food", "🐾", "Dry Dog Food", "Dry Cat Food", "Wet Cat Food", "Dog Treats"],
  ];

  // Stable pseudo-random numbers so prices don't change between visits.
  function hash(s) {
    let h = 2166136261;
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0) / 4294967296;
  }

  function emojiImage(emoji) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="54" font-size="72" text-anchor="middle" dominant-baseline="middle">${emoji}</text></svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  const UNITS = ["oz", "lb", "ct", "fl oz"];

  // A picture for shelves the catalog above doesn't cover.
  const EMOJI = [
    ["spinach|kale|greens|lettuce|romaine", "🥬"], ["herbs|cilantro|parsley", "🌿"], ["cucumber|zucchini|squash", "🥒"],
    ["beets|radish|root", "🥕"], ["nuts|seeds|almond", "🥜"], ["cut fruit", "🍉"], ["tortilla", "🌯"], ["muffin|croissant", "🥐"],
    ["cookies|brownies", "🍪"], ["deli|turkey|ham", "🥪"], ["cheese", "🧀"], ["chicken", "🍗"], ["beef|steak", "🥩"], ["pork", "🥓"],
    ["sausage|hot dog", "🌭"], ["salmon", "🐟"], ["milk|cream", "🥛"], ["eggs", "🥚"], ["butter", "🧈"], ["yogurt", "🥣"],
    ["juice", "🧃"], ["water|seltzer", "💧"], ["soda", "🥤"], ["energy|sports", "⚡"], ["coffee", "☕"], ["tea", "🍵"],
    ["cereal|oatmeal|granola", "🥣"], ["pancake|waffle|syrup|honey", "🥞"], ["peanut butter|jam", "🥜"], ["flour", "🌾"],
    ["chocolate", "🍫"], ["spices|salt|pepper", "🧂"], ["soup|broth", "🍲"], ["tomato", "🍅"], ["beans|lentils", "🫘"],
    ["tuna|sardine", "🐟"], ["pasta|spaghetti", "🍝"], ["rice", "🍚"], ["soy|teriyaki|asian", "🥢"], ["ketchup|mustard|bbq|hot sauce", "🌶️"],
    ["pickles", "🥒"], ["dressing", "🥗"], ["chips", "🥔"], ["pretzels|popcorn", "🥨"], ["bars", "🍫"], ["candy", "🍬"],
    ["crackers", "🍘"], ["paper towels|toilet paper", "🧻"], ["laundry|dish soap|cleaner|wipes", "🧽"], ["trash|foil|zip", "🗑️"],
    ["toothpaste|toothbrush", "🪥"], ["soap|body wash", "🧼"], ["diapers|baby", "🍼"], ["dog", "🐕"], ["pizza", "🍕"],
    ["vegetables|peas", "🫛"], ["waffles|breakfast", "🧇"], ["ice cream", "🍨"], ["bread|bagel", "🍞"],
    ["citrus|orange|lemon|lime", "🍊"], ["grape|melon", "🍉"], ["peach|plum|cherr", "🍑"], ["mango|pineapple|kiwi|tropical", "🥭"],
    ["potato", "🥔"], ["onion|garlic|shallot", "🧅"], ["corn", "🌽"], ["celery|leek", "🥬"], ["tofu|tempeh", "🧈"],
    ["smoothie|pressed", "🧃"], ["salad", "🥗"], ["bun|roll", "🍔"], ["pita|naan|flatbread", "🫓"], ["cake|pie", "🍰"],
    ["donut|doughnut", "🍩"], ["olive|antipasti", "🫒"], ["sushi", "🍣"], ["sandwich|wrap", "🥪"], ["lamb|turkey|duck", "🍖"],
    ["shrimp|scallop|mussel|crab|shellfish", "🦐"], ["smoked|herring|lox|cod|tilapia|fish", "🐟"], ["bacon", "🥓"],
    ["ground", "🥩"], ["instant coffee|cocoa|creamer", "☕"], ["sugar|sweetener", "🍬"], ["cake mix|brownie", "🧁"],
    ["frosting|sprinkles", "🎂"], ["evaporated|condensed", "🥫"], ["marinade|rub|gravy|seasoning", "🧂"], ["ramen|noodle|udon", "🍜"],
    ["macaroni|mac", "🧀"], ["chili", "🌶️"], ["fruit|applesauce", "🍑"], ["alfredo|pesto", "🍝"], ["parmesan|breadcrumbs", "🧀"],
    ["quinoa|couscous|grains", "🌾"], ["stuffing|mashed", "🥔"], ["curry|coconut", "🥥"], ["taco|enchilada|salsa|goya|latin", "🌮"],
    ["indian", "🍛"], ["mediterranean|tahini", "🧆"], ["russian|polish|european|kosher", "🥟"], ["mayonnaise|mayo", "🥚"],
    ["vinegar|oil|cooking spray", "🫒"], ["croutons|toppings", "🥗"], ["cheese puffs|puffs", "🧀"], ["rice cakes|veggie chips", "🍘"],
    ["jerky|meat sticks", "🥩"], ["graham|wafers", "🍪"], ["gum|mints", "🍬"], ["iced tea|lemonade", "🍋"], ["drink mix", "🥤"],
    ["tissues|napkins", "🧻"], ["plates|cups|disposable", "🍽️"], ["batteries|sponges|bulbs", "🔋"], ["hair|shampoo", "🧴"],
    ["deodorant|lotion|razor", "🧴"], ["vitamin|supplement", "💊"], ["pain|cold medicine", "💊"], ["bandage|first aid", "🩹"],
    ["feminine|cotton", "🧼"], ["formula|toddler", "🍼"], ["litter|cat", "🐈"], ["gluten|organic|keto|vegan|plant based", "🌱"],
    ["office|school", "✏️"], ["party", "🎉"], ["kitchen", "🍳"], ["flowers|bouquet", "💐"], ["dinners|meals", "🍱"],
    ["appetizers", "🥟"], ["potatoes|fries", "🍟"], ["dough|pastry", "🥐"], ["sorbet|frozen yogurt", "🍧"], ["ice", "🧊"],
    ["popsicle|ice pops", "🍭"], ["cones|bars", "🍦"], ["kefir|cottage", "🥛"], ["biscuits", "🥐"], ["kombucha|cold brew|chilled", "🧋"],
  ];

  const VARIANTS = ["", "Organic ", "Family-size ", "Demo Farms ", "Premium ", "Value ", "Local ", "Snack-size ", "Classic ", "Reduced-sugar ", "Store-brand ", "Imported "];
  const PAGE = 24; // like Amazon, 24 products a page
  const MAX = 60; // products in one category
  const title = (w) => w.charAt(0).toUpperCase() + w.slice(1);

  // One page of a category: { products, total, next }.
  function page(query, n = 1) {
    const q = query.toLowerCase();
    // The longest matching keyword wins, so "frozen fruit berries" finds the
    // freezer and not the produce berries.
    const match = CATALOG.filter(([kw]) => q.includes(kw)).sort((a, b) => b[0].length - a[0].length)[0];
    const emoji = match ? match[1] : (EMOJI.find(([words]) => words.split("|").some((w) => q.includes(w))) || [0, "🛒"])[1];
    const base = match ? match.slice(2) : q.split(" ").filter((w) => w.length > 2).slice(0, 4).map(title);
    // Enough products for a real-store shelf and then some: each name in
    // several variants.
    const names = [];
    for (const v of VARIANTS) for (const b of base) if (names.length < MAX) names.push(v + b);
    const total = names.length;
    const products = names.slice((n - 1) * PAGE, n * PAGE).map((name) => {
      const r = hash(name);
      const price = Math.round((1 + r * 11) * 100) / 100 - 0.01;
      const unit = UNITS[Math.floor(hash(name + "u") * UNITS.length)];
      return {
        id: "demo-" + name.toLowerCase().replace(/\W+/g, "-"),
        name,
        price,
        priceText: `$${price.toFixed(2)}`,
        unitPrice: `$${(price / (4 + hash(name + "q") * 20)).toFixed(2)}/${unit}`,
        image: emojiImage(emoji),
        url: "#",
        addForm: null,
      };
    });
    const result = { products, total, next: n * PAGE < total ? { page: n + 1 } : null };
    // Pretend the store is a little slow, like the real one.
    return new Promise((resolve) => setTimeout(() => resolve(result), 150 + hash(query + n) * 350));
  }

  const search = async (query) => (await page(query)).products;

  // The practice store's departments and categories, shaped like a real
  // store's (see the Amazon adapter's catalog()); the aisles are built from
  // these just as they are for a real store.
  const DEPARTMENTS = [
    ["Produce", "Fresh Fruit|Apples & Pears|Bananas|Berries|Citrus|Grapes|Avocados|Fresh Vegetables|Tomatoes|Onions|Peppers|Carrots|Broccoli|Mushrooms|Lettuce|Spinach & Kale|Fresh Herbs|Cut Fruit|Packaged Salads|Nuts & Seeds"],
    ["Breads & Bakery", "Sandwich Bread|Baguettes|Bagels|Tortillas|Croissants & Pastries|Cakes|Cookies"],
    ["Deli & Prepared Foods", "Deli Meats|Deli Cheese|Hummus & Dips|Prepared Meals"],
    ["Meat & Seafood", "Chicken|Beef|Pork|Sausages|Turkey|Salmon"],
    ["Breakfast Foods", "Cereal|Oatmeal|Pancake & Waffle Mix|Breakfast Bars"],
    ["Pantry Staples", "Pasta|Pasta Sauce|Ramen & Noodles|Rice|Quinoa & Grains|Lentils & Beans|Soup|Broth|Chili|Canned Tomatoes|Canned Tuna|Canned Fruit|Peanut Butter & Spreads|Honey|Olive Oil|Vinegar|Salad Dressing|Ketchup & Condiments|Mayonnaise|Soy Sauce|Salsa|Taco Kits|Curry & Coconut Milk|Pickles|Flour|Sugar & Sweeteners|Baking Powder & Soda|Cake Mix|Frosting & Sprinkles|Spices|Marinades & Seasoning"],
    ["Beverages", "Water|Soda|Orange Juice|Sports Drinks|Iced Tea|Lemonade|Drink Mix|Kombucha|Cold Brew|Coffee|Coffee K-Cups|Tea|Cocoa"],
    ["Snack Foods", "Potato Chips|Pretzels|Cheese Puffs|Popcorn|Rice Cakes|Nuts|Jerky|Crackers|Graham Crackers|Cookies & Chocolate|Candy|Gum & Mints|Granola Bars"],
    ["Household", "Paper Towels|Toilet Paper|Tissues|Napkins|Plates & Cups|Dish Soap|Laundry|Cleaning Supplies|Sponges|Trash Bags|Foil & Wrap|Batteries|Light Bulbs"],
    ["Personal Care", "Toothpaste|Body Wash|Shampoo|Deodorant|Lotion|Razors|Cotton|Feminine Care"],
    ["Health & Wellness", "Vitamins|Supplements|Pain Relief|Cold Medicine|Bandages & First Aid"],
    ["Baby Food & Care", "Baby Food|Formula|Toddler Snacks|Diapers & Wipes"],
    ["Pet", "Dog Food|Dog Treats|Cat Food|Cat Treats|Cat Litter"],
    ["Frozen Foods", "Frozen Meals|Frozen Pizza|Frozen Vegetables|Frozen Fruit|Frozen Waffles|Ice Cream|Ice Cream Novelties"],
    ["Dairy, Eggs & Cheese", "Milk|Oat Milk|Eggs|Butter|Yogurt|Cheese|Sour Cream"],
  ].map(([name, subs], d) => ({
    node: `d${d}`,
    name,
    subs: subs.split("|").map((n, i) => ({ node: `d${d}-${i}`, name: n })),
  }));

  S.adapters = S.adapters || {};
  S.adapters.demo = () => ({
    id: "demo",
    name: "Demo Market",
    tagline: "Practice store — nothing is really bought",
    search,
    catalog: () => new Promise((resolve) => setTimeout(() => resolve(DEPARTMENTS), 300)),
    searchShelf: (section, place, cursor) => page(section.query || section.name, cursor ? cursor.page : 1),
    async addToCart() {
      return { ok: true };
    },
    cartUrl() {
      return null;
    },
  });
})();
