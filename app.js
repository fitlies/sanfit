// Entry point: sign-in, which screen is showing, live updates. Each tile's screen lives in its own file.
import { S, sb, $, onChange, alertBox, unreadIn, myTodos, myTurns, loadPeople, loadChats, loadMessages, loadReactions, loadTodos, loadGames, restoreCopy, forgetThisPhone } from "./state.js";
import { retryDelay } from "./lib.js";
import { renderChatList, renderChat, addMsg, markRead } from "./chat.js";
import { renderTodos } from "./todos.js";
import { renderSettings, syncAlerts } from "./settings.js";
import { renderDiary, enterDiary } from "./diary.js";
import { renderGames, renderGame, gameChanged } from "./games.js";
import { renderChatInfo } from "./chat-info.js";
import { renderHome, renderTop } from "./home.js";
import { renderFind, clearFind } from "./find.js";

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");

// ---------- one redraw for every change ----------
// Everything happens on the home screen: the greeting and tiles stay on top, and the tapped tile's screen opens below.
const TABS = [...document.querySelectorAll("#top [data-tab]")].map((b) => b.dataset.tab); // the tiles, plus your photo for Settings
const BARE = ["login", "name-step"]; // the only screens without the tiles
const LIVE = { home: () => renderHome(openTile), search: () => renderFind(openTile), chats: renderChatList, chat: renderChat, todos: renderTodos, diary: renderDiary, games: renderGames, game: renderGame, "chat-info": renderChatInfo }; // redrawn on every change
const ENTER = { home: clearFind, settings: renderSettings, diary: enterDiary, chat: markRead }; // run on arrival (home: an empty search bar; chat: back from Chat info)
const ROOTS = ["home", "search"]; // screens a tile opens on top of, so back returns to them
const INSIDE = { chat: "chats", "chat-info": "chats", "diary-entry": "diary", game: "games" }; // screens inside a tab, and the tile that stays lit
const BADGES = {                                                       // the number on each tile
  "chat-badge": () => S.chats.reduce((n, c) => n + unreadIn(c.id), 0),
  "todo-badge": () => myTodos().length,
  "game-badge": () => myTurns().length,
};

function render() {
  for (const s of document.querySelectorAll("#app > section")) s.hidden = s.id !== S.screen; // every screen is a <section> in #app
  $("#top").hidden = BARE.includes(S.screen);
  $("#top").classList.toggle("slim", !!INSIDE[S.screen]); // inside a chat, entry or game: the tiles shrink to a strip
  $("#top").classList.toggle("searching", S.screen === "search"); // searching: only the search bar stays on top
  $("#find-cancel").hidden = S.screen !== "search";
  const lit = INSIDE[S.screen] ?? S.screen;
  document.querySelectorAll("#top [data-tab]").forEach((b) =>
    b.dataset.tab === lit ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  renderTop();

  const counts = Object.fromEntries(Object.entries(BADGES).map(([id, count]) => [id, count()]));
  for (const [id, n] of Object.entries(counts)) {
    $("#" + id).hidden = !n;
    $("#" + id).textContent = n;
  }
  const unread = counts["chat-badge"];
  if (unread) navigator.setAppBadge?.(unread).catch(() => {}); // Home Screen icon, where supported
  else navigator.clearAppBadge?.().catch(() => {});

  LIVE[S.screen]?.();
}
onChange(render);

function go(screen) {
  S.screen = screen;
  if (TABS.includes(screen)) S.chatId = null; // back from Chat info keeps the chat open
  render();
  ENTER[screen]?.();
}

// Back (Android, or a ‹ button) returns to the screen saved in that history entry; see open() in state.js.
const depth = () => history.state?.depth ?? 0;
window.onpopstate = (e) => go(e.state?.screen ?? "home");
history.replaceState({ screen: "home", depth: 0 }, ""); // the app always starts on home; after a reload the entry would keep its old screen

// Back to home: the first history entry. Used by the lit tile and by Cancel in search.
const closeTile = () => (depth() ? history.go(-depth()) : go("home"));
// A tile (or search) opened from home or search adds a history entry, so back returns there.
// Switching from one tile to another swaps the entry instead. Tapping the lit tile closes it.
function openTile(tab) {
  if (S.screen === tab) return closeTile();
  if (ROOTS.includes(S.screen)) history.pushState({ screen: tab, depth: depth() + 1 }, "");
  else history.replaceState({ screen: tab, depth: depth() }, "");
  go(tab);
}
$("#top").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) openTile(b.dataset.tab); };
$("#find-q").onfocus = () => { if (S.screen !== "search") openTile("search"); };
$("#find-cancel").onclick = closeTile;

