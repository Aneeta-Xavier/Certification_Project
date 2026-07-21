# 🌱 Daybloom

Your personal life dashboard. Say, type, or photograph anything that happened —
sleep, food, meds, mood, workouts, legal-case tasks, weight, screen time — and
Claude sorts it into the right place. Four screens: **Today**, **Sleep**,
**Nutrition**, and **Plan** (day / week / month, each with a Claude review).

It runs on your Mac 24/7 and you use it from your phone.

## What's in here

```
planner/
  backend/      the server (Node, no installs needed) + Claude, Health, Calendar
  frontend/     the app itself (one page) + login, icons, offline support
  ops/          scripts to run it 24/7 in the background
```

## 1. Run it once by hand (to test)

```bash
cd planner/backend
DAYBLOOM_PASSCODE=1234 ANTHROPIC_API_KEY=sk-ant-... node server.js
```

Open <http://localhost:3000>, type the passcode. If it loads, you're good — stop
it with Ctrl-C and set up the always-on version below.

## 2. Make it run 24/7 (starts when you log in, restarts if it crashes)

```bash
cd planner/ops
cp daybloom.env.example daybloom.env      # then open daybloom.env and fill in
                                          # your passcode + Anthropic key
./install.sh
```

`install.sh` generates your security keys automatically, installs a login-time
startup entry, and starts the app. It prints your **Apple Health token** (you'll
need it in step 4) and the log location (`~/Library/Logs/Daybloom/`).

Your data lives in `~/Library/Application Support/Daybloom/` with automatic daily
backups. To stop the always-on app later: `cd planner/ops && ./uninstall.sh`.

## 3. Reach it from your phone (Tailscale — free, secure, works anywhere)

Your phone needs a secure (https) connection for voice logging and app install to
work. Tailscale gives your Mac a private web address, no cables or network setup.

1. Make a free account at <https://tailscale.com>, install Tailscale on your **Mac**
   and your **iPhone**, and sign both into the same account.
2. On the Mac, run once:
   ```bash
   tailscale serve --bg --https=443 http://localhost:3000
   ```
3. `tailscale status` shows your Mac's address, like `https://your-mac.tailXXXX.ts.net`.
   Open that on your iPhone → log in → **Share → Add to Home Screen**. Now it's an
   app icon, works on wifi and cellular, and the mic works.

## 4. Auto-import sleep & steps from Apple Health (free, via Shortcuts)

Apple won't let a computer read Health directly, so a Shortcut on your phone sends
it in each morning.

1. iPhone **Shortcuts** app → **+** → **Add Action**.
2. Add **Find Health Samples** (e.g. Sleep). Add **Get Numbers from Input** if
   needed, then **Get Contents of URL**:
   - URL: `https://your-mac.tailXXXX.ts.net/api/ingest/health`
   - Method: **POST**, Headers: `Authorization` = `Bearer YOUR_INGEST_TOKEN`
   - Request Body: **JSON** →
     `{ "samples": [ { "date": "2026-07-20", "metric": "Sleep", "value": 7.2, "unit": "h" } ] }`
     (build the date/value from the Health sample)
3. Repeat the sample for Steps, Weight, etc. Metric names Daybloom understands:
   `Sleep`, `Steps`, `Weight`, `Movement`, `Water`, `Calories`.
4. Shortcuts → **Automation** → run this **every day at 9am**.

Sending the same day twice just overwrites — no duplicates. These show up in the
Sleep tab tagged "Apple Health".

## 5. Show your calendar in the Plan tab (Apple Calendar)

The first time you open the **Plan** tab, macOS asks if `node` can access your
Calendar — click **OK**. Today's and this week's events then appear there. (If you
ran the app once by hand in step 1 and opened Plan, you've already done this.)

## Notes

- No `npm install`, no build step — just Node's built-ins. `npm start` runs the server.
- MyFitnessPal isn't connected (it has no public API); Daybloom estimates calories
  and macros from your food photos and descriptions instead.
- Everything is private to you behind your passcode; the app only listens on your
  Mac and is reachable solely through your own Tailscale network.
