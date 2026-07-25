// --- Digitized menu, transcribed from the GET & DET-26 canteen boards ---
// Two sheets:
//   1) "GET & DET-26 Food Menu"      -> the day-by-day rotating "usual" dishes
//   2) "FOOD MENU RATE - GET & DET"  -> base prices + the priced "Other Items"
//
// NOTE: the weekly menu was read off a photographed printout. Dish names are
// transcribed as closely as the print allowed — worth a quick proofread
// against the physical board, but easy to tweak here since it's just data.

// Base price for each session, charged automatically for anyone who orders
// the "usual" meal (no minimum headcount required).
export const BASE_PRICES = {
  Breakfast: 62,
  Lunch: 65,
  Dinner: 65
};

// Keyed by JS Date.getDay(): 0 = Sunday ... 6 = Saturday
export const WEEKLY_MENU = {
  1: { // Monday
    Breakfast: ['Idly', 'Pongal', 'Medu Vada', 'Small Onion Sambar', 'Coconut Chutney', 'Boiled Egg', 'Cornflakes', 'Milk & Banana', 'Tea/Coffee'],
    Lunch: ['Green Salad', 'Pulka', 'Kootu / Gravy', 'Seasonal Poriyal', 'Drumstick Sambar', 'White Rice', 'Rasam', 'Vadagam/Pickle', 'Butter Milk', 'Badusha'],
    Dinner: ['Cucumber Salad', 'Triangle Chappati', 'Rajma Masala', 'White Rice', 'Rasam', 'Aloo Gobi Poriyal', 'Pappad/Pickle', 'Butter Milk', 'Dessert (or) Fruits']
  },
  2: { // Tuesday
    Breakfast: ['Kal Dosa', 'Rava Upma', 'Pumpkin Sambar', 'Tomato Chutney', 'Fried Egg', 'Bread/Butter/Jam', 'Cornflakes', 'Milk & Banana', 'Tea/Coffee'],
    Lunch: ['Green Salad', 'Triangle Chappati', 'Kootu / Gravy', 'Seasonal Poriyal', 'Brinjal Sambar', 'White Rice', 'Rasam', 'Fryums/Pickle', 'Curd', 'Pineapple Kesari'],
    Dinner: ['Mix Veg Raitha', 'Chole Badura', 'Plain Dosa', 'White Rice', 'Rasam', 'Vadakam/Pickle', 'Dessert (or) Fruits']
  },
  3: { // Wednesday
    Breakfast: ['Aloo Paratha', 'Curd', 'Ragi Samiya', 'Pickle', 'Egg Bhurji', 'Cornflakes', 'Bread/Butter/Jam', 'Milk & Banana', 'Tea/Coffee'],
    Lunch: ['Green Salad', 'Methi Chappati', 'Kootu / Gravy', 'Seasonal Poriyal', 'Puli Kulambu', 'White Rice', 'Rasam', 'Pappad/Pickle', 'Curd Rice', 'Gulab Jamun'],
    Dinner: ['Green Salad', 'Plain Dosa', 'Masala', 'White Rice', 'Sambar', 'Brinjal Sambar', 'Chutney', 'Pickle', 'Dessert (or) Fruits']
  },
  4: { // Thursday
    Breakfast: ['Mini Onion Uthappam', 'Rava Kichadi', 'Mix Veg Sambar', 'Onion Chutney', 'Plain Omelette', 'Bread/Butter/Jam', 'Cornflakes', 'Milk & Banana', 'Tea/Coffee'],
    Lunch: ['Green Salad', 'Chappati', 'Kootu / Gravy', 'Seasonal Poriyal', 'Mor Kulambu', 'White Rice', 'Rasam', 'Vadagam/Pickle', 'Butter Milk', 'Bread Halwa'],
    Dinner: ['Cucumber Salad', 'Pulka', 'Aloo Mutter Gravy', 'White Rice', 'Sambar', 'Rasam', 'Pappad/Pickle', 'Dessert (or) Fruits']
  },
  5: { // Friday
    Breakfast: ['Idly', 'Pongal', 'Masala Vada', 'Small Onion Sambar', 'Coconut Chutney', 'Boiled Egg', 'Cornflakes', 'Milk & Banana', 'Tea/Coffee'],
    Lunch: ['Green Salad', 'Pulka', 'Kootu / Gravy', 'Seasonal Poriyal', 'Vathal Kulambu', 'White Rice', 'Rasam', 'Pappad/Pickle', 'Curd Rice', 'Dal Payasam'],
    Dinner: ['Salad', 'Veg Fried Rice', 'Chappati', 'Sambar', 'Tomato Sauce', 'Mix Veg Khurma', 'Dessert (or) Fruits']
  },
  6: { // Saturday
    Breakfast: ['Poori', 'Semiya Upma', 'Aloo Bhaji', 'Coconut Chutney', 'Fried Egg', 'Cornflakes', 'Milk & Banana', 'Tea/Coffee'],
    Lunch: ['Green Salad', 'Pulka', 'Kootu / Gravy', 'Seasonal Poriyal', 'White Rice', 'Rasam', 'Vadagam/Pickle', 'Fruit Custard'],
    Dinner: ['Cucumber Salad', 'Pulka', 'Egg Fried Rice', 'Veg Manchurian', 'Chilli Sauce', 'White Rice', 'Rasam', 'Poriyal', 'Vadakam/Pickle', 'Butter Milk', 'Dessert (or) Fruits']
  },
  0: { // Sunday
    Breakfast: ['Onion Paratha', 'Curd', 'Poha', 'Pickle', 'Green Chutney', 'Egg Bhurji', 'Bread/Butter/Jam', 'Milk & Banana', 'Tea/Coffee'],
    Lunch: ['Mix Veg Raitha', 'Veg Biryani', 'Dal Fry', 'White Rice', 'Rasam', 'Fryums/Pickle', 'Cut Fruits'],
    Dinner: ['Mix Veg Raitha', 'Veg Biryani', 'Long Beans Masala', 'White Rice', 'Rasam', 'Poriyal', 'Vadakam/Pickle', 'Butter Milk', 'Dessert (or) Fruits']
  }
};

