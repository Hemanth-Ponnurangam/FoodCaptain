# Deploying CampusFood to Firebase Hosting

This is a plain static site (no build step) wired up to your existing Firebase
project `foodcaptain-87c6c`.

## One-time setup

1. **Enable Email/Password sign-in** (required for login/signup to work):
   - Go to https://console.firebase.google.com/project/foodcaptain-87c6c/authentication/providers
   - Click "Email/Password" → Enable → Save

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
firebase deploy --only hosting
```

That's it — the CLI will print your live URL, something like:
`https://foodcaptain-87c6c.web.app`

## What's included

- `index.html` / `css/style.css` / `js/app.js` / `js/firebase-config.js` — the app
- `firebase.json`, `.firebaserc` — hosting config pre-pointed at your project

## What it does right now

- Sign up with name/email/password → creates a real Firebase Auth account
- Log in with email/password
- Once logged in, you land on a Home page with a "Food Menu" placeholder and a Log Out button
- Refreshing the page keeps you logged in (Firebase session persistence)

Everything else (menu items, voting, live stats) can be built on top of this
whenever you're ready.
