// Diary tab: a private diary for each person. Entries by date with a mood and photos,
// a mood calendar, a PIN lock on this phone, and page themes. Only the writer can read entries.
// Signing out reloads the app, so everything here belongs to the person signed in.
import { localDate, monthGrid } from "./lib.js";
import { MOODS, searchEntries, onThisDay, moodSummary } from "./diary-lib.js";
import { S, sb, $, el, changed, save, alertBox, fileUrl, shrink } from "./state.js";
const THEMES = [["plain", "Plain"], ["paper", "Paper"], ["rose", "Rose"], ["mint", "Mint"], ["sky", "Sky"], ["night", "Night"]];

let entries = [];          // your own entries, newest first
let view = "list";         // list | calendar
let query = "";            // what's typed in the diary search
let month = new Date();    // month shown in the calendar
let draft = null;          // the entry open in the editor
let saveTimer = null, saving = Promise.resolve();
let picking = false;       // the photo picker is open (on Android that briefly sends the app to the background)

// ---------- loading ----------
async function loadEntries() {
  const { data, error } = await sb.from("diary_entries").select("*")
    .order("entry_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) return alertBox(error);
  entries = data;
  changed();
}

// Called each time you open the Diary tab.
export async function enterDiary() {
  await flushDraft();
  draft = null;
  lock === "open" ? loadEntries() : relock();
}

// ---------- PIN lock ----------
// shortcut: the PIN only hides the tab on this phone; entries are protected by your account, not by the PIN.
const STEPS = {
  create: "Create a 4-digit PIN for your diary",
  confirm: "Enter the same PIN again",
  unlock: "Enter your diary PIN",
  forgot: "Enter your Sanfit password to reset your PIN",
};
let lock = "unlock", lockError = "", firstPin = "";
const pinKey = () => `diaryPin:${S.me}`;
const storedPin = () => { try { return localStorage.getItem(pinKey()); } catch { return null; } };
async function hashPin(pin) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${S.me}:${pin}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function setLock(step, error = "") {
  lock = step;
  lockError = error;
  if (step === "open") return loadEntries();
  changed();
  (step === "forgot" ? $("#pin-password") : $("#pin")).focus();
}
const relock = () => setLock(storedPin() ? "unlock" : "create");

$("#pin").oninput = async (e) => {
  const pin = e.target.value.replace(/\D/g, "").slice(0, 4);
  e.target.value = pin;
  if (pin.length < 4) return;
  e.target.value = "";
  if (lock === "create") { firstPin = pin; return setLock("confirm"); }
  if (lock === "confirm") {
    if (pin !== firstPin) return setLock("create", "Those didn't match. Start again.");
    try { localStorage.setItem(pinKey(), await hashPin(pin)); } catch { /* storage blocked: you'll be asked to create one next time */ }
    return setLock("open");
  }
  if ((await hashPin(pin)) === storedPin()) return setLock("open");
  setLock("unlock", "Wrong PIN. Try again.");
};
$("#pin-forgot").onclick = () => setLock("forgot");
$("#pin-pass").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: S.myEmail, password: $("#pin-password").value });
  $("#pin-password").value = "";
  if (error) return setLock("forgot", "That password didn't work.");
  try { localStorage.removeItem(pinKey()); } catch { /* nothing stored */ }
  setLock("create");
};

// Lock again whenever the app goes to the background; save anything being written first.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  flushDraft();
  if (picking) { picking = false; return; } // just the photo picker, not leaving the app
  if (lock !== "open") return;
  relock();
  if (S.screen === "diary-entry") history.back(); // the back button's own path to the diary
});

// ---------- page themes ----------
const currentTheme = () => { try { return localStorage.getItem("diaryTheme") || "plain"; } catch { return "plain"; } };
document.body.dataset.dtheme = currentTheme();
$("#diary-theme").onclick = () => {
  const row = $("#theme-row");
  row.hidden = !row.hidden;
  row.replaceChildren(...THEMES.map(([key, label]) => {
    const b = el("button", `swatch sw-${key}`, label);
    b.setAttribute("aria-pressed", key === currentTheme());
    b.onclick = () => {
      try { localStorage.setItem("diaryTheme", key); } catch { /* this visit only */ }
      document.body.dataset.dtheme = key;
      row.hidden = true;
    };
    return b;
  }));
};

