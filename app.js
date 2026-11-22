// Entry point: sign-in, which screen is showing, live updates. Each tab lives in its own file.
import { S, sb, $, onChange, alertBox, unreadIn, loadPeople, loadChats, loadMessages, loadReactions, loadTodos, loadGames, restoreCopy, forgetThisPhone } from "./state.js";
import { renderChatList, renderChat, addMsg, markRead } from "./chat.js";
import { renderTodos } from "./todos.js";
import { renderSettings } from "./settings.js";
import { renderDiary, enterDiary } from "./diary.js";
import { renderGames, renderGame, gameChanged } from "./games.js";

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");

// ---------- one redraw for every change ----------
const TABS = ["chats", "todos", "diary", "games", "settings"];
const LIVE = { chats: renderChatList, chat: renderChat, todos: renderTodos, diary: renderDiary, games: renderGames, game: renderGame }; // redrawn on every change
const ENTER = { settings: renderSettings, diary: enterDiary }; // run once when you open the tab
const BACK = { chat: "chats", "diary-entry": "diary", game: "games" }; // where the back button goes

function render() {
  for (const s of document.querySelectorAll("#app > section")) s.hidden = s.id !== S.screen; // every screen is a <section> in #app
  $("#tabs").hidden = !TABS.includes(S.screen);
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.dataset.tab === S.screen ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));

  const unread = S.chats.reduce((n, c) => n + unreadIn(c.id), 0);
  $("#chat-badge").hidden = !unread;
  $("#chat-badge").textContent = unread;
  if (unread) navigator.setAppBadge?.(unread).catch(() => {}); // Home Screen icon, where supported
  else navigator.clearAppBadge?.().catch(() => {});
  const mine = S.todos.filter((t) => !t.done_at && t.assignee === S.me).length;
  $("#todo-badge").hidden = !mine;
  $("#todo-badge").textContent = mine;
  const myTurn = S.games.filter((g) => g.turn === S.me).length;
  $("#game-badge").hidden = !myTurn;
  $("#game-badge").textContent = myTurn;

  LIVE[S.screen]?.();
}
onChange(render);

function go(screen) {
  S.screen = screen;
  S.chatId = null;
  render();
  ENTER[screen]?.();
}
$("#tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) go(b.dataset.tab); };
window.onpopstate = () => { if (BACK[S.screen]) go(BACK[S.screen]); }; // back button / Android back

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
}

let live = null;
sb.auth.onAuthStateChange((event, session) => {
  if (session?.user && session.user.id !== S.me) {
    S.me = session.user.id;
    S.myEmail = session.user.email.toLowerCase();
    if (restoreCopy()) render(); // show what's on this phone straight away, then catch up
    setTimeout(start); // outside the auth callback
  }
  if (event === "SIGNED_OUT") forgetThisPhone().finally(() => location.reload()); // start clean: nothing of the last person stays on the phone
});
sb.auth.getSession().then(({ data }) => { if (!data.session) { S.screen = "login"; render(); } });

async function start() {
  if ((await loadPeople()) === false) return setTimeout(start, 4000); // offline at launch: retry, don't ask for a name again
  if (!S.people[S.me]) { S.screen = "name-step"; return render(); }
  await Promise.all([loadChats(), loadMessages(), loadReactions(), loadTodos(), loadGames()]);
  subscribe();
  if (!TABS.includes(S.screen) && !BACK[S.screen]) go("chats"); // coming from sign-in; otherwise stay where the saved copy let you go
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
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, loadPeople)
    .on("postgres_changes", { event: "*", schema: "public", table: "games" }, gameChanged)
    .subscribe();
}
// Phones drop the connection in the background; catch up on return.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !S.me || !S.people[S.me]) return;
  loadMessages().then(markRead);
  loadReactions();
  loadTodos();
  loadGames();
});
