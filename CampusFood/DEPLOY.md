# Deploying CampusFood to Firebase Hosting

This is a plain static site (no build step) wired up to your existing Firebase
project `foodcaptain-87c6c`. Login/signup here is just a **name + password**
(no email) checked against a Firestore collection — it does not use Firebase
Auth. See the security note in `firestore.rules` before using this for
anything beyond a low-stakes campus tool.

## One-time setup

1. **Create a Firestore database** (if you haven't already):
   - Go to https://console.firebase.google.com/project/foodcaptain-87c6c/firestore
   - Click "Create database" → choose a location → start in production mode (the rules below will override the default)

2. **Install the Firebase CLI** (if you don't have it):
   ```
   npm install -g firebase-tools
   ```

3. **Log in**:
   ```
   firebase login
   ```

## Deploy

From inside this folder:

```
firebase deploy --only hosting,firestore:rules
```

That's it — the CLI will print your live URL, something like:
`https://foodcaptain-87c6c.web.app`

## What's included

- `index.html` / `css/style.css` / `js/app.js` / `js/firebase-config.js` — the app
- `firebase.json`, `.firebaserc` — hosting config pre-pointed at your project

## What it does right now

- Sign up with just name + password → stored as a document in Firestore (`users/{normalized-name}`)
- Log in with name + password, checked against that Firestore document
- Once logged in, you land on a Home page with a "Food Menu" placeholder and a Log Out button
- Refreshing the page keeps you logged in (session saved in the browser's localStorage)
- Logging out clears that local session

Everything else (menu items, voting, live stats) can be built on top of this
whenever you're ready.