// ---------- lock, list and calendar ----------
export function renderDiary() {
  const open = lock === "open";
  $("#diary-lock").hidden = open;
  $("#diary-main").hidden = !open;
  $("#diary-tools").hidden = !open;
  if (!open) {
    $("#pin-title").textContent = STEPS[lock];
    $("#pin-err").textContent = lockError;
    $("#pin").hidden = lock === "forgot";
    $("#pin-pass").hidden = lock !== "forgot";
    $("#pin-forgot").hidden = lock !== "unlock";
    return;
  }
  $("#diary-view").setAttribute("aria-label", view === "list" ? "Show calendar" : "Show list");
  $("#diary-view").classList.toggle("on", view === "calendar");
  $("#diary-list").hidden = view !== "list";
  $("#diary-cal").hidden = view !== "calendar";
  view === "list" ? renderList() : renderCalendar();
}
$("#diary-view").onclick = () => { view = view === "list" ? "calendar" : "list"; changed(); };
$("#diary-find").onclick = () => {
  const box = $("#diary-search");
  box.hidden = !box.hidden;
  query = box.hidden ? "" : query;
  $("#diary-q").value = query;
  if (!box.hidden) { view = "list"; $("#diary-q").focus(); }
  changed();
};
$("#diary-q").oninput = (e) => { query = e.target.value; changed(); };

// "On this day" can bring back a hard day, so Settings can turn it off (on this phone).
export const showOnThisDay = () => { try { return localStorage.getItem("onThisDay") !== "off"; } catch { return true; } };
$("#diary-new").onclick = () => openEntry(null);

function renderList() {
  if (!entries.length) return $("#diary-list").replaceChildren(el("p", "none", "No entries yet. Tap + to write your first one."));
  const shown = searchEntries(entries, query);
  if (!shown.length) return $("#diary-list").replaceChildren(el("p", "none", `Nothing found for "${query.trim()}".`));
  const out = query.trim() || !showOnThisDay() ? [] : onThisDay(entries, localDate()).slice(0, 3).map((e) => {
    const card = el("button", "dcard otd");
    card.onclick = () => openEntry(e);
    const main = el("div", "dmain");
    main.append(el("span", "dmonth", `On this day in ${e.entry_date.slice(0, 4)}`), el("span", "dtitle", e.title || "Untitled"),
      el("span", "dsnip", (e.body ?? "").slice(0, 140)));
    card.append(main);
    if (e.mood) card.append(el("span", "dmood", e.mood));
    return card;
  });
  let lastMonth = "";
  for (const e of shown) {
    const d = new Date(`${e.entry_date}T00:00`);
    const m = d.toLocaleDateString("en-SG", { month: "long", year: "numeric" });
    if (m !== lastMonth) { out.push(el("h2", "dmonth", m)); lastMonth = m; }
    const card = el("button", "dcard");
    card.onclick = () => openEntry(e);
    const date = el("div", "ddate");
    date.append(el("b", null, d.getDate()), el("span", null, d.toLocaleDateString("en-SG", { weekday: "short" })));
    const main = el("div", "dmain");
    main.append(el("span", "dtitle", e.title || "Untitled"), el("span", "dsnip", (e.body ?? "").slice(0, 140)));
    card.append(date, main);
    const side = el("div", "dside");
    if (e.mood) side.append(el("span", "dmood", e.mood));
    if (e.photos.length) side.append(el("span", "dcount", `📷 ${e.photos.length}`));
    card.append(side);
    out.push(card);
  }
  $("#diary-list").replaceChildren(...out);
}

function renderCalendar() {
  const y = month.getFullYear(), m = month.getMonth();
  $("#cal-title").textContent = month.toLocaleDateString("en-SG", { month: "long", year: "numeric" });
  const byDay = {};
  for (const e of entries) (byDay[e.entry_date] ??= []).push(e); // newest first, so [0] is the day's latest
  const today = localDate();
  const days = monthGrid(y, m).flat().map((day) => {
    if (!day) return el("span", "cal-blank");
    const iso = localDate(new Date(y, m, day)), list = byDay[iso];
    const cell = el("button", "cal-day" + (iso === today ? " today" : "") + (list ? " has" : ""));
    cell.append(el("span", "cal-num", day));
    if (list?.[0].mood) cell.append(el("span", "cal-mood", list[0].mood));
    cell.setAttribute("aria-label", `${day}${list ? `, ${list.length} ${list.length > 1 ? "entries" : "entry"}` : ""}`);
    cell.onclick = () => openEntry(list ? list[0] : null, iso);
    return cell;
  });
  $("#cal-grid").replaceChildren(...["S", "M", "T", "W", "T", "F", "S"].map((d) => el("span", "cal-head", d)), ...days);

  // This month's moods at a glance.
  const { list, top } = moodSummary(entries, localDate(new Date(y, m, 1)).slice(0, 7));
  $("#cal-moods").replaceChildren(...(list.length
    ? [el("span", null, list.map((x) => `${x.mood} ${x.count}`).join("   ")), ...(top ? [el("small", null, `Mostly ${top.label.toLowerCase()} this month`)] : [])]
    : [el("span", null, "No moods logged this month.")]));
}
$("#cal-prev").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); changed(); };
$("#cal-next").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); changed(); };

