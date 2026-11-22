// Games tab: Tic-tac-toe, Connect Four and Memory match, against the other person in a chat or against the phone.
// Two-player games are one row each in the database; a move sends a few hundred bytes. Games against the phone
// stay on this phone and use no data at all.
import { GAMES, memoryDeck } from "./games-lib.js";
import { S, sb, $, el, changed, save, alertBox, fileUrl, otherEmail, personByEmail } from "./state.js";

const PHONE = "phone";
let solo = null;         // a game against the phone: { id: "phone", kind, state }. shortcut: not kept once the app closes
let choosing = null;     // the game whose "who with?" list is open
let thinking = null;     // the phone's next move, on a short delay so you can see it
const seen = new Map();  // Memory match: cards the phone has seen (index -> face)

const current = () => (S.gameId === PHONE ? solo : S.games.find((g) => g.id === S.gameId));
const partnerIn = (chatId) => personByEmail(otherEmail(S.chats.find((c) => c.id === chatId) ?? { members: [] }));
const nameOf = (p) => (p === S.me ? "You" : p === PHONE ? "The phone" : S.people[p]?.name ?? "Someone");
const photosIn = (chatId) => S.messages.filter((m) => m.image_path && (chatId == null || m.chat_id === chatId)).map((m) => m.image_path);
const fresh = (kind, players, chatId) =>
  kind === "memory" ? GAMES.memory.start(players, memoryDeck(photosIn(chatId))) : GAMES[kind].start(players);

function result(s) {
  if (s.winner === "draw") return "It's a draw";
  if (s.winner) return s.winner === S.me ? "You won! 🎉" : `${nameOf(s.winner)} won`;
  return s.turn === S.me ? "Your turn" : `${nameOf(s.turn)}'s turn`;
}

// ---------- the list ----------
const ICONS = {
  tictactoe: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M14 5v30M26 5v30M5 14h30M5 26h30"/><path d="M7 7l5 5M12 7l-5 5" stroke="var(--accent)"/><circle cx="31" cy="31" r="3" stroke="var(--p2)"/></svg>',
  connect4: '<svg viewBox="0 0 40 40"><rect x="3" y="6" width="34" height="30" rx="5" fill="var(--chip)"/><g fill="var(--wall)"><circle cx="11" cy="14" r="3.5"/><circle cx="20" cy="14" r="3.5"/><circle cx="29" cy="14" r="3.5"/><circle cx="29" cy="23" r="3.5"/></g><circle cx="11" cy="23" r="3.5" fill="var(--p2)"/><circle cx="20" cy="23" r="3.5" fill="var(--accent)"/><circle cx="11" cy="31" r="3.5" fill="var(--accent)"/><circle cx="20" cy="31" r="3.5" fill="var(--p2)"/><circle cx="29" cy="31" r="3.5" fill="var(--accent)"/></svg>',
  memory: '<svg viewBox="0 0 40 40"><rect x="4" y="6" width="14" height="18" rx="3" fill="var(--out)"/><rect x="22" y="6" width="14" height="18" rx="3" fill="var(--in)" stroke="var(--line)"/><text x="29" y="19" font-size="9" text-anchor="middle">🐶</text><rect x="4" y="27" width="14" height="9" rx="3" fill="var(--out)"/><rect x="22" y="27" width="14" height="9" rx="3" fill="var(--out)"/></svg>',
};

export function renderGames() {
  $("#game-kinds").replaceChildren(...Object.entries(GAMES).map(([kind, g]) => {
    const b = el("button", "gkind");
    b.innerHTML = ICONS[kind];
    b.firstChild.setAttribute("aria-hidden", "true");
    b.append(el("span", null, g.name));
    b.setAttribute("aria-expanded", choosing === kind);
    b.onclick = () => { choosing = choosing === kind ? null : kind; changed(); };
    return b;
  }));

  const who = $("#game-who");
  who.hidden = !choosing;
  if (choosing) {
    const people = S.chats.map((c) => [c.id, partnerIn(c.id)]).filter(([, p]) => p);
    who.replaceChildren(el("p", "gwho-title", `Play ${GAMES[choosing].name} with`),
      ...people.map(([chatId, p]) => {
        const b = el("button", "gwho", p.name);
        b.onclick = () => startWith(choosing, chatId, p.id);
        return b;
      }),
      Object.assign(el("button", "gwho", "The phone"), { onclick: () => startSolo(choosing) }));
  }

  const when = (g) => Date.parse(g.updated_at);
  const list = [...S.games].sort((a, b) => (b.turn === S.me) - (a.turn === S.me) || when(b) - when(a)); // your turn first
  $("#game-list").replaceChildren(...(list.length ? list.map((g) => {
    const row = el("div", "row grow");
    const open = el("button", "tmain");
    open.onclick = () => openGame(g.id);
    open.append(el("span", "ttitle", `${GAMES[g.kind].name} with ${partnerIn(g.chat_id)?.name ?? "someone"}`),
      el("span", "tsub" + (g.turn === S.me ? " yours" : ""), result(g.state)));
    row.append(open);
    return row;
  }) : [el("p", "none", "No games yet. Pick one above to start.")]));
}

async function startWith(kind, chatId, partner) {
  const state = fresh(kind, [S.me, partner], chatId);
  const { data, error } = await sb.from("games").insert({ chat_id: chatId, kind, state, turn: state.turn }).select().single();
  if (error) return alertBox(error);
  choosing = null;
  S.games = [data, ...S.games.filter((g) => g.id !== data.id)];
  openGame(data.id);
}
function startSolo(kind) {
  choosing = null;
  seen.clear();
  solo = { id: PHONE, kind, state: fresh(kind, [S.me, PHONE], null) };
  openGame(PHONE);
}
function openGame(id) {
  S.gameId = id;
  S.screen = "game";
  history.pushState({ game: id }, ""); // so the back button returns to the list
  changed();
}

