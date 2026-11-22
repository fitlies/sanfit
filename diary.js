// Diary tab: a private diary for each person. Entries by date with a mood and photos,
// a mood calendar, a PIN lock on this phone, and page themes. Only the writer can read entries.
import { localDate, monthGrid } from "./lib.js";
import { S, sb, $, el, changed, save, alertBox, fileUrl, shrink } from "./state.js";

const MOODS = [["😄", "Great"], ["🙂", "Good"], ["😐", "Okay"], ["😔", "Sad"], ["😠", "Angry"], ["😴", "Tired"]];
const THEMES = [["plain", "Plain"], ["paper", "Paper"], ["rose", "Rose"], ["mint", "Mint"], ["sky", "Sky"], ["night", "Night"]];

let entries = [];          // your own entries, newest first
let view = "list";         // list | calendar
let month = new Date();    // month shown in the calendar
let unlockedFor = null;    // who unlocked the diary on this phone (resets when the app goes to the background)
let draft = null;          // the entry open in the editor
let saveTimer = null, saving = Promise.resolve();
let picking = false;       // the photo picker is open (on Android that briefly sends the app to the background)
const isUnlocked = () => unlockedFor === S.me;
const whenDate = (iso) => new Date(`${iso}T00:00`);

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
  if (isUnlocked()) loadEntries();
  else setStep(storedPin() ? "unlock" : "create");
}

// ---------- PIN lock ----------
// shortcut: the PIN only hides the tab on this phone; entries are protected by your account, not by the PIN.
const pinKey = () => `diaryPin:${S.me}`;
const storedPin = () => { try { return localStorage.getItem(pinKey()); } catch { return null; } };
async function hashPin(pin) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${S.me}:${pin}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const STEPS = {
  create: "Create a 4-digit PIN for your diary",
  confirm: "Enter the same PIN again",
  unlock: "Enter your diary PIN",
  forgot: "Enter your Sanfit password to reset your PIN",
};
let step = "unlock", firstPin = "";
function setStep(next, error = "") {
  step = next;
  $("#pin-title").textContent = STEPS[step];
  $("#pin-err").textContent = error;
  $("#pin").hidden = step === "forgot";
  $("#pin-pass").hidden = step !== "forgot";
  $("#pin-forgot").hidden = step !== "unlock";
  (step === "forgot" ? $("#pin-password") : $("#pin")).focus();
}

$("#pin").oninput = async (e) => {
  const pin = e.target.value.replace(/\D/g, "").slice(0, 4);
  e.target.value = pin;
  if (pin.length < 4) return;
  e.target.value = "";
  if (step === "create") { firstPin = pin; return setStep("confirm"); }
  if (step === "confirm") {
    if (pin !== firstPin) return setStep("create", "Those didn't match. Start again.");
    try { localStorage.setItem(pinKey(), await hashPin(pin)); } catch { /* storage blocked: you'll be asked to create one next time */ }
    return unlock();
  }
  if ((await hashPin(pin)) === storedPin()) return unlock();
  setStep("unlock", "Wrong PIN. Try again.");
};
$("#pin-forgot").onclick = () => setStep("forgot");
$("#pin-pass").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: S.myEmail, password: $("#pin-password").value });
  $("#pin-password").value = "";
  if (error) return setStep("forgot", "That password didn't work.");
  try { localStorage.removeItem(pinKey()); } catch { /* nothing stored */ }
  setStep("create");
};

function unlock() {
  unlockedFor = S.me;
  loadEntries();
}

// Lock again whenever the app goes to the background; save anything being written first.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  flushDraft();
  if (picking) { picking = false; return; } // just the photo picker, not leaving the app
  unlockedFor = null;
  if (S.screen === "diary-entry") S.screen = "diary";
  if (S.screen === "diary") { setStep(storedPin() ? "unlock" : "create"); changed(); }
});

// ---------- page themes ----------
const currentTheme = () => { try { return localStorage.getItem("diaryTheme") || "plain"; } catch { return "plain"; } };
function applyPageTheme() {
  for (const id of ["#diary", "#diary-entry"]) $(id).dataset.dtheme = currentTheme();
}
$("#diary-theme").onclick = () => {
  const row = $("#theme-row");
  row.hidden = !row.hidden;
  row.replaceChildren(...THEMES.map(([key, label]) => {
    const b = el("button", `swatch sw-${key}`, label);
    b.setAttribute("aria-pressed", key === currentTheme());
    b.onclick = () => { try { localStorage.setItem("diaryTheme", key); } catch { /* this visit only */ } row.hidden = true; changed(); };
    return b;
  }));
};

// ---------- list and calendar ----------
export function renderDiary() {
  applyPageTheme();
  const open = isUnlocked();
  $("#diary-lock").hidden = open;
  $("#diary-main").hidden = !open;
  $("#diary-tools").hidden = !open;
  if (!open) return;
  $("#diary-view").setAttribute("aria-label", view === "list" ? "Show calendar" : "Show list");
  $("#diary-view").classList.toggle("on", view === "calendar");
  $("#diary-list").hidden = view !== "list";
  $("#diary-cal").hidden = view !== "calendar";
  view === "list" ? renderList() : renderCalendar();
}
$("#diary-view").onclick = () => { view = view === "list" ? "calendar" : "list"; changed(); };
$("#diary-new").onclick = () => openEntry(null);

