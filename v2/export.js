// "Download everything": your chats, to-dos, games and diary in one file on this phone.
// Photos are listed by name only. The file isn't locked, so it asks first.
import { localDate, every } from "./lib.js";
import { S, sb, $, alertBox } from "./state.js";

$("#export").onclick = async () => {
  if (!confirm("Anyone who opens this file can read your diary. Keep it somewhere safe.")) return;
  const btn = $("#export");
  btn.disabled = true;
  btn.textContent = "Getting everything…";
  try {
    // The database rules mean these only return your own chats, and only your own diary.
    const [people, messages, reactions, todos, games, diary] = await Promise.all([
      every(() => sb.from("profiles").select("id, name, email").order("id")),
      every(() => sb.from("messages").select("*").order("id")),
      every(() => sb.from("reactions").select("*").order("message_id").order("user_id")),
      every(() => sb.from("todos").select("*").order("id")),
      every(() => sb.from("games").select("*").order("id")),
      every(() => sb.from("diary_entries").select("*").order("entry_date").order("id")),
    ]);
    const file = new Blob([JSON.stringify({ saved: new Date().toISOString(), me: S.me, people, chats: S.chats, messages, reactions, todos, games, diary }, null, 1)],
      { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: `sanfit-${localDate()}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  } catch (err) {
    alertBox(err);
  }
  btn.disabled = false;
  btn.textContent = "Download everything";
};