// ---------- sign-in ----------
let signingUp = false;
$("#mode").onclick = () => {
  signingUp = !signingUp;
  $("#login-err").textContent = "";
  $("#login-btn").textContent = signingUp ? "Create account" : "Sign in";
  $("#mode").textContent = signingUp ? "Already have a password? Sign in" : "First time here? Create your password";
  $("#login-hint").textContent = signingUp ? "Pick a password of at least 8 characters." : "Sign in with your email and password.";
  $("#password").autocomplete = signingUp ? "new-password" : "current-password";
};
$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("#email").value.trim().toLowerCase(), password = $("#password").value;
  const err = $("#login-err");
  err.textContent = "";
  if (signingUp) {
    const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) return (err.textContent = /database error|not allowed/i.test(error.message)
      ? "This email isn't on Sanfit." : `Couldn't create your account: ${error.message}`);
    $("#mode").click();
    $("#login-hint").textContent = `Check ${email} and tap the confirm link. Then come back here and sign in.`;
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) err.textContent = /confirm/i.test(error.message)
      ? "Tap the confirm link in your email first, then sign in."
      : "Wrong email or password.";
  }
};

// The confirm link lands here; Supabase reports a used or stale link in the URL hash.
if (location.hash.includes("error_code")) {
  $("#login-err").textContent = "That link has expired or was already used. If you've confirmed before, just sign in.";
  history.replaceState(null, "", location.pathname);
} else if (location.hash.includes("access_token")) {
  history.replaceState(null, "", location.pathname); // a confirm link: the app ignores its tokens (sign in with your password), so don't keep them in the address bar
}

let live = null;
sb.auth.onAuthStateChange((event, session) => {
  if (session?.user && session.user.id !== S.me) {
    if (S.me) return forgetThisPhone().finally(() => location.reload()); // someone else signed in on this phone (another tab): start clean as them
    S.me = session.user.id;
    S.myEmail = session.user.email.toLowerCase();
    if (restoreCopy()) render(); // show what's on this phone straight away, then catch up
    setTimeout(start); // outside the auth callback
  }
  if (event === "SIGNED_OUT") forgetThisPhone().finally(() => location.reload()); // start clean: nothing of the last person stays on the phone
});
sb.auth.getSession().then(({ data }) => { if (!data.session) { S.screen = "login"; render(); } });

let startFailures = 0, startTimer;
// Back online while waiting for the next try: don't make the person wait out a long delay.
addEventListener("online", () => { if (startFailures) { clearTimeout(startTimer); start(); } });
let starting = false;
async function start() { // one start at a time: the retry timer, the online event and sign-in can all ask for it
  if (starting) return;
  starting = true;
  try { await startOnce(); } finally { starting = false; }
}
async function startOnce() {
  // Offline or the server is down at launch: retry (slower each time, one error toast), don't ask for a name again.
  if ((await loadPeople(startFailures > 0)) === false) return void (startTimer = setTimeout(start, retryDelay(startFailures++)));
  startFailures = 0;
  if (!S.people[S.me]) { S.screen = "name-step"; return render(); }
  await Promise.all([loadChats(), loadMessages(), loadReactions(), loadTodos(), loadGames()]);
  subscribe();
  syncAlerts(); // a phone that has alerts on but the database lost them gets them back, without a visit to Settings
  if (BARE.includes(S.screen)) go("home"); // coming from sign-in or the name step; otherwise stay where you are
}

$("#name-form").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.from("profiles").upsert({ id: S.me, name: $("#first-name").value.trim() });
  error ? alertBox(error) : start();
};

// ---------- live updates ----------
function subscribe() {
  live?.unsubscribe();
  live = sb.channel("sanfit")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => { addMsg(p.new); markRead(); })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (p) => {
      // Read receipts: patch in place. A full reload per receipt could land after a newer message and hide it.
      const m = S.messages.find((x) => x.id === p.new.id);
      if (m) { m.read_at = p.new.read_at; render(); }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, loadReactions)
    .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, loadTodos)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadPeople())
    .on("postgres_changes", { event: "*", schema: "public", table: "games" }, gameChanged)
    .subscribe();
}
// Phones drop the connection in the background; catch up on return.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !S.me || !S.people[S.me]) return;
  loadMessages().then(markRead);
  loadReactions();
  loadTodos();
  loadGames(true);
});
