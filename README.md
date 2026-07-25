# FoodCaptain
# 🍽️ Campus Food Manager

A sleek, Single Page Application (SPA) designed to take the headache out of managing campus canteen headcounts during holidays and Sundays. 

Built with a premium "FinHQ" aesthetic (deep greens, rounded cards, and elegant typography), this app allows peers to securely log in, vote for their preferred meal, and helps the canteen team track real-time prep stats.

## ✨ Features

* **Single Page Application:** Seamlessly transitions between Login, Sign Up, and Dashboard without page reloads.
* **Firebase Authentication:** Secure email and password sign-in/sign-up.
* **Smart Default (Opt-Out):** If a user doesn't log in and vote, the system assumes they are skipping the meal.
* **Live Threshold Tracking:** Special items (e.g., Chicken Biryani) require a minimum of 10 votes. A live progress bar shows how close the item is to being confirmed.
* **Real-Time Canteen Dashboard:** The Canteen Team can view a live-updating table of the current headcount to prepare the exact amount of food needed.
* **Premium UI/UX:** Styled with custom CSS utilizing `Playfair Display` and `Inter` fonts for a clean, modern, and professional look.

## 🛠️ Tech Stack

* **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES Modules)
* **Backend/Database:** Firebase (Authentication, Cloud Firestore)
* **Architecture:** SPA (Single Page Application)

## 📂 Folder Structure

```text
campus-food-app/
│
├── index.html              # Main HTML (Login, Sign Up, Dashboard, Stats)
├── css/
│   └── style.css           # Custom FinHQ styling
└── js/
    ├── firebase-config.js  # Firebase API keys and initialization
    └── app.js              # Core logic (Auth, Voting, Firestore listeners)