function renderList() {
  if (!entries.length) return $("#diary-list").replaceChildren(el("p", "none", "No entries yet. Tap + to write your first one."));
  let lastMonth = "";
  const out = [];
  for (const e of entries) {
    const d = whenDate(e.entry_date);
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
  const prefix = localDate(new Date(y, m, 1)).slice(0, 7);
  const counts = {};
  for (const e of entries) if (e.mood && e.entry_date.startsWith(prefix)) counts[e.mood] = (counts[e.mood] ?? 0) + 1;
  const summary = MOODS.filter(([em]) => counts[em]).map(([em]) => `${em} ${counts[em]}`).join("   ");
  $("#cal-moods").textContent = summary || "No moods logged this month.";
}
$("#cal-prev").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); changed(); };
$("#cal-next").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); changed(); };

// ---------- writing an entry (saves as you type) ----------
function openEntry(e, date) {
  draft = e
    ? { ...e, title: e.title ?? "", body: e.body ?? "", photos: [...e.photos], dirty: false }
    : { id: null, entry_date: date ?? localDate(), mood: null, title: "", body: "", photos: [], dirty: false };
  S.screen = "diary-entry";
  history.pushState({ diary: true }, ""); // so the back button returns to the diary
  changed();
  applyPageTheme();
  $("#entry-date").value = draft.entry_date;
  $("#entry-title").value = draft.title;
  $("#entry-body").value = draft.body;
  $("#entry-delete").hidden = !draft.id;
  drawMoods();
  drawPhotos();
  fitBody();
}

function edited() {
  draft.dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDraft, 800);
}
function flushDraft() {
  clearTimeout(saveTimer);
  return (saving = saving.then(saveDraft)); // one save at a time, so a new entry is only inserted once
}
async function saveDraft() {
  const d = draft;
  if (!d?.dirty) return;
  d.dirty = false;
  const row = { entry_date: d.entry_date, mood: d.mood, title: d.title.trim() || null, body: d.body.trim() || null, photos: d.photos };
  if (d.id) { await save(sb.from("diary_entries").update({ ...row, updated_at: new Date().toISOString() }).eq("id", d.id)); return; } // awaited, so saves land in order
  if (!row.title && !row.body && !row.mood && !row.photos.length) return; // nothing written yet
  const { data, error } = await sb.from("diary_entries").insert(row).select().single();
  if (error) { d.dirty = true; return alertBox(error); }
  d.id = data.id;
  if (draft === d) $("#entry-delete").hidden = false;
}

const fitBody = () => { const t = $("#entry-body"); t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; };
$("#entry-date").onchange = (e) => { if (e.target.value) { draft.entry_date = e.target.value; edited(); } };
$("#entry-title").oninput = (e) => { draft.title = e.target.value; edited(); };
$("#entry-body").oninput = (e) => { draft.body = e.target.value; fitBody(); edited(); };

const leave = async () => { await flushDraft(); history.back(); };
$("#entry-done").onclick = leave;
$("#entry-back").onclick = leave;

$("#entry-delete").onclick = async () => {
  if (!draft?.id || !confirm("Delete this entry? This can't be undone.")) return;
  clearTimeout(saveTimer);
  const d = draft;
  draft = null;
  if (!(await save(sb.from("diary_entries").delete().eq("id", d.id)))) return;
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
  const tiles = draft.photos.map((path) => {
    const tile = el("div", "dthumb");
    const img = el("img");
    img.alt = "Diary photo";
    fileUrl("diary", path).then((u) => u && (img.src = u));
    img.onclick = () => { $("#viewer img").src = img.src; $("#viewer").hidden = false; };
    const x = el("button", "dthumb-x", "×");
    x.setAttribute("aria-label", "Remove photo");
    x.onclick = () => {
      draft.photos = draft.photos.filter((p) => p !== path);
      sb.storage.from("diary").remove([path]);
      drawPhotos();
      edited();
    };
    tile.append(img, x);
    return tile;
  });
  const add = el("button", "dthumb add", "+ Photo");
  add.onclick = () => { picking = true; $("#entry-file").click(); };
  $("#entry-photos").replaceChildren(...tiles, add);
}

$("#entry-file").onchange = async (e) => {
  picking = false;
  const files = [...e.target.files];
  e.target.value = "";
  const d = draft;
  for (const f of files) {
    const blob = await shrink(f, 1600);
    const path = `${S.me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    if (!(await save(sb.storage.from("diary").upload(path, blob, { contentType: blob.type || "image/jpeg" })))) continue;
    d.photos.push(path);
    if (draft === d) drawPhotos();
    d.dirty = true;
  }
  flushDraft();
};
