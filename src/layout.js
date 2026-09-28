// The floor plan of our pretend supermarket.
//
// Perimeter departments sit around the walls the way they do in a real store
// (produce by the entrance, dairy along the back), and numbered aisles run
// down the middle. Every aisle has two sides; every side is a run of shelf
// sections, and each section is filled by one search query on the real site.
(function () {
  const S = (window.Supermarket = window.Supermarket || {});

  const section = (name, query, keywords = []) => ({ name, query, keywords });

  S.LAYOUT = {
    name: "Supermarket",
    departments: [
      {
        id: "produce",
        label: "Produce",
        sign: "🥬",
        wall: "left",
        sides: [
          {
            label: "Fruit",
            sections: [
              section("Apples & Pears", "fresh apples pears", ["apple", "pear"]),
              section("Bananas", "fresh bananas", ["banana"]),
              section("Berries", "fresh berries", ["strawberr", "blueberr", "raspberr", "berry", "berries"]),
              section("Citrus", "fresh oranges lemons limes", ["orange", "lemon", "lime", "grapefruit", "citrus"]),
              section("Grapes & Melons", "fresh grapes melon", ["grape", "melon", "watermelon", "cantaloupe"]),
              section("Avocados & Tropical", "fresh avocado mango pineapple", ["avocado", "mango", "pineapple", "kiwi", "papaya"]),
            ],
          },
          {
            label: "Vegetables",
            sections: [
              section("Salad & Greens", "fresh lettuce spinach salad greens", ["lettuce", "spinach", "salad", "kale", "arugula", "greens"]),
              section("Tomatoes & Cucumbers", "fresh tomatoes cucumbers", ["tomato", "cucumber"]),
              section("Onions, Garlic & Potatoes", "fresh onions garlic potatoes", ["onion", "garlic", "potato", "shallot"]),
              section("Peppers & Squash", "fresh bell peppers zucchini", ["pepper", "zucchini", "squash", "eggplant"]),
              section("Carrots & Roots", "fresh carrots celery beets", ["carrot", "celery", "beet", "radish", "ginger"]),
              section("Broccoli & Cauliflower", "fresh broccoli cauliflower", ["broccoli", "cauliflower", "brussels", "cabbage"]),
              section("Fresh Herbs", "fresh herbs cilantro parsley basil", ["herb", "cilantro", "parsley", "basil", "dill", "mint"]),
              section("Mushrooms", "fresh mushrooms", ["mushroom"]),
            ],
          },
        ],
      },
      {
        id: "bakery",
        label: "Bakery",
        sign: "🥖",
        wall: "top",
        sides: [
          {
            label: "Bakery",
            sections: [
              section("Sliced Bread", "sliced sandwich bread", ["bread", "loaf"]),
              section("Artisan Bread", "bakery baguette sourdough", ["baguette", "sourdough", "ciabatta"]),
              section("Bagels & Muffins", "bagels english muffins", ["bagel", "muffin"]),
              section("Tortillas & Wraps", "tortillas wraps pita", ["tortilla", "wrap", "pita", "naan"]),
              section("Cakes & Pastries", "bakery croissants pastries cake", ["croissant", "pastry", "cake", "donut", "cookie dough"]),
            ],
          },
        ],
      },
      {
        id: "meat",
        label: "Meat & Seafood",
        sign: "🥩",
        wall: "top",
        sides: [
          {
            label: "Butcher counter",
            sections: [
              section("Chicken", "fresh chicken breast thighs", ["chicken"]),
              section("Beef", "fresh ground beef steak", ["beef", "steak", "burger"]),
              section("Pork", "fresh pork chops", ["pork", "bacon", "ham"]),
              section("Sausages & Hot Dogs", "sausages hot dogs", ["sausage", "hot dog"]),
              section("Fish & Seafood", "fresh salmon shrimp fish", ["salmon", "shrimp", "fish", "cod", "tuna steak", "seafood"]),
            ],
          },
        ],
      },
      {
        id: "dairy",
        label: "Dairy & Eggs",
        sign: "🥛",
        wall: "right",
        sides: [
          {
            label: "Dairy case",
            sections: [
              section("Milk", "milk gallon", ["milk"]),
              section("Plant Milk", "oat milk almond milk", ["oat milk", "almond milk", "soy milk"]),
              section("Eggs", "eggs dozen", ["egg"]),
              section("Butter", "butter", ["butter", "margarine"]),
              section("Yogurt", "yogurt", ["yogurt", "yoghurt", "kefir"]),
              section("Cheese", "cheese block shredded sliced", ["cheese", "cheddar", "mozzarella", "parmesan"]),
              section("Cream & Sour Cream", "heavy cream sour cream cream cheese", ["cream", "sour cream"]),
            ],
          },
        ],
      },
      {
        id: "deli",
        label: "Deli",
        sign: "🥪",
        wall: "right",
        sides: [
          {
            label: "Deli counter",
            sections: [
              section("Sliced Meats", "deli sliced turkey ham", ["turkey", "salami", "deli", "prosciutto"]),
              section("Hummus & Dips", "hummus dips salsa", ["hummus", "dip", "salsa", "guacamole"]),
              section("Prepared Meals", "prepared meals ready to eat", ["prepared", "ready meal", "rotisserie"]),
            ],
          },
        ],
      },
    ],
    aisles: [
      {
        id: "a1",
        label: "Aisle 1",
        sides: [
          {
            label: "Cereal & Breakfast",
            sections: [
              section("Cereal", "breakfast cereal", ["cereal"]),
              section("Oatmeal & Granola", "oatmeal granola", ["oat", "oatmeal", "granola", "muesli"]),
              section("Pancake & Syrup", "pancake mix maple syrup", ["pancake", "waffle", "syrup"]),
              section("Spreads", "peanut butter jam nutella", ["peanut butter", "jam", "jelly", "nutella", "honey", "spread"]),
            ],
          },
          {
            label: "Coffee & Tea",
            sections: [
              section("Ground Coffee", "ground coffee", ["coffee"]),
              section("Coffee Pods", "coffee k-cups pods", ["k-cup", "pod", "nespresso"]),
              section("Tea", "tea bags", ["tea"]),
            ],
          },
        ],
      },
      {
        id: "a2",
        label: "Aisle 2",
        sides: [
          {
            label: "Pasta & Rice",
            sections: [
              section("Pasta", "dry pasta spaghetti penne", ["pasta", "spaghetti", "penne", "noodle", "macaroni"]),
              section("Pasta Sauce", "pasta sauce marinara", ["pasta sauce", "marinara", "pesto"]),
              section("Rice & Grains", "rice quinoa", ["rice", "quinoa", "couscous", "barley"]),
              section("Beans & Lentils", "dry beans lentils", ["lentil", "chickpea"]),
            ],
          },
          {
            label: "Canned & Soup",
            sections: [
              section("Soup & Broth", "soup broth", ["soup", "broth", "stock"]),
              section("Canned Vegetables", "canned tomatoes canned corn", ["canned tomato", "canned corn", "tomato paste"]),
              section("Canned Beans", "canned black beans", ["beans"]),
              section("Canned Fish", "canned tuna salmon", ["tuna", "sardine", "anchov"]),
            ],
          },
        ],
      },
      {
        id: "a3",
        label: "Aisle 3",
        sides: [
          {
            label: "Condiments & Sauces",
            sections: [
              section("Ketchup & Mustard", "ketchup mustard mayonnaise", ["ketchup", "mustard", "mayo"]),
              section("Dressings", "salad dressing", ["dressing", "vinaigrette"]),
              section("Oils & Vinegar", "olive oil vinegar", ["oil", "vinegar"]),
              section("Asian & Hot Sauces", "soy sauce hot sauce sriracha", ["soy sauce", "hot sauce", "sriracha", "teriyaki"]),
              section("Pickles & Olives", "pickles olives", ["pickle", "olive"]),
            ],
          },
          {
            label: "Baking & Spices",
            sections: [
              section("Flour & Sugar", "flour sugar", ["flour", "sugar"]),
              section("Baking Supplies", "baking powder baking soda yeast vanilla", ["baking", "yeast", "vanilla", "chocolate chips"]),
              section("Spices", "spices seasoning", ["spice", "seasoning", "cinnamon", "paprika", "cumin", "oregano"]),
              section("Salt & Pepper", "salt black pepper", ["salt", "black pepper"]),
            ],
          },
        ],
      },
      {
        id: "a4",
        label: "Aisle 4",
        sides: [
          {
            label: "Snacks",
            sections: [
              section("Chips", "potato chips tortilla chips", ["chip", "crisps", "doritos"]),
              section("Pretzels & Popcorn", "pretzels popcorn", ["pretzel", "popcorn"]),
              section("Nuts & Dried Fruit", "nuts almonds dried fruit", ["nut", "almond", "cashew", "raisin", "trail mix"]),
              section("Snack Bars", "granola bars protein bars", ["bar", "protein bar"]),
            ],
          },
          {
            label: "Cookies & Crackers",
            sections: [
              section("Cookies", "cookies", ["cookie", "oreo"]),
              section("Crackers", "crackers", ["cracker", "rice cake"]),
              section("Candy & Chocolate", "chocolate candy", ["chocolate", "candy", "gum"]),
            ],
          },
        ],
      },
      {
        id: "a5",
        label: "Aisle 5",
        sides: [
          {
            label: "Beverages",
            sections: [
              section("Water", "bottled water sparkling water", ["water", "seltzer"]),
              section("Juice", "orange juice apple juice", ["juice", "lemonade"]),
              section("Soda", "soda soft drinks", ["soda", "cola", "coke", "pepsi", "sprite"]),
              section("Sports & Energy", "sports drinks energy drinks", ["gatorade", "energy drink", "kombucha"]),
            ],
          },
        ],
      },
      {
        id: "a6",
        label: "Aisle 6",
        cold: true,
        sides: [
          {
            label: "Frozen",
            sections: [
              section("Frozen Meals", "frozen meals", ["frozen meal", "frozen dinner", "tv dinner"]),
              section("Frozen Pizza", "frozen pizza", ["pizza"]),
              section("Frozen Vegetables", "frozen vegetables", ["frozen veg", "frozen peas", "frozen corn"]),
              section("Frozen Fruit", "frozen fruit berries", ["frozen fruit", "frozen berr"]),
              section("Ice Cream", "ice cream", ["ice cream", "gelato", "sorbet", "popsicle"]),
              section("Frozen Breakfast", "frozen waffles breakfast", ["frozen waffle", "frozen breakfast"]),
            ],
          },
        ],
      },
      {
        id: "a7",
        label: "Aisle 7",
        sides: [
          {
            label: "Household",
            sections: [
              section("Paper Towels & Toilet Paper", "paper towels toilet paper", ["paper towel", "toilet paper", "napkin", "tissue"]),
              section("Dish & Laundry", "dish soap laundry detergent", ["dish soap", "detergent", "dishwasher"]),
              section("Cleaning", "cleaning spray wipes", ["cleaner", "wipes", "bleach", "sponge"]),
              section("Trash Bags & Foil", "trash bags aluminum foil plastic wrap", ["trash bag", "foil", "plastic wrap", "ziploc", "zip bag"]),
            ],
          },
          {
            label: "Personal Care & Baby",
            sections: [
              section("Toothpaste & Oral Care", "toothpaste toothbrush", ["toothpaste", "toothbrush", "floss", "mouthwash"]),
              section("Soap & Shampoo", "body wash shampoo", ["soap", "shampoo", "conditioner", "body wash", "deodorant"]),
              section("Baby", "baby diapers wipes baby food", ["diaper", "baby"]),
              section("Pet Food", "dog food cat food", ["dog", "cat", "pet"]),
            ],
          },
        ],
      },
    ],
  };

  // Every place you can walk to, in store order: departments, then aisles.
  S.allPlaces = function () {
    return [...S.LAYOUT.departments, ...S.LAYOUT.aisles];
  };

  // "Excuse me, where's the peanut butter?" — find the shelf for a phrase.
  // Returns [{ place, sideIndex, sectionIndex, score }] best first.
  S.findShelf = function (phrase) {
    const q = String(phrase || "").toLowerCase().trim();
    if (!q) return [];
    const words = q.split(/\s+/).filter((w) => w.length > 2);
    const hits = [];
    for (const place of S.allPlaces()) {
      place.sides.forEach((side, sideIndex) => {
        side.sections.forEach((sec, sectionIndex) => {
          let score = 0;
          for (const kw of sec.keywords) {
            if (q.includes(kw)) score = Math.max(score, 10 + kw.length);
            else if (words.some((w) => kw.startsWith(w) || w.startsWith(kw))) score = Math.max(score, 5 + kw.length);
          }
          if (sec.name.toLowerCase().includes(q)) score = Math.max(score, 8);
          if (score > 0) hits.push({ place, sideIndex, sectionIndex, score });
        });
      });
    }
    return hits.sort((a, b) => b.score - a.score);
  };
})();