// ---------- writing an entry (saves as you type) ----------
// status: new (not in the database yet) | saved | deleted
function openEntry(e, date) {
  draft = e
    ? { ...e, title: e.title ?? "", body: e.body ?? "", photos: [...e.photos], status: "saved", dirty: false }
    : { id: crypto.randomUUID(), entry_date: date ?? localDate(), mood: null, title: "", body: "", photos: [], status: "new", dirty: false };
  S.screen = "diary-entry";
  history.pushState({ diary: true }, ""); // so the back button returns to the diary
  changed();
  $("#entry-date").value = draft.entry_date;
  $("#entry-title").value = draft.title;
  $("#entry-body").value = draft.body;
  drawMoods();
  drawPhotos();
  fitBody();
}

function edited() {
  draft.dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDraft, 800);
}
// Saves this entry (the open one by default). One save at a time, so they land in order.
// Resolves to true once the entry's latest state is in the database.
function flushDraft(d = draft) {
  clearTimeout(saveTimer);
  return (saving = saving.then(() => saveDraft(d)));
}
async function saveDraft(d) {
  if (!d?.dirty || d.status === "deleted") return true;
  const row = { id: d.id, entry_date: d.entry_date, mood: d.mood, title: d.title.trim() || null, body: d.body.trim() || null, photos: d.photos };
  if (d.status === "new" && !row.title && !row.body && !row.mood && !row.photos.length) return true; // nothing written yet
  d.dirty = false;
  const ok = await save(sb.from("diary_entries").upsert({ ...row, updated_at: new Date().toISOString() }));
  if (!ok) d.dirty = true;
  else if (d.status === "new") d.status = "saved";
  return ok;
}

const fitBody = () => { const t = $("#entry-body"); t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; };
$("#entry-date").onchange = (e) => { if (e.target.value) { draft.entry_date = e.target.value; edited(); } };
$("#entry-title").oninput = (e) => { draft.title = e.target.value; edited(); };
$("#entry-body").oninput = (e) => { draft.body = e.target.value; fitBody(); edited(); };

const leave = async () => { await flushDraft(); history.back(); };
$("#entry-done").onclick = leave;
$("#entry-back").onclick = leave;

$("#entry-delete").onclick = async () => {
  const d = draft;
  if (!confirm("Delete this entry? This can't be undone.")) return;
  clearTimeout(saveTimer);
  const was = d.status;
  d.status = "deleted"; // stops any later save, even from a photo still uploading
  await saving;         // let a save already on its way land first, so the delete comes after it
  if (!(await save(sb.from("diary_entries").delete().eq("id", d.id)))) { d.status = was; return; }
  if (d.photos.length) sb.storage.from("diary").remove(d.photos);
  history.back();
};

function drawMoods() {
  $("#entry-moods").replaceChildren(...MOODS.map(([em, label]) => {
    const b = el("button", "mood", em);
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", draft.mood === em);
    b.onclick = () => { draft.mood = draft.mood === em ? null : em; drawMoods(); edited(); };
    return b;
  }));
}

function drawPhotos() {
  const d = draft;
  const tiles = d.photos.map((path) => {
    const tile = el("div", "dthumb");
    const img = el("img");
    img.alt = "Diary photo";
    fileUrl("diary", path).then((u) => u && (img.src = u));
    img.onclick = () => { $("#viewer img").src = img.src; $("#viewer").hidden = false; };
    const x = el("button", "dthumb-x", "×");
    x.setAttribute("aria-label", "Remove photo");
    x.onclick = async () => {
      d.photos = d.photos.filter((p) => p !== path);
      d.dirty = true;
      if (draft === d) drawPhotos();
      if (await flushDraft(d)) sb.storage.from("diary").remove([path]); // only once the entry no longer lists it
    };
    tile.append(img, x);
    return tile;
  });
  const add = el("button", "dthumb add", "+ Photo");
  add.onclick = () => { picking = true; $("#entry-file").click(); };
  $("#entry-photos").replaceChildren(...tiles, add);
}

$("#entry-file").oncancel = () => { picking = false; };
$("#entry-file").onchange = async (e) => {
  picking = false;
  const files = [...e.target.files];
  e.target.value = "";
  const d = draft; // keep saving to this entry even if you leave the editor while photos upload
  for (const f of files) {
    const blob = await shrink(f, 1600);
    const path = `${S.me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    if (!(await save(sb.storage.from("diary").upload(path, blob, { contentType: blob.type || "image/jpeg" })))) continue;
    d.photos.push(path);
    d.dirty = true;
    if (draft === d) drawPhotos();
  }
  flushDraft(d);
};
