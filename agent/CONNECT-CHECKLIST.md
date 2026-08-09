# Ops Bot — Connect Checklist (do once, ~20 min)

Connect the bot to the company **QuickBooks** (tonight) and **Fishbowl** (next). The bot connects **over the internet via credentials** — nothing gets installed on anyone's computer. **Don't paste secrets into chat — type them straight into `.env`.**

## 0. Open your .env
In the `ops-bot` folder:
```
copy .env.example .env
```
Open `.env` in Notepad. You'll paste values into it as you go.

---

## PART A — QUICKBOOKS ONLINE  (do tonight ✅)

### A1. Rotate the leaked secret
1. Go to **developer.intuit.com** → sign in → **My Apps** → open your app.
2. **Keys & credentials → Production**.
3. **Regenerate** the Client Secret (the old one leaked). Copy the **Client ID** + the **new Secret**.
4. Confirm **Redirect URIs** includes `https://httpbin.org/get` (add + Save if missing).

➡️ Paste into `.env`:
```
QBO_CLIENT_ID=<client id>
QBO_CLIENT_SECRET=<new secret>
QBO_REDIRECT_URI=https://httpbin.org/get
```

### A2. Authorize once (mints fresh tokens)
In the `ops-bot` folder:
```
node connect-qbo.js
```
1. Browser opens → **sign in to the company QuickBooks** (the ONE time you use the owner's QB login) → select **your company** → **Connect**.
2. Page jumps to httpbin.org (blank/error is fine) → **copy the FULL URL from the address bar**.
3. Paste it into the terminal. It auto-saves `QBO_ACCESS_TOKEN`, `QBO_REFRESH_TOKEN`, `QBO_REALM_ID` into `.env`. (Don't touch those three — they fill themselves and auto-refresh forever.)

### A3. Test it
```
node test-qbo.js
```
✅ Expect: `Connected: <your company>` + an open-invoice count.
❌ If `invalid_grant` → re-run `node connect-qbo.js`.

### A4. (Later, only for auto-posting bills) pick the expense account
```
node -e "require('./lib/qbo').query(\"SELECT Id,Name FROM Account WHERE AccountType='Expense' MAXRESULTS 20\").then(r=>console.log(r.Account))"
```
Pick the right Id → add `QBO_DEFAULT_EXPENSE_ACCOUNT=<id>` to `.env`.

---

## PART B — FISHBOWL  (gather creds now; I build + test the connector with you next)

### B1. Change the leaked password / make an API user
1. Open the **Fishbowl client** → log in as admin.
2. Change the **admin password** (it leaked).
3. Better: create a dedicated user **`botapi`** with rights to Inventory, Sales Orders, Purchase Orders. Strong password.

➡️ Paste into `.env`:
```
FB_SERVER=<your-company>.myfishbowl.com
FB_PORT=3635
FB_USERNAME=botapi
FB_PASSWORD=<new password>
```

### B2. Approve the integration (one-time)
The first time the bot connects, Fishbowl shows an **"approve third-party integration"** prompt in the Fishbowl client → an admin clicks **approve** once. (That's the only approval — once, not per computer.)

### B3. Ping me
Fishbowl's API is version-specific (your `:3635` = the classic API), so I'll build `lib/fishbowl.js` to match and we run a live test together. Just say **"Fishbowl creds are in the .env"** — don't paste the password.

---

## ✅ The proof it's done
After Part A tests green, start the bot (`npm start`) and DM it in Slack: **"who's overdue?"** → real numbers = the company QuickBooks is connected centrally, from the cloud, with nothing on anyone's computer. 🎉

## 🔒 Security
- Never commit or share `.env` (a `.gitignore` is already in this folder).
- Rotate any credential that has ever left your machine (Part A1 + B1). Non-optional.
- On the production host (Render), put these same values in the dashboard's encrypted env vars, not a file.
