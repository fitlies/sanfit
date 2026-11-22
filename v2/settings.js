// Settings tab: profile photo, name, appearance, notifications, sign out. Drawn when you open the tab, not on every update.
import { b64urlToBytes } from "./lib.js";
import { VAPID_PUBLIC_KEY } from "./config.js";
import { S, sb, $, save, alertBox, loadPeople, fillAvatar, uploadPhoto, pref, setPref } from "./state.js";
import "./export.js"; // the "Download everything" button

// ---------- profile photo ----------
function drawPhoto() {
  const me = S.people[S.me];
  fillAvatar($("#my-avatar"), me?.name, me?.avatar_path);
  $("#photo-remove").hidden = !me?.avatar_path;
}
$("#photo-change").onclick = () => $("#photo-file").click();
$("#photo-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) setPhoto(file);
};
$("#photo-remove").onclick = () => setPhoto(null);

// Saves the new photo (or none), then deletes the old file.
async function setPhoto(file) {
  const old = S.people[S.me]?.avatar_path;
  const path = file && (await uploadPhoto("avatars", S.me, file, 400));
  if (file && !path) return;
  if (!(await save(sb.from("profiles").update({ avatar_path: path ?? null }).eq("id", S.me)))) return;
  if (old) sb.storage.from("avatars").remove([old]);
  await loadPeople();
  drawPhoto();
}

// ---------- name, appearance, alerts ----------
$("#rename-form").onsubmit = async (e) => {
  e.preventDefault();
  if (await save(sb.from("profiles").update({ name: $("#my-name").value.trim() }).eq("id", S.me))) loadPeople();
};

// "On this day" can bring back a hard day, so it can be turned off (on this phone). diary.js reads the same setting.
$("#otd").onchange = (e) => setPref("onThisDay", e.target.checked ? "on" : "off");

$("#theme").onchange = (e) => {
  setPref("theme", e.target.value);
  applyTheme(); // defined in index.html so the theme is set before first paint
};

async function currentSub() {
  return "serviceWorker" in navigator ? (await navigator.serviceWorker.ready).pushManager?.getSubscription() : null;
}

export async function renderSettings() {
  drawPhoto();
  $("#my-name").value = S.people[S.me]?.name ?? "";
  document.querySelector(`#theme input[value="${applyTheme()}"]`).checked = true;
  $("#otd").checked = pref("onThisDay") !== "off";
  const t = $("#push-text"), b = $("#push-btn");
  b.hidden = true;
  if (!("PushManager" in window)) {
    // iPhone only allows alerts for apps opened from the Home Screen.
    t.textContent = "To get alerts, open Sanfit from your Home Screen. iPhone: in Safari tap Share, then Add to Home Screen. Android: in Chrome tap ⋮, then Add to Home screen.";
  } else if (Notification.permission === "denied") {
    t.textContent = "Notifications are blocked. Turn them on in your phone's Settings, under Notifications for Sanfit (or Chrome).";
  } else if (Notification.permission === "granted" && (await currentSub())) {
    t.textContent = "On. You'll get alerts for new messages and to-dos.";
  } else {
    t.textContent = "Get alerts for new messages, to-dos given to you, and to-dos that come due.";
    b.hidden = false;
  }
}

$("#push-btn").onclick = async () => {
  if ((await Notification.requestPermission()) !== "granted") return renderSettings();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(VAPID_PUBLIC_KEY) });
    await save(sb.from("push_subs").upsert({ endpoint: sub.endpoint, sub: sub.toJSON(), user_id: S.me }));
  } catch (err) {
    alertBox(err);
  }
  renderSettings();
};

// Alerts stop first, while you're still signed in; signing out then clears the phone (forgetThisPhone in state.js).
// Offline, signing out fails and keeps you signed in, so say so instead of doing nothing. Trying again is safe.
const signOut = async (scope) => { const { error } = await sb.auth.signOut({ scope }); if (error) alertBox(error); };
$("#signout").onclick = async () => {
  const sub = await currentSub();
  if (sub) await sb.from("push_subs").delete().eq("endpoint", sub.endpoint);
  signOut("local"); // just this phone
};
$("#signout-all").onclick = async () => {
  if (!confirm("Sign out on every phone, this one too? You'll need your email and password to get back in.")) return;
  if (!(await save(sb.from("push_subs").delete().eq("user_id", S.me)))) return; // a lost phone stops getting message previews
  signOut("global"); // other phones sign out within the hour, when their sign-in next renews
};
