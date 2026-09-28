// The store: our own list of grocery categories, where each one lives, and
// the floor plan that puts them on real fixtures. The same for every store;
// each store only has to say which of its products belong to which of our
// categories (see docs/store-plan.md).
//
// A place (department or aisle) has sides; a side is one kind of fixture
// (shelving, cooler, freezer, produce table…) holding a run of sections;
// a section is one category. `bays` is how much shelf space it gets.
(function () {
  const S = (window.Supermarket = window.Supermarket || {});

  // sec(name, search words, "keywords, for, where's the…", bays)
  const sec = (name, query, keywords = "", bays = 1) => ({
    name,
    query,
    keywords: keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    bays,
  });
  const side = (label, fixture, ...sections) => ({ label, fixture, sections });

  const places = [
    // ---- fresh departments, in the order you walk them ----
    {
      id: "produce",
      label: "Produce",
      sign: "🥬",
      zone: "produce",
      sides: [
        side("Fruit", "table",
          sec("Apples & Pears", "fresh apples pears", "apple, pear", 2),
          sec("Bananas", "fresh bananas", "banana, plantain"),
          sec("Citrus", "fresh oranges lemons limes", "orange, lemon, lime, grapefruit, clementine, citrus", 2),
          sec("Berries", "fresh berries", "strawberr, blueberr, raspberr, blackberr, berry, berries", 2),
          sec("Grapes & Melons", "fresh grapes melon", "grape, melon, watermelon, cantaloupe, honeydew", 2),
          sec("Stone Fruit", "fresh peaches plums cherries", "peach, plum, cherr, nectarine, apricot"),
          sec("Tropical Fruit", "fresh mango pineapple kiwi", "mango, pineapple, kiwi, papaya, tropical"),
          sec("Avocados", "fresh avocados", "avocado")
        ),
        side("Vegetables", "table",
          sec("Potatoes", "fresh potatoes sweet potatoes", "potato, yam", 2),
          sec("Onions & Garlic", "fresh onions garlic shallots", "onion, garlic, shallot, scallion", 2),
          sec("Tomatoes", "fresh tomatoes", "tomato", 2),
          sec("Peppers", "fresh bell peppers chili peppers", "pepper, jalapeno, chili"),
          sec("Cucumbers & Squash", "fresh cucumbers zucchini squash", "cucumber, zucchini, squash, eggplant"),
          sec("Carrots & Root Vegetables", "fresh carrots beets radishes", "carrot, beet, radish, turnip, parsnip, ginger"),
          sec("Broccoli & Cauliflower", "fresh broccoli cauliflower", "broccoli, cauliflower, brussels, cabbage"),
          sec("Mushrooms", "fresh mushrooms", "mushroom"),
          sec("Corn, Beans & Peas", "fresh corn green beans snap peas", "corn, green bean, snap pea, asparagus")
        ),
        side("Salad & Herbs", "wetrack",
          sec("Lettuce", "fresh lettuce romaine", "lettuce, romaine, iceberg", 2),
          sec("Spinach & Kale", "fresh spinach kale greens", "spinach, kale, greens, arugula, chard", 2),
          sec("Fresh Herbs", "fresh herbs", "herb, cilantro, parsley, basil, dill, mint, rosemary, thyme", 2),
          sec("Celery & Leeks", "fresh celery leeks", "celery, leek, fennel")
        ),
        side("Cut & Packaged", "cooler",
          sec("Packaged Salads", "packaged salad kit", "salad kit, salad mix, bagged salad", 3),
          sec("Cut Fruit & Vegetables", "fresh cut fruit vegetables", "cut fruit, fruit cup, veggie tray, cut vegetables", 3),
          sec("Tofu & Plant Protein", "tofu tempeh", "tofu, tempeh, seitan", 2),
          sec("Fresh Juice", "fresh pressed juice smoothie", "fresh juice, smoothie, cold pressed", 2),
          sec("Nuts & Dried Fruit", "nuts dried fruit", "almond, cashew, walnut, pistachio, peanut, dried fruit, raisin, dates, prune", 2)
        ),
      ],
    },
    {
      id: "bakery",
      label: "Bakery",
      sign: "🥖",
      zone: "bakery",
      sides: [
        side("Bread", "rack",
          sec("Sandwich Bread", "sliced sandwich bread", "bread, loaf, sliced bread, whole wheat", 3),
          sec("Artisan Bread", "bakery artisan bread sourdough baguette", "baguette, sourdough, ciabatta, artisan, rye", 2),
          sec("Bagels & English Muffins", "bagels english muffins", "bagel, english muffin", 2),
          sec("Buns & Rolls", "hamburger buns dinner rolls", "bun, roll, hot dog bun, brioche", 2),
          sec("Tortillas & Wraps", "tortillas wraps", "tortilla, wrap", 2),
          sec("Pita & Flatbread", "pita naan flatbread", "pita, naan, flatbread, lavash")
        ),
        side("Cakes & Pastries", "case",
          sec("Muffins & Croissants", "bakery muffins croissants", "muffin, croissant, scone, danish", 2),
          sec("Cakes & Pies", "bakery cake pie", "cake, cupcake, pie, cheesecake", 2),
          sec("Cookies & Brownies", "bakery cookies brownies", "bakery cookie, brownie, macaron", 1),
          sec("Donuts & Sweet Rolls", "donuts cinnamon rolls", "donut, doughnut, cinnamon roll", 1)
        ),
      ],
    },
    {
      id: "deli",
      label: "Deli",
      sign: "🥪",
      zone: "deli",
      sides: [
        side("Deli Counter", "counter",
          sec("Sliced Meats", "deli sliced turkey ham", "turkey, ham, salami, prosciutto, pastrami, roast beef, deli meat, bologna", 2),
          sec("Deli Cheese", "deli sliced cheese", "sliced cheese, provolone, swiss, deli cheese", 1),
          sec("Olives & Antipasti", "olives antipasti", "olive, antipasti, marinated", 1)
        ),
        side("Prepared Foods", "cooler",
          sec("Ready Meals", "prepared meals ready to eat", "prepared, ready meal, rotisserie, meal", 2),
          sec("Sushi", "sushi", "sushi, sashimi, poke", 1),
          sec("Sandwiches & Wraps", "prepared sandwiches wraps", "sandwich, sub", 1),
          sec("Hummus & Dips", "hummus dips", "hummus, dip, tzatziki, guacamole", 2),
          sec("Salads & Sides", "prepared salads sides", "potato salad, coleslaw, pasta salad, chicken salad", 1)
        ),
      ],
    },
    {
      id: "meat",
      label: "Meat & Seafood",
      sign: "🥩",
      zone: "meat",
      sides: [
        side("Meat Counter", "counter",
          sec("Chicken", "fresh chicken breast thighs", "chicken, wings, drumstick", 3),
          sec("Beef", "fresh beef steak", "beef, steak, brisket, ribeye, sirloin", 3),
          sec("Ground Meat", "ground beef ground turkey", "ground beef, ground turkey, burger, mince", 2),
          sec("Pork", "fresh pork chops tenderloin", "pork, ribs, tenderloin", 2),
          sec("Sausages & Hot Dogs", "sausages hot dogs", "sausage, hot dog, bratwurst, kielbasa", 2),
          sec("Bacon", "bacon", "bacon", 1),
          sec("Turkey & Lamb", "fresh turkey lamb", "lamb, whole turkey, duck", 1)
        ),
        side("Seafood Counter", "counter",
          sec("Salmon", "fresh salmon fillet", "salmon", 2),
          sec("Shrimp", "fresh shrimp", "shrimp, prawn", 2),
          sec("White Fish", "fresh cod tilapia fish fillet", "cod, tilapia, haddock, halibut, fish", 2),
          sec("Shellfish", "scallops mussels crab", "scallop, mussel, crab, lobster, clam, oyster", 1),
          sec("Smoked Fish", "smoked salmon lox herring", "smoked salmon, lox, herring, smoked fish", 1)
        ),
      ],
    },

    // ---- center aisles ----
    {
      id: "a1", label: "Aisle 1", number: "1", zone: "aisle",
      sides: [
        side("Cereal & Breakfast", "shelf",
          sec("Cereal", "breakfast cereal", "cereal, cornflakes, cheerios", 4),
          sec("Oatmeal & Hot Cereal", "oatmeal hot cereal", "oat, oatmeal, porridge, grits, cream of wheat", 2),
          sec("Granola & Breakfast Bars", "granola breakfast bars", "granola, muesli, breakfast bar", 2),
          sec("Pancake & Waffle Mix", "pancake waffle mix", "pancake, waffle mix", 1),
          sec("Syrup & Honey", "maple syrup honey", "syrup, honey, agave", 2),
          sec("Peanut Butter & Spreads", "peanut butter jam nutella", "peanut butter, almond butter, jam, jelly, nutella, spread, preserves", 3)
        ),
        side("Coffee & Tea", "shelf",
          sec("Ground Coffee", "ground coffee", "coffee, ground coffee", 3),
          sec("Whole Bean Coffee", "whole bean coffee", "whole bean, espresso beans", 2),
          sec("Coffee Pods", "coffee pods k-cups", "k-cup, pod, nespresso, keurig", 3),
          sec("Instant Coffee", "instant coffee", "instant coffee", 1),
          sec("Tea", "tea bags", "tea, chamomile, green tea, black tea, herbal tea", 3),
          sec("Hot Cocoa", "hot cocoa mix", "cocoa, hot chocolate", 1),
          sec("Coffee Creamer", "coffee creamer", "creamer", 2)
        ),
      ],
    },
    {
      id: "a2", label: "Aisle 2", number: "2", zone: "aisle",
      sides: [
        side("Baking", "shelf",
          sec("Flour", "flour", "flour, cornmeal", 2),
          sec("Sugar & Sweeteners", "sugar sweetener", "sugar, sweetener, stevia", 2),
          sec("Baking Mixes", "cake mix brownie mix", "cake mix, brownie mix, muffin mix, cookie mix", 3),
          sec("Chocolate Chips & Baking Chocolate", "chocolate chips baking chocolate", "chocolate chips, baking chocolate, cocoa powder", 2),
          sec("Baking Essentials", "baking powder baking soda yeast vanilla extract", "baking powder, baking soda, yeast, vanilla, extract", 2),
          sec("Frosting & Decorating", "frosting sprinkles", "frosting, sprinkles, icing, food coloring", 1),
          sec("Evaporated & Condensed Milk", "evaporated milk condensed milk", "evaporated milk, condensed milk", 1)
        ),
        side("Spices & Seasonings", "shelf",
          sec("Spices", "spices", "spice, cinnamon, paprika, cumin, oregano, turmeric, chili powder", 5),
          sec("Salt & Pepper", "salt black pepper", "salt, peppercorn, black pepper", 2),
          sec("Seasoning Blends", "seasoning blend", "seasoning, taco seasoning, everything bagel", 3),
          sec("Marinades & Rubs", "marinade meat rub", "marinade, rub", 2),
          sec("Gravy & Sauce Mixes", "gravy mix sauce mix", "gravy, sauce mix", 1)
        ),
      ],
    },
    {
      id: "a3", label: "Aisle 3", number: "3", zone: "aisle",
      sides: [
        side("Soup & Broth", "shelf",
          sec("Soup", "canned soup", "soup, chowder", 4),
          sec("Broth & Stock", "broth stock", "broth, stock, bouillon", 3),
          sec("Ramen & Instant Noodles", "ramen instant noodles", "ramen, instant noodles, cup noodles", 3),
          sec("Mac & Cheese", "macaroni and cheese box", "mac and cheese, macaroni and cheese", 2),
          sec("Chili", "canned chili", "chili", 1)
        ),
        side("Canned Goods", "shelf",
          sec("Canned Tomatoes", "canned tomatoes tomato paste", "canned tomato, tomato paste, tomato sauce, crushed tomatoes", 3),
          sec("Canned Vegetables", "canned vegetables corn peas", "canned corn, canned peas, canned vegetables, canned green beans", 3),
          sec("Canned Beans", "canned beans", "black beans, kidney beans, chickpeas, canned beans, refried", 3),
          sec("Canned Fish & Meat", "canned tuna salmon chicken", "tuna, sardine, anchov, canned chicken, spam", 2),
          sec("Canned Fruit", "canned fruit applesauce", "canned fruit, applesauce, fruit cup, canned peaches", 2)
        ),
      ],
    },
    {
      id: "a4", label: "Aisle 4", number: "4", zone: "aisle",
      sides: [
        side("Pasta & Sauce", "shelf",
          sec("Pasta", "dry pasta spaghetti penne", "pasta, spaghetti, penne, macaroni, noodle, lasagna", 5),
          sec("Pasta Sauce", "pasta sauce marinara", "pasta sauce, marinara, tomato basil", 4),
          sec("Pesto & Alfredo", "pesto alfredo sauce", "pesto, alfredo", 1),
          sec("Parmesan & Breadcrumbs", "grated parmesan breadcrumbs", "grated parmesan, breadcrumbs, panko", 1)
        ),
        side("Rice, Grains & Beans", "shelf",
          sec("Rice", "rice", "rice, jasmine, basmati", 4),
          sec("Quinoa & Grains", "quinoa couscous grains", "quinoa, couscous, barley, farro, bulgur, buckwheat", 2),
          sec("Dried Beans & Lentils", "dried beans lentils", "lentil, dried beans, split peas", 2),
          sec("Boxed Sides & Stuffing", "stuffing mix boxed rice sides", "stuffing, rice mix, side dish", 2),
          sec("Mashed Potatoes", "instant mashed potatoes", "mashed potato, potato flakes", 1)
        ),
      ],
    },
    {
      id: "a5", label: "Aisle 5", number: "5", zone: "aisle",
      sides: [
        side("Asian & Latin", "shelf",
          sec("Asian Sauces", "soy sauce teriyaki asian sauce", "soy sauce, teriyaki, hoisin, oyster sauce, fish sauce, sesame oil", 3),
          sec("Asian Noodles & Rice", "rice noodles udon", "rice noodles, udon, soba, rice paper", 2),
          sec("Coconut Milk & Curry", "coconut milk curry paste", "coconut milk, curry", 1),
          sec("Mexican", "taco shells salsa enchilada", "taco, enchilada, salsa, tortilla chips, refried, mole", 3),
          sec("Latin Foods", "goya latin foods", "goya, sazon, adobo, plantain chips", 2)
        ),
        side("World Foods", "shelf",
          sec("Indian", "indian simmer sauce", "indian, tikka, masala, dal, chutney", 2),
          sec("Mediterranean", "mediterranean tahini", "tahini, falafel, grape leaves, mediterranean", 2),
          sec("Eastern European", "eastern european russian polish food", "buckwheat, kasha, pickled, russian, polish, ukrainian", 3),
          sec("Kosher", "kosher food", "kosher, matzo", 2),
          sec("British & European", "european imported food", "european, british, italian imported", 2)
        ),
      ],
    },
    {
      id: "a6", label: "Aisle 6", number: "6", zone: "aisle",
      sides: [
        side("Condiments", "shelf",
          sec("Ketchup & Mustard", "ketchup mustard", "ketchup, mustard", 2),
          sec("Mayonnaise", "mayonnaise", "mayo, mayonnaise, aioli", 2),
          sec("Hot Sauce & BBQ", "hot sauce bbq sauce", "hot sauce, sriracha, bbq, barbecue", 3),
          sec("Pickles & Olives", "pickles olives jar", "pickle, relish, jarred olive", 3),
          sec("Salsa & Dips", "jarred salsa queso dip", "jarred salsa, queso", 2)
        ),
        side("Oils, Vinegar & Dressings", "shelf",
          sec("Olive Oil", "olive oil", "olive oil", 3),
          sec("Cooking Oil & Spray", "cooking oil spray", "vegetable oil, canola, cooking spray, avocado oil, coconut oil", 2),
          sec("Vinegar", "vinegar", "vinegar, balsamic", 2),
          sec("Salad Dressing", "salad dressing", "dressing, ranch, vinaigrette", 3),
          sec("Croutons & Toppings", "croutons salad toppings", "crouton, salad topping", 1)
        ),
      ],
    },
    {
      id: "a7", label: "Aisle 7", number: "7", zone: "aisle",
      sides: [
        side("Chips & Snacks", "shelf",
          sec("Potato Chips", "potato chips", "potato chips, chips, crisps", 4),
          sec("Tortilla Chips", "tortilla chips", "tortilla chips, doritos, nachos", 2),
          sec("Pretzels & Popcorn", "pretzels popcorn", "pretzel, popcorn", 2),
          sec("Cheese Snacks & Puffs", "cheese puffs snacks", "cheetos, puffs, cheese snacks", 2),
          sec("Rice Cakes & Veggie Snacks", "rice cakes veggie chips", "rice cake, veggie chips, pita chips", 1)
        ),
        side("Nuts, Bars & Jerky", "shelf",
          sec("Nuts & Seeds", "nuts seeds snack", "nuts, peanuts, sunflower seeds, trail mix", 3),
          sec("Snack Bars", "granola bars protein bars", "protein bar, snack bar, energy bar, kind bar", 4),
          sec("Jerky & Meat Snacks", "beef jerky meat sticks", "jerky, meat stick", 2),
          sec("Fruit Snacks", "fruit snacks", "fruit snacks, gummies, fruit leather", 2),
          sec("Dried Fruit", "dried fruit snack", "dried mango, raisins, dried cranberries, prunes", 2)
        ),
      ],
    },
    {
      id: "a8", label: "Aisle 8", number: "8", zone: "aisle",
      sides: [
        side("Cookies & Crackers", "shelf",
          sec("Cookies", "cookies", "cookie, oreo, biscuit", 5),
          sec("Crackers", "crackers", "cracker, saltine, triscuit, ritz", 4),
          sec("Graham Crackers & Wafers", "graham crackers wafers", "graham, wafer", 1)
        ),
        side("Candy & Chocolate", "shelf",
          sec("Chocolate", "chocolate bars", "chocolate", 4),
          sec("Candy", "candy", "candy, gummy, licorice, lollipop", 4),
          sec("Gum & Mints", "gum mints", "gum, mints", 2)
        ),
      ],
    },
    {
      id: "a9", label: "Aisle 9", number: "9", zone: "aisle",
      sides: [
        side("Water & Soda", "shelf",
          sec("Water", "bottled water", "water, spring water", 4),
          sec("Sparkling Water", "sparkling water seltzer", "sparkling water, seltzer, la croix, club soda", 3),
          sec("Soda", "soda soft drinks", "soda, cola, coke, pepsi, sprite, ginger ale, root beer", 5)
        ),
        side("Drinks & Mixes", "shelf",
          sec("Juice", "shelf stable juice", "juice, apple juice, grape juice, cranberry", 3),
          sec("Sports Drinks", "sports drinks", "gatorade, sports drink, electrolyte", 2),
          sec("Energy Drinks", "energy drinks", "energy drink, red bull, monster", 2),
          sec("Iced Tea & Lemonade", "iced tea lemonade bottles", "iced tea, lemonade", 2),
          sec("Drink Mixes", "drink mix powder", "drink mix, kool-aid, crystal light", 1),
          sec("Coffee Drinks", "bottled coffee drinks", "cold brew, bottled coffee, frappuccino", 1)
        ),
      ],
    },
    {
      id: "a10", label: "Aisle 10", number: "10", zone: "aisle",
      sides: [
        side("Paper Goods", "shelf",
          sec("Paper Towels", "paper towels", "paper towel", 3),
          sec("Toilet Paper", "toilet paper", "toilet paper, bath tissue", 4),
          sec("Tissues & Napkins", "facial tissues napkins", "tissue, kleenex, napkin", 2),
          sec("Plates, Cups & Cutlery", "disposable plates cups", "paper plate, plastic cup, cutlery, disposable", 2)
        ),
        side("Cleaning & Kitchen", "shelf",
          sec("Laundry", "laundry detergent", "laundry, detergent, fabric softener, dryer sheets", 3),
          sec("Dish Soap & Dishwasher", "dish soap dishwasher pods", "dish soap, dishwasher", 2),
          sec("Cleaners & Wipes", "all purpose cleaner wipes", "cleaner, wipes, bleach, disinfect", 3),
          sec("Trash Bags", "trash bags", "trash bag, garbage bag", 2),
          sec("Foil & Food Storage", "aluminum foil plastic wrap zip bags", "foil, plastic wrap, ziploc, zip bag, parchment, food storage", 3),
          sec("Sponges & Batteries", "sponges batteries light bulbs", "sponge, battery, batteries, light bulb", 1)
        ),
      ],
    },
    {
      id: "a11", label: "Aisle 11", number: "11", zone: "aisle",
      sides: [
        side("Personal Care", "shelf",
          sec("Oral Care", "toothpaste toothbrush", "toothpaste, toothbrush, floss, mouthwash", 3),
          sec("Hair Care", "shampoo conditioner", "shampoo, conditioner, hair", 3),
          sec("Soap & Body Wash", "body wash soap", "soap, body wash, hand soap", 2),
          sec("Deodorant", "deodorant", "deodorant, antiperspirant", 2),
          sec("Skin Care & Shaving", "lotion razors", "lotion, moisturizer, sunscreen, razor, shaving", 2)
        ),
        side("Health", "shelf",
          sec("Vitamins", "vitamins supplements", "vitamin, supplement, multivitamin", 4),
          sec("Pain & Cold Relief", "pain reliever cold medicine", "ibuprofen, tylenol, advil, cold medicine, cough", 3),
          sec("First Aid", "bandages first aid", "bandage, band-aid, first aid", 2),
          sec("Feminine Care", "feminine care pads tampons", "tampon, pads, feminine", 2),
          sec("Cotton & Accessories", "cotton balls swabs", "cotton, q-tips, swabs", 1)
        ),
      ],
    },
    {
      id: "a12", label: "Aisle 12", number: "12", zone: "aisle",
      sides: [
        side("Baby", "shelf",
          sec("Diapers", "diapers", "diaper", 4),
          sec("Baby Wipes", "baby wipes", "baby wipes", 2),
          sec("Baby Food", "baby food pouches", "baby food, puree", 3),
          sec("Formula", "baby formula", "formula", 2),
          sec("Toddler Snacks", "toddler snacks puffs", "toddler, baby snacks", 1)
        ),
        side("Pet", "shelf",
          sec("Dog Food", "dog food", "dog food, dog", 4),
          sec("Cat Food", "cat food", "cat food, cat", 4),
          sec("Pet Treats", "dog treats cat treats", "treats, dog treats", 2),
          sec("Cat Litter", "cat litter", "litter", 2)
        ),
      ],
    },
    {
      id: "more",
      label: "More to explore",
      number: "✦",
      zone: "aisle",
      sides: [
        side("Special Diets", "shelf",
          sec("Gluten-Free", "gluten free", "gluten free, gluten-free", 3),
          sec("Organic Pantry", "organic pantry", "organic", 3),
          sec("Keto & Low Sugar", "keto low sugar", "keto, low carb, sugar free", 3),
          sec("Plant-Based", "plant based vegan", "vegan, plant based", 3)
        ),
        side("Everything Else", "shelf",
          sec("Office & School", "office school supplies", "pen, notebook, office, school supplies", 3),
          sec("Party Supplies", "party supplies", "party, balloon, candles, birthday", 2),
          sec("Kitchen Tools", "kitchen gadgets", "kitchen, utensil, can opener", 2),
          sec("Flowers & Plants", "fresh flowers bouquet", "flowers, bouquet, roses", 2)
        ),
      ],
    },

    // ---- cold departments, last so they stay cold on the way home ----
    {
      id: "frozen",
      label: "Frozen",
      number: "❄",
      zone: "frozen",
      cold: true,
      sides: [
        side("Frozen Meals & Pizza", "freezer",
          sec("Frozen Dinners", "frozen dinners meals", "frozen meal, frozen dinner, tv dinner", 4),
          sec("Frozen Pizza", "frozen pizza", "pizza", 4),
          sec("Frozen Appetizers & Snacks", "frozen appetizers snacks", "frozen appetizer, pizza rolls, dumpling, egg roll", 3),
          sec("Frozen Meat & Seafood", "frozen chicken fish shrimp", "frozen chicken, frozen fish, frozen shrimp, frozen meat", 3),
          sec("Frozen Plant-Based", "frozen veggie burgers plant based", "veggie burger, beyond, impossible", 2)
        ),
        side("Frozen Vegetables & Breakfast", "freezer",
          sec("Frozen Vegetables", "frozen vegetables", "frozen vegetable, frozen peas, frozen corn, frozen broccoli", 4),
          sec("Frozen Fruit", "frozen fruit", "frozen fruit, frozen berr, frozen mango", 3),
          sec("Frozen Breakfast", "frozen waffles breakfast", "frozen waffle, frozen breakfast, breakfast sandwich", 3),
          sec("Frozen Potatoes & Fries", "frozen fries potatoes", "fries, tater tots, hash browns", 3),
          sec("Frozen Bread & Pastry", "frozen bread dough pastry", "frozen bread, frozen dough, puff pastry, pierogi", 2)
        ),
        side("Ice Cream & Desserts", "freezer",
          sec("Ice Cream", "ice cream", "ice cream, gelato", 6),
          sec("Frozen Yogurt & Sorbet", "frozen yogurt sorbet", "frozen yogurt, sorbet, sherbet", 2),
          sec("Frozen Desserts", "frozen pie cake desserts", "frozen pie, frozen cake, frozen dessert", 2),
          sec("Ice", "bagged ice", "ice cubes, bagged ice", 1)
        ),
        side("Ice Cream Chests", "coffin",
          sec("Ice Cream Bars & Cones", "ice cream bars cones", "ice cream bar, cone, ice cream sandwich", 2),
          sec("Popsicles", "popsicles ice pops", "popsicle, ice pop, fruit bar", 2)
        ),
      ],
    },
    {
      id: "dairy",
      label: "Dairy & Eggs",
      sign: "🥛",
      zone: "dairy",
      cold: true,
      sides: [
        side("Milk & Eggs", "cooler",
          sec("Milk", "milk gallon", "milk", 3),
          sec("Plant Milk", "oat milk almond milk", "oat milk, almond milk, soy milk, plant milk", 2),
          sec("Cream & Half-and-Half", "heavy cream half and half", "cream, half and half, whipping cream", 2),
          sec("Eggs", "eggs dozen", "egg", 3),
          sec("Butter", "butter", "butter, margarine, ghee", 2)
        ),
        side("Cheese & Yogurt", "cooler",
          sec("Yogurt", "yogurt", "yogurt, greek yogurt", 4),
          sec("Cheese", "cheese block shredded", "cheese, cheddar, mozzarella, parmesan", 4),
          sec("Specialty Cheese", "brie goat cheese specialty", "brie, goat cheese, feta, gouda, blue cheese", 2),
          sec("Sour Cream & Cream Cheese", "sour cream cream cheese", "sour cream, cream cheese", 2),
          sec("Cottage Cheese & Kefir", "cottage cheese kefir", "cottage cheese, kefir, farmer cheese, tvorog", 2),
          sec("Refrigerated Dough", "refrigerated dough biscuits", "crescent, biscuit dough, pizza dough, cookie dough", 1)
        ),
      ],
    },
    {
      id: "drinks",
      label: "Cold Drinks",
      sign: "🧃",
      zone: "drinks",
      cold: true,
      sides: [
        side("Cold Drinks", "cooler",
          sec("Orange Juice", "orange juice", "orange juice, oj", 2),
          sec("Fresh Juice & Lemonade", "refrigerated juice lemonade", "refrigerated juice, fresh lemonade", 2),
          sec("Kombucha", "kombucha", "kombucha", 1),
          sec("Cold Brew & Iced Coffee", "cold brew coffee", "iced coffee, cold brew concentrate", 1),
          sec("Chilled Drinks", "chilled drinks", "chilled, cold drinks", 1)
        ),
      ],
    },
  ];

  // How the places sit in the building. Facing into the store from the
  // entrance, corridors run from the left wall to the right wall; each
  // lists the fixtures on its left and right as [place id, side index],
  // front to back. Neighbouring corridors' faces sit back to back.
  const plan = {
    corridors: [
      { label: "Dairy & Drinks", left: [["drinks", 0], ["dairy", 1]], right: [["frozen", 2]] },
      { place: "frozen", left: [["frozen", 0]], right: [["frozen", 1]] },
      { place: "more", left: [["more", 0]], right: [["more", 1]] },
      ...["a12", "a11", "a10", "a9", "a8", "a7", "a6", "a5", "a4", "a3", "a2", "a1"].map((id) => ({
        place: id,
        left: [[id, 0]],
        right: [[id, 1]],
      })),
      { label: "Produce", wide: true, left: [["produce", 3]], right: [["produce", 0]] },
      { label: "Produce & Bakery", wide: true, left: [["produce", 1]], right: [["produce", 2], ["bakery", 0]] },
    ],
    // Along the back wall, left to right as you face it.
    back: [["dairy", 0], ["meat", 1], ["meat", 0], ["deli", 1], ["deli", 0], ["bakery", 1]],
    // Chest freezers in the wide aisle along the front, by the frozen aisle.
    chests: { corridor: 1, sides: [["frozen", 3]] },
  };

  // Give every section a stable id ("a1/cereal"), for store translation tables.
  const slug = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  for (const p of places) for (const sd of p.sides) for (const x of sd.sections) x.id = `${p.id}/${slug(x.name)}`;

  S.LAYOUT = { name: "Supermarket", places, plan };

  const byId = new Map(places.map((p) => [p.id, p]));
  S.place = (id) => byId.get(id);

  // Every place, in the order you'd walk the store.
  S.allPlaces = () => places;

  // Does the keyword appear at the start of a word? "apple" matches "apples"
  // but "corn" doesn't match "unicorn".
  const startsAWord = (q, kw) => {
    for (let i = q.indexOf(kw); i >= 0; i = q.indexOf(kw, i + 1)) if (i === 0 || !/[a-z0-9]/.test(q[i - 1])) return true;
    return false;
  };

  // "Excuse me, where's the peanut butter?" — find the shelf for a phrase.
  // Returns [{ place, sideIndex, sectionIndex, score }] best first.
  S.findShelf = function (phrase) {
    const q = String(phrase || "").toLowerCase().trim();
    if (!q) return [];
    const words = q.split(/\s+/).filter((w) => w.length > 2);
    const hits = [];
    for (const place of places) {
      place.sides.forEach((side, sideIndex) => {
        side.sections.forEach((sec, sectionIndex) => {
          // Whole-keyword matches always beat partial ones ("bread" is
          // Sandwich Bread, not Breadcrumbs); longer matches beat shorter.
          let score = 0;
          for (const kw of sec.keywords) {
            if (startsAWord(q, kw)) score = Math.max(score, 100 + kw.length);
            else {
              const w = words.find((w) => kw.startsWith(w) || w.startsWith(kw));
              if (w) score = Math.max(score, 5 + Math.min(w.length, kw.length));
            }
          }
          const name = sec.name.toLowerCase();
          if (name === q) score = Math.max(score, 200);
          else if (name.includes(q)) score = Math.max(score, 99 + q.length);
          if (score > 0) hits.push({ place, sideIndex, sectionIndex, score });
        });
      });
    }
    return hits.sort((a, b) => b.score - a.score);
  };
})();
