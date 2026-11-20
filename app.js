import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from "./config.js";
import { dayLabel, timeLabel, initial, b64urlToBytes, fitSize } from "./lib.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const TICK = '<svg viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1 6l3 3 6-7"/></svg>';
const TICKS = '<svg viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1 6l3 3 6-7M7 8l1 1 6-7"/></svg>';

let me = null, people = {}, messages = [], todos = [], tab = "chat", live = null, stick = true;
const urls = {};
const partner = () => Object.values(people).find((p) => p.id !== me);
const nameOf = (id) => (id === me ? "You" : people[id]?.name ?? "Someone");

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");

// ---------- screens ----------
function show(id) {
  for (const s of ["login", "name-step", "chat", "todos", "settings"]) $("#" + s).hidden = s !== id;
  $("#tabs").hidden = !["chat", "todos", "settings"].includes(id);
}
function go(t) {
  tab = t;
  show(t);
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.dataset.tab === t ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  if (t === "chat") { scrollBottom(); markRead(); }
  if (t === "settings") renderSettings();
}
$("#tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) go(b.dataset.tab); };

// Keep layout above the iOS keyboard; hide tabs while typing like a pushed chat screen.
const fit = () => { $("#app").style.height = (visualViewport?.height ?? innerHeight) + "px"; scrollTo(0, 0); if (stick) scrollBottom(); };
visualViewport?.addEventListener("resize", fit);
document.addEventListener("focusin", (e) => { if (e.target.id === "text") document.body.classList.add("typing"); });
document.addEventListener("focusout", () => document.body.classList.remove("typing"));

// ---------- auth ----------
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

sb.auth.onAuthStateChange((event, session) => {
  if (session?.user && session.user.id !== me) { me = session.user.id; setTimeout(start); } // outside the auth callback
  if (event === "SIGNED_OUT") { me = null; live?.unsubscribe(); show("login"); }
});
sb.auth.getSession().then(({ data }) => { if (!data.session) show("login"); });

async function start() {
  if ((await loadPeople()) === false) return setTimeout(start, 4000); // offline at launch: retry, don't ask for a name again
  if (!people[me]) return show("name-step");
  await Promise.all([loadMessages(), loadTodos()]);
  subscribe();
  go(tab);
}

$("#name-form").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.from("profiles").upsert({ id: me, name: $("#first-name").value.trim() });
  if (error) return alertBox(error);
  start();
};

// ---------- data ----------
async function loadPeople() {
  const { data, error } = await sb.from("profiles").select("*");
  if (error) { alertBox(error); return false; }
  people = Object.fromEntries(data.map((p) => [p.id, p]));
  renderHeader();
}
async function loadMessages() {
  // shortcut: only the latest 300 messages load, add "load earlier" when history gets long.
  const { data, error } = await sb.from("messages").select("*").order("created_at", { ascending: false }).limit(300);
  if (error) return alertBox(error);
  messages = data.reverse();
  renderChat();
}
async function loadTodos() {
  const { data, error } = await sb.from("todos").select("*").order("created_at");
  if (error) return alertBox(error);
  todos = data;
  renderTodos();
}
function subscribe() {
  live?.unsubscribe();
  live = sb.channel("sanfit")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => { addMsg(p.new); markRead(); })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (p) => {
      const m = messages.find((x) => x.id === p.new.id);
      if (m) { m.read_at = p.new.read_at; renderChat(); }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, loadTodos)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, loadPeople)
    .subscribe();
}
// iOS drops the socket in the background; catch up on return.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && me && people[me]) { loadMessages().then(markRead); loadTodos(); }
});

function addMsg(m) {
  if (messages.some((x) => x.id === m.id)) return;
  messages.push(m);
  if (m.sender === me) stick = true;
  renderChat();
}
async function markRead() {
  if (!me || tab !== "chat" || document.visibilityState !== "visible") return;
  if (!messages.some((m) => m.sender !== me && !m.read_at)) return;
  await sb.from("messages").update({ read_at: new Date().toISOString() }).neq("sender", me).is("read_at", null);
}

function alertBox(error) {
  console.error(error);
  const s = $("#toast");
  s.hidden = false;
  s.textContent = `Didn't go through: ${error.message}. Check your connection and try again.`;
  clearTimeout(s.t);
  s.t = setTimeout(() => (s.hidden = true), 6000);
}

