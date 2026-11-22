# Sanfit

A private family app for Fitri, Sandy and Eliana: chats, shared to-dos, a private diary and games. It runs as a Home Screen web app on iPhone and Android.

- App: https://fitlies.github.io/sanfit/ (GitHub repo `fitlies/sanfit`, served by GitHub Pages)
- Database, sign-in, photos and alerts: Supabase project `vokhpyonxigqzsuddiat` (Singapore)
- Backups: the private `sanfit-backup` repo copies the database and photos every 3 days (see its README)

## On each phone

1. iPhone: open the link in Safari, tap **Share**, then **Add to Home Screen**. Android: open it in Chrome, tap **⋮**, then **Add to Home screen**.
2. Open Sanfit from the Home Screen, tap **First time here? Create your password**, and pick one.
3. Tap the confirm link in the email, then come back to the app and sign in.
4. Enter your name, then go to **Settings** and tap **Turn on notifications**.

Only muhdfitrikhamis@gmail.com, sandydandyy@gmail.com and elianachengfitri@gmail.com can create an account. There are three private chats (Fitri and Sandy, Fitri and Eliana, Sandy and Eliana), each with its own to-do list and games. Who is in which chat lives in the `chat_members` table, and only emails listed there can sign up.

Forgot a password? Reset it in Supabase under **Authentication > Users**.

## How the code is laid out

The app's files sit at the top of the GitHub repo, and in the `website/` folder on the Mac. The Mac folder also holds `supabase/` (the database and alert function) and the tests, which aren't on GitHub.

- `index.html` is the page, `app.css` the styles, `config.js` the Supabase address and public keys, `sw.js` the alerts and offline copy, `manifest.webmanifest` the Home Screen icon.
- `app.js` signs you in, picks which screen shows and keeps data live. Every data change calls its one `render()`, which redraws the current screen and the badges.
- `state.js` holds the shared data and helpers: loading, saving, photos, `open(screen)` and `pref()` for settings kept on the phone.
- One file per tab: `chat.js` (plus `search.js` for search and Chat info), `todos.js`, `diary.js`, `games.js`, `settings.js` (plus `export.js` for "Download everything").
- `lib.js`, `diary-lib.js` and `games-lib.js` are the rules with no screen code, so they're tested.
- On the Mac, `supabase/schema.sql` is the whole database in one file, and `supabase/functions/push` sends the alerts.

## Adding something later

Each feature is a tab: add a `<section class="screen">` and a tab button in `index.html`, a new `yourtab.js` with a `renderYourTab()`, and one line in `app.js` to register it.
To add a person, add rows to `chat_members` in Supabase. That alone lets them sign up and see their chats.

## Changing the database

Put each change in `schema.sql`, and also in a new `supabase/apply-NNN.sql` that you run once in Supabase's SQL Editor. Once it has run, the apply file can be deleted.

## Tests

`npm install` once, then `npm test`: checks the helpers, and runs the whole database in memory to confirm each person only sees their own chats and diary.