// Minimum votes a threshold item needs to be confirmed (wired up in a later step).
export const THRESHOLD_MIN = 10;

// Cut-off time (24-hr "HH:MM", local time) after which a session's voting
// locks and its final headcount/ticket is calculated. Same time applies
// regardless of which day the session falls on.
export const CUTOFF_TIMES = {
  Breakfast: '06:30',
  Lunch: '10:00',
  Dinner: '16:00'
};

// The priced "Other Items" rate card. `threshold: true` marks the items the
// canteen won't prep below THRESHOLD_MIN votes (the special non-veg mains) —
// everyday individual add-ons (egg curry, omelette, ice cream) don't need a
// headcount minimum.
export const OTHER_OPTIONS = [
  { id: 'egg-curry', name: 'Egg Curry', price: 25, threshold: false },
  { id: 'omelette', name: 'Omelette', price: 15, threshold: false },
  { id: 'chicken-masala', name: 'Chicken Masala', price: 80, threshold: true },
  { id: 'mutton-fish', name: 'Mutton / Fish', price: 150, threshold: true },
  { id: 'chicken-biryani', name: 'Chicken Biryani', price: 125, threshold: true },
  { id: 'mutton-biryani', name: 'Mutton Biryani', price: 175, threshold: true },
  { id: 'chicken-fry-chilli', name: 'Chicken (Fry/Chilli)', price: 90, threshold: true },
  { id: 'paneer-mushroom', name: 'Paneer / Mushroom (Fry/Chilli)', price: 80, threshold: true },
  { id: 'ice-cream', name: 'Ice Cream', price: null, priceLabel: 'Actuals', threshold: false }
];