// ---------- chat ----------
function renderHeader() {
  const p = partner();
  $("#partner-initial").textContent = p ? initial(p.name) : "?";
  $("#partner-name").textContent = p ? p.name : "Waiting for your partner";
  $("#partner-sub").textContent = p ? "" : "They'll appear here once they sign in.";
  renderAssign();
}

const box = $("#msgs");
const scrollBottom = () => (box.scrollTop = box.scrollHeight);
box.addEventListener("scroll", () => (stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80));

function renderChat() {
  const top = box.scrollTop; // a read receipt re-renders everything; keep the spot if you're scrolled up
  box.replaceChildren();
  if (!messages.length) box.append(el("p", "empty", partner() ? `Say hi to ${partner().name}.` : "No messages yet."));
  let lastDay = "", lastSender = null;
  for (const m of messages) {
    const day = dayLabel(m.created_at);
    if (day !== lastDay) { box.append(el("div", "day", day)); lastDay = day; lastSender = null; }
    const mine = m.sender === me;
    const b = el("div", `bubble ${mine ? "out" : "in"}${m.sender !== lastSender ? " first" : ""}`);
    lastSender = m.sender;
    if (m.image_path) {
      b.classList.add("photo");
      if (!m.body) b.classList.add("notext");
      const img = el("img");
      img.alt = "Photo";
      img.onload = () => stick && scrollBottom();
      img.onclick = () => { $("#viewer img").src = img.src; $("#viewer").hidden = false; };
      photoUrl(m.image_path).then((u) => u && (img.src = u));
      b.append(img);
    }
    if (m.body) b.append(el("span", "text", m.body));
    const meta = el("span", "meta", timeLabel(m.created_at));
    if (mine) {
      const t = el("span", m.read_at ? "read" : "");
      t.innerHTML = m.read_at ? TICKS : TICK;
      t.setAttribute("aria-label", m.read_at ? "Read" : "Sent");
      meta.append(t);
    }
    b.append(meta);
    box.append(b);
  }
  if (stick) scrollBottom(); else box.scrollTop = top;
}

async function photoUrl(path) {
  if (!urls[path]) {
    // shortcut: links last 24h; reopen the app if a photo stops loading after a day open.
    const { data } = await sb.storage.from("photos").createSignedUrl(path, 86400);
    urls[path] = data?.signedUrl;
  }
  return urls[path];
}
$("#viewer").onclick = () => ($("#viewer").hidden = true);

const text = $("#text");
text.oninput = () => {
  text.style.height = "auto";
  text.style.height = text.scrollHeight + "px";
  $("#send").disabled = !text.value.trim();
};
text.onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && matchMedia("(hover: hover)").matches) { e.preventDefault(); $("#composer").requestSubmit(); }
};
// Keep the keyboard up when tapping send, like WhatsApp (and stop the tab bar jumping under the finger).
$("#send").onpointerdown = (e) => e.preventDefault();
$("#composer").onsubmit = async (e) => {
  e.preventDefault();
  const body = text.value.trim();
  if (!body) return;
  text.value = ""; text.oninput();
  const { data, error } = await sb.from("messages").insert({ body }).select().single();
  if (error) { text.value = body; text.oninput(); return alertBox(error); }
  addMsg(data);
};

$("#attach").onclick = () => $("#file").click();
$("#file").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  const s = $("#chat-status");
  for (const [i, f] of files.entries()) {
    s.hidden = false;
    s.textContent = files.length > 1 ? `Sending photo ${i + 1} of ${files.length}…` : "Sending photo…";
    const blob = await shrink(f);
    const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const up = await sb.storage.from("photos").upload(path, blob, { contentType: blob.type || "image/jpeg" });
    if (up.error) { alertBox(up.error); continue; }
    const { data, error } = await sb.from("messages").insert({ image_path: path }).select().single();
    if (error) { alertBox(error); continue; }
    addMsg(data);
  }
  s.hidden = true;
};

// Resize to 1600px JPEG so photos load fast and the free storage lasts. Falls back to the original.
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const [w, h] = fitSize(bmp.width, bmp.height, 1600);
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    return await new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no()), "image/jpeg", 0.82));
  } catch {
    return file;
  }
}

// ---------- to-dos ----------
function renderAssign() {
  const p = partner();
  const opts = [["", "Anyone"], [me, "Me"], ...(p ? [[p.id, p.name]] : [])];
  const cur = document.querySelector("#assign input:checked")?.value ?? "";
  $("#assign").replaceChildren(...opts.map(([v, label]) => {
    const l = el("label");
    const i = Object.assign(el("input"), { type: "radio", name: "assignee", value: v, checked: v === cur });
    l.append(i, el("span", null, label));
    return l;
  }));
}