// ---------- one game ----------
export function renderGame() {
  const g = current();
  if (!g) { $("#game-status").textContent = "This game was removed."; $("#board").replaceChildren(); return; }
  const s = g.state, [p0, p1] = s.players;
  $("#game-title").textContent = GAMES[g.kind].name;
  $("#game-sub").textContent = g.id === PHONE ? "against the phone" : `with ${nameOf(s.players.find((p) => p !== S.me))}`;
  $("#game-players").replaceChildren(...[[p0, "p0"], [p1, "p1"]].map(([p, cls]) => {
    const chip = el("span", `gchip ${cls}` + (s.turn === p ? " now" : ""));
    chip.append(el("span", "gmark", g.kind === "tictactoe" ? (cls === "p0" ? "✕" : "◯") : ""), el("span", null, nameOf(p)));
    if (s.scores) chip.append(el("b", null, s.scores[p]));
    return chip;
  }));
  $("#game-status").textContent = result(s);
  $("#game-status").classList.toggle("yours", s.turn === S.me);
  $("#game-again").hidden = !!s.turn;
  $("#game-end").textContent = g.id === PHONE ? "End game" : "Remove game";
  const board = $("#board");
  board.className = `board ${g.kind}` + (s.turn === S.me ? "" : " waiting");
  board.replaceChildren(...BOARDS[g.kind](s));
}

const mark = (s, i) => (s.board[i] === null ? "" : s.board[i] === s.players[0] ? "p0" : "p1");
const BOARDS = {
  tictactoe: (s) => s.board.map((v, i) => {
    const b = el("button", `cell ${mark(s, i)}` + (s.line?.includes(i) ? " win" : ""), v === null ? "" : v === s.players[0] ? "✕" : "◯");
    b.setAttribute("aria-label", `Row ${Math.floor(i / 3) + 1}, column ${(i % 3) + 1}: ${v === null ? "empty" : nameOf(v)}`);
    b.onclick = () => play(i);
    return b;
  }),
  connect4: (s) => s.board.map((v, i) => {
    const col = i % GAMES.connect4.cols;
    const b = el("button", `hole ${mark(s, i)}` + (s.line?.includes(i) ? " win" : "") + (s.last === i ? " last" : ""));
    b.setAttribute("aria-label", `Column ${col + 1}`);
    b.onclick = () => play(col);
    return b;
  }),
  memory: (s) => s.cards.map((face, i) => {
    const up = s.taken[i] !== null || s.open.includes(i) || s.shown.includes(i);
    const b = el("button", "mcard" + (up ? " up" : "") + (s.taken[i] !== null ? ` got ${s.taken[i] === s.players[0] ? "p0" : "p1"}` : ""));
    b.setAttribute("aria-label", up ? (face.startsWith("e:") ? face.slice(2) : "Photo") : `Card ${i + 1}, face down`);
    if (up && face.startsWith("e:")) b.textContent = face.slice(2);
    if (up && face.startsWith("p:")) {
      const img = el("img");
      img.alt = "";
      fileUrl("photos", face.slice(2)).then((u) => u && (img.src = u));
      b.append(img);
    }
    b.onclick = () => play(i);
    return b;
  }),
};

function play(at) {
  const g = current(), next = g && GAMES[g.kind].move(g.state, S.me, at);
  if (next) apply(g, next);
}
function apply(g, next) {
  for (const i of [...(next.open ?? []), ...(next.shown ?? [])]) seen.set(i, next.cards[i]);
  g.state = next;
  g.turn = next.turn;
  g.updated_at = new Date().toISOString();
  changed();
  if (g.id === PHONE) return phoneMoves();
  save(sb.from("games").update({ state: next, turn: next.turn, updated_at: g.updated_at }).eq("id", g.id));
}
function phoneMoves() {
  clearTimeout(thinking);
  if (solo?.state.turn !== PHONE) return;
  thinking = setTimeout(() => {
    const s = solo.state;
    apply(solo, GAMES[solo.kind].move(s, PHONE, GAMES[solo.kind].computer(s, PHONE, Math.random, seen)));
  }, solo.kind === "memory" ? 900 : 450);
}

// Rematch: the other player starts. Memory match gets a fresh shuffle.
$("#game-again").onclick = () => {
  const g = current();
  if (!g || g.state.turn) return;
  const [a, b] = g.state.players;
  seen.clear();
  apply(g, fresh(g.kind, [b, a], g.chat_id ?? null));
};
$("#game-end").onclick = async () => {
  const g = current();
  if (!g || !confirm(g.id === PHONE ? "End this game?" : "Remove this game for both of you?")) return;
  clearTimeout(thinking);
  if (g.id === PHONE) solo = null;
  else if (!(await save(sb.from("games").delete().eq("id", g.id)))) return;
  S.games = S.games.filter((x) => x.id !== g.id);
  history.back();
};
$("#game-back").onclick = () => history.back();

// Live updates: the row arrives with the change, so nothing is fetched again.
export function gameChanged(p) {
  if (p.eventType === "DELETE") S.games = S.games.filter((g) => g.id !== p.old.id);
  else {
    const mine = S.games.find((g) => g.id === p.new.id);
    if (mine && Date.parse(mine.updated_at) > Date.parse(p.new.updated_at)) return; // an echo of an older move of yours
    S.games = [p.new, ...S.games.filter((g) => g.id !== p.new.id)];
  }
  changed();
}
