// To-dos tab: one list per chat, with who it's for and an optional due time.
import { dayLabel, timeLabel, dueText } from "./lib.js";
import { S, sb, $, el, TICK, changed, save, chatName, nameOf, personByEmail, otherEmail, loadTodos } from "./state.js";

function radios(container, name, opts, cur, onPick) {
  container.replaceChildren(...opts.map(([v, label]) => {
    const l = el("label");
    const i = Object.assign(el("input"), { type: "radio", name, value: v, checked: v === cur });
    i.onchange = () => onPick(v);
    l.append(i, el("span", null, label));
    return l;
  }));
}

const whenLabel = (d) => `${dayLabel(d).replace(/^(Today|Yesterday)$/, (w) => w.toLowerCase())}, ${timeLabel(d)}`;

export function renderTodos() {
  const pick = $("#todo-chat");
  pick.hidden = S.chats.length < 2;
  // Switching lists resets "who's it for", since the other person changes.
  radios(pick, "todo-chat", S.chats.map((c) => [c.id, chatName(c)]), S.todoChat, (v) => { S.todoChat = v; S.assignee = ""; changed(); });

  const c = S.chats.find((x) => x.id === S.todoChat);
  const other = c && personByEmail(otherEmail(c));
  radios($("#assign"), "assignee", [["", "Anyone"], [S.me, "Me"], ...(other ? [[other.id, other.name]] : [])], S.assignee, (v) => (S.assignee = v));

  const list = S.todos.filter((t) => t.chat_id === S.todoChat);
  const open = list.filter((t) => !t.done_at);
  const done = list.filter((t) => t.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at));
  $("#open-list").replaceChildren(...(open.length ? open.map(todoRow) : [el("p", "none", "Nothing to do. Add something above.")]));
  $("#done-list").hidden = !done.length;
  $("#done-list").replaceChildren(el("h2", null, "Done"), ...done.map(todoRow));
}

$("#todo-form").onsubmit = async (e) => {
  e.preventDefault();
  const title = $("#todo-title").value.trim();
  if (!title || !S.todoChat) return;
  const dueRaw = $("#todo-due").value; // local time from the phone's picker
  const due_at = dueRaw ? new Date(dueRaw).toISOString() : null;
  const countdown = !!due_at && $("#todo-countdown").checked;
  const repeat = (due_at && $("#todo-repeat").value) || null;
  if (!(await save(sb.from("todos").insert({ chat_id: S.todoChat, title, assignee: S.assignee || null, due_at, countdown, repeat })))) return;
  $("#todo-form").reset();
  $("#due-extras").hidden = true;
  loadTodos();
};
$("#todo-due").oninput = (e) => { $("#due-extras").hidden = !e.target.value; }; // repeats and countdowns need a date

// "every Monday" for a weekly to-do, from its due date.
const repeats = (t) => (t.repeat === "week" ? `every ${new Date(t.due_at).toLocaleDateString("en-SG", { weekday: "long" })}` : `every ${t.repeat}`);

function todoRow(t) {
  const r = el("div", "row" + (t.done_at ? " done" : ""));
  const c = el("button", "check");
  c.setAttribute("aria-label", t.done_at ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`);
  if (t.done_at) c.innerHTML = TICK;
  c.onclick = async () => {
    const done = !t.done_at;
    if (await save(sb.from("todos").update({ done_at: done ? new Date().toISOString() : null, done_by: done ? S.me : null }).eq("id", t.id))) loadTodos();
  };
  const main = el("div", "tmain");
  main.append(el("span", "ttitle", t.title));
  if (t.done_at) {
    main.append(el("span", "tsub", `Done by ${nameOf(t.done_by)}, ${whenLabel(t.done_at)}`));
  } else if (t.due_at) {
    const late = new Date(t.due_at) < new Date();
    main.append(el("span", "tsub" + (late ? " late" : ""), (t.countdown ? "⏳ " : "") + dueText(t.due_at) + (t.repeat ? `. Repeats ${repeats(t)}` : "")));
  }
  r.append(c, main);
  if (t.assignee && !t.done_at) r.append(el("span", "for" + (t.assignee === S.me ? " me" : ""), t.assignee === S.me ? "For you" : `For ${nameOf(t.assignee)}`));
  const d = el("button", "del", "×");
  d.setAttribute("aria-label", `Delete "${t.title}"`);
  d.onclick = async () => { if (await save(sb.from("todos").delete().eq("id", t.id))) loadTodos(); };
  r.append(d);
  return r;
}
