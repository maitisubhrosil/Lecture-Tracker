# Reminder setup help

Step-by-step instructions for Web Push reminders on the [ePGP Lecture Schedule](https://maitisubhrosil.github.io/Lecture-Tracker/) app.

**Live app:** <https://maitisubhrosil.github.io/Lecture-Tracker/>

Saved reminders keep running until the last lecture for your selected subjects has passed. You do not need to recreate them every day.

**Calendar fallback (all platforms):** In the app, open **Reminders**, select subjects, then use **Subscribe calendar (live)** or **Download calendar event (.ics)** if push notifications are blocked or unreliable.

---

## Android (Google Chrome)

Chrome on Android is fully supported for Web Push. Follow these steps in order.

### Initial setup

1. **Open the app in Chrome**
   - Use the live link in **Google Chrome**, not an in-app browser inside WhatsApp, Telegram, Instagram, or similar apps. Those embedded browsers often block or break push subscriptions.
   - If a chat app opens its own browser, tap the menu (⋮) and choose **Open in Chrome** when available.

2. **Enable notifications in the app**
   - Scroll to **Reminders** and expand the section.
   - Tap **Enable** when Chrome asks for notification permission.
   - Choose **Allow** (not “Block” or “Ask again later”).

3. **Send a test notification**
   - Tap **Send test notification**.
   - You should see a test alert within a few seconds. If you do, push is working on this device.

4. **Create your reminder**
   - Select one or more **subjects** and **reminder times**.
   - Optionally turn on **Pre-class nudge** (15 minutes before class).
   - Tap **Set Reminder**.

5. **Optional: Add to Home Screen**
   - Chrome menu → **Add to Home screen** for quicker access. Reminders still use Chrome’s notification channel.

### If the first test works but later reminders are silent or marked as spam

Some Android builds classify the first notification as normal, then quietly bucket later ones as spam or low priority.

1. **Long-press** a notification from this app (or from Chrome for this site).
2. Choose **Allow**, **Show notifications**, or **Always show notifications from this site** (exact wording varies by Samsung, Xiaomi, OnePlus, etc.).
3. Open **Settings → Apps → Chrome → Notifications** and ensure notifications are **on** for Chrome.
4. Disable **battery saver**, **adaptive battery**, or **restrict background activity** for Chrome if reminders arrive late or only when Chrome is open.
5. In Chrome: **Settings → Site settings → Notifications** → confirm your GitHub Pages site is **Allowed**.

### If nothing works

- Tap **Force refresh app cache** in Reminders, reload, then **Enable** and **Send test** again.
- Avoid **Incognito** mode; subscriptions may not persist.
- Use **Subscribe calendar (live)** as a reliable fallback.

---

## iOS (Safari + Home Screen only)

**Important:** Web Push on iPhone and iPad does **not** work in Chrome on iOS. You must use **Safari**, add the app to the **Home Screen**, and open it from that icon.

### Initial setup

1. **Open the live link in Safari** (the blue Safari app, not Chrome).

2. **Add to Home Screen**
   - Tap the **Share** button (square with arrow).
   - Scroll and tap **Add to Home Screen**.
   - Confirm the name (e.g. ePGP Schedule) and tap **Add**.

3. **Open only from the Home Screen icon**
   - Launch the app by tapping the new icon on your home screen.
   - Do not rely on a regular Safari tab for reminders; standalone mode is required for Web Push on iOS.

4. **Enable notifications**
   - Open **Reminders** → tap **Enable** → tap **Allow** when iOS prompts.

5. **Send test**
   - Tap **Send test notification** and confirm an alert appears.

6. **System notification settings**
   - **Settings → Notifications** → find the app name (may appear as the site title or Safari/web app label).
   - Turn on **Allow Notifications**, **Banners** or **Alerts**, and **Sounds** as you prefer.

7. **Set your reminder** (subjects, times, optional pre-class nudge).

### Troubleshooting

- If tests fail: force-quit Safari, reopen **only from the Home Screen icon**, then **Enable** and **Send test** again.
- Reminders configured in a normal Safari tab often will not receive push until you repeat setup from the Home Screen app.
- **Fallback:** **Subscribe calendar (live)** in Reminders — Apple Calendar alerts are the most reliable option on iOS.

---

## macOS (Google Chrome)

### Initial setup

1. Open <https://maitisubhrosil.github.io/Lecture-Tracker/> in **Google Chrome**.

2. In the app: **Reminders** → **Enable** → allow when Chrome prompts.

3. **Chrome site permission**
   - Click the **tune** or **lock** icon in the address bar → **Site settings** → **Notifications** → **Allow**.

4. **macOS system permission**
   - **System Settings → Notifications → Google Chrome** → turn notifications **on**.
   - Enable alert style (Banners or Alerts) as you prefer.

5. Tap **Send test notification** and confirm delivery.

6. Create reminders (subjects, times, optional pre-class nudge).

### Troubleshooting

- Turn off **Focus** or **Do Not Disturb** while testing (menu bar Control Center).
- Keep Chrome allowed to run in the background; quit and reopen Chrome if tests stop working after a macOS update.
- If you previously blocked the site: reset notification permission in Chrome site settings, then **Enable** in Reminders again.
- **Fallback:** calendar subscribe/download in Reminders.

---

## Windows (Google Chrome)

### Initial setup

1. Open <https://maitisubhrosil.github.io/Lecture-Tracker/> in **Google Chrome**.

2. In the app: **Reminders** → **Enable** → **Allow**.

3. **Chrome per-site permission**
   - Click the **lock** or **tune** icon in the address bar → **Site settings** → **Notifications** → **Allow** for this site (your GitHub Pages origin).

4. **Windows system notifications**
   - **Settings → System → Notifications** → notifications **On**.
   - Ensure **Google Chrome** is allowed to send notifications.

5. Tap **Send test notification**.

6. Set up subjects, times, and optional pre-class nudge.

### Troubleshooting

- Turn off **Focus assist** / **Do not disturb** while testing (**Quick Settings** or **Settings → System → Focus**).
- Confirm Chrome is not in “quiet notification” mode for this site.
- Laptop must be awake or in sleep that still allows notifications; very deep sleep can delay delivery.
- Re-check per-site permission if you cleared browsing data or switched Windows profiles.
- **Fallback:** **Subscribe calendar (live)** in Reminders.

---

## Quick reference

| Platform | Browser | Extra requirement |
|----------|---------|-------------------|
| Android | Chrome | Allow site if marked spam |
| iPhone / iPad | Safari | Add to Home Screen, open from icon |
| macOS | Chrome | macOS + Chrome notification settings |
| Windows | Chrome | Windows + Chrome notification settings, Focus off |

If you change device, browser, or clear site data, you may need to **Enable** notifications and set reminders again on that device.