$("#todo-form").onsubmit = async (e) => {
  e.preventDefault();
  const title = $("#todo-title").value.trim();
  if (!title) return;
  const assignee = document.querySelector("#assign input:checked")?.value || null;
  const { error } = await sb.from("todos").insert({ title, assignee });
  if (error) return alertBox(error);
  $("#todo-title").value = "";
  loadTodos();
};

function todoRow(t) {
  const r = el("div", "row" + (t.done_at ? " done" : ""));
  const c = el("button", "check");
  c.setAttribute("aria-label", t.done_at ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`);
  if (t.done_at) c.innerHTML = TICK;
  c.onclick = async () => {
    const done = !t.done_at;
    const { error } = await sb.from("todos").update({ done_at: done ? new Date().toISOString() : null, done_by: done ? me : null }).eq("id", t.id);
    error ? alertBox(error) : loadTodos();
  };
  const main = el("div", "tmain");
  main.append(el("span", "ttitle", t.title));
  if (t.done_at) {
    const when = dayLabel(t.done_at) === "Today" ? timeLabel(t.done_at) : dayLabel(t.done_at);
    main.append(el("span", "tsub", `Done by ${nameOf(t.done_by)}, ${when}`));
  }
  r.append(c, main);
  if (t.assignee && !t.done_at) r.append(el("span", "for" + (t.assignee === me ? " me" : ""), t.assignee === me ? "For you" : `For ${nameOf(t.assignee)}`));
  const d = el("button", "del", "×");
  d.setAttribute("aria-label", `Delete "${t.title}"`);
  d.onclick = async () => {
    const { error } = await sb.from("todos").delete().eq("id", t.id);
    error ? alertBox(error) : loadTodos();
  };
  r.append(d);
  return r;
}

function renderTodos() {
  const open = todos.filter((t) => !t.done_at);
  const done = todos.filter((t) => t.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at));
  $("#open-list").replaceChildren(...(open.length ? open.map(todoRow) : [el("p", "none", "Nothing to do. Add something above.")]));
  $("#done-list").hidden = !done.length;
  $("#done-list").replaceChildren(el("h2", null, "Done"), ...done.map(todoRow));
  const mine = open.filter((t) => t.assignee === me).length;
  $("#todo-badge").hidden = !mine;
  $("#todo-badge").textContent = mine;
}

// ---------- settings ----------
$("#rename-form").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.from("profiles").update({ name: $("#my-name").value.trim() }).eq("id", me);
  error ? alertBox(error) : loadPeople();
};

const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;
async function currentSub() {
  return "serviceWorker" in navigator ? (await navigator.serviceWorker.ready).pushManager?.getSubscription() : null;
}
$("#theme").onchange = (e) => {
  try { localStorage.setItem("theme", e.target.value); } catch { /* storage blocked: keep following the phone */ }
  applyTheme();
};
async function renderSettings() {
  $("#my-name").value = people[me]?.name ?? "";
  document.querySelector(`#theme input[value="${applyTheme()}"]`).checked = true;
  const t = $("#push-text"), b = $("#push-btn");
  b.hidden = true;
  if (!("PushManager" in window) || !standalone()) {
    t.textContent = "To get message alerts, open Sanfit from your Home Screen. In Safari, tap Share, then Add to Home Screen.";
  } else if (Notification.permission === "denied") {
    t.textContent = "Notifications are blocked. Turn them on in your iPhone's Settings > Notifications > Sanfit.";
  } else if (Notification.permission === "granted" && (await currentSub())) {
    t.textContent = "On. You'll get an alert for each new message.";
  } else {
    t.textContent = "Get an alert when a new message arrives.";
    b.hidden = false;
  }
}
$("#push-btn").onclick = async () => {
  if ((await Notification.requestPermission()) !== "granted") return renderSettings();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(VAPID_PUBLIC_KEY) });
    const { error } = await sb.from("push_subs").upsert({ endpoint: sub.endpoint, sub: sub.toJSON(), user_id: me });
    if (error) throw error;
  } catch (err) {
    alertBox(err); // e.g. VAPID key in config.js not filled in
  }
  renderSettings();
};
$("#signout").onclick = async () => {
  const sub = await currentSub();
  if (sub) { await sb.from("push_subs").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
  await sb.auth.signOut();
};
