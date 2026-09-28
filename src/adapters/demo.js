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

  function search(query) {
    const q = query.toLowerCase();
    // The longest matching keyword wins, so "frozen fruit berries" finds the
    // freezer and not the produce berries.
    const match = CATALOG.filter(([kw]) => q.includes(kw)).sort((a, b) => b[0].length - a[0].length)[0];
    const entry = match || ["", "🛒", ...q.split(" ").slice(0, 4).map((w) => `Store-brand ${w}`)];
    const [, emoji, ...names] = entry;
    const products = names.map((name) => {
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
    // Pretend the store is a little slow, like the real one.
    return new Promise((resolve) => setTimeout(() => resolve(products), 150 + hash(query) * 350));
  }

  S.adapters = S.adapters || {};
  S.adapters.demo = () => ({
    id: "demo",
    name: "Demo Market",
    tagline: "Practice store — nothing is really bought",
    search,
    async addToCart() {
      return { ok: true };
    },
    cartUrl() {
      return null;
    },
  });
})();
