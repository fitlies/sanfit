// Game rules for Tic-tac-toe, Connect Four and Memory match. Pure functions, no screen code, so they're tested.
// A game state: { players: [a, b], turn: a | b | null (null once it's over), winner: a | b | "draw" | null, ...board }.
// move() returns the next state, or null when the move isn't allowed. A player is a user id, or "phone".

const other = (s, p) => (s.players[0] === p ? s.players[1] : s.players[0]);
const ended = (s, winner) => ({ ...s, turn: null, winner });

// ---------- Tic-tac-toe: 3 x 3, cells hold the player who took them ----------
const LINES3 = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const lineOf = (board) => LINES3.find(([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c]);

const tictactoe = {
  name: "Tic-tac-toe",
  start: (players) => ({ players, turn: players[0], winner: null, board: Array(9).fill(null), line: null }),
  move(s, p, at) {
    if (s.turn !== p || s.board[at] !== null) return null;
    const board = s.board.with(at, p), line = lineOf(board);
    if (line) return { ...ended(s, p), board, line };
    if (board.every(Boolean)) return { ...ended(s, "draw"), board };
    return { ...s, board, turn: other(s, p) };
  },
  // The phone: win if it can, else block, else centre, else a corner, else anything. Beatable on purpose.
  computer(s, p, rand = Math.random) {
    const free = s.board.map((v, i) => (v ? null : i)).filter((i) => i !== null);
    const winsFor = (who) => free.find((i) => lineOf(s.board.with(i, who)));
    const corners = [0, 2, 6, 8].filter((i) => free.includes(i));
    return winsFor(p) ?? winsFor(other(s, p)) ?? (free.includes(4) ? 4 : null) ??
      (corners.length ? corners[Math.floor(rand() * corners.length)] : free[Math.floor(rand() * free.length)]);
  },
};

// ---------- Connect Four: 7 columns x 6 rows, row 0 at the top; a move is a column ----------
const COLS = 7, ROWS = 6;
function fourFrom(board, i) {
  const p = board[i], r = Math.floor(i / COLS), c = i % COLS;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [i];
    for (const dir of [1, -1]) {
      for (let k = 1; k < 4; k++) {
        const rr = r + dr * k * dir, cc = c + dc * k * dir;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || board[rr * COLS + cc] !== p) break;
        cells.push(rr * COLS + cc);
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}
const dropRow = (board, col) => { for (let r = ROWS - 1; r >= 0; r--) if (!board[r * COLS + col]) return r; return -1; };

const connect4 = {
  name: "Connect Four",
  cols: COLS,
  rows: ROWS,
  start: (players) => ({ players, turn: players[0], winner: null, board: Array(COLS * ROWS).fill(null), line: null, last: null }),
  move(s, p, col) {
    const r = s.turn === p && col >= 0 && col < COLS ? dropRow(s.board, col) : -1;
    if (r < 0) return null;
    const i = r * COLS + col, board = s.board.with(i, p), line = fourFrom(board, i);
    if (line) return { ...ended(s, p), board, line, last: i };
    if (board.every(Boolean)) return { ...ended(s, "draw"), board, last: i };
    return { ...s, board, turn: other(s, p), last: i };
  },
  // The phone: win, else block, else a column that doesn't hand you a win, nearer the middle first.
  computer(s, p, rand = Math.random) {
    const you = other(s, p);
    const open = [3, 2, 4, 1, 5, 0, 6].filter((c) => dropRow(s.board, c) >= 0);
    const cellIn = (c) => dropRow(s.board, c) * COLS + c;
    const winsAt = (who) => open.find((c) => fourFrom(s.board.with(cellIn(c), who), cellIn(c)));
    const win = winsAt(p) ?? winsAt(you);
    if (win !== undefined) return win;
    const safe = open.filter((c) => {
      const r = dropRow(s.board, c);
      if (r === 0) return true;
      const after = s.board.with(r * COLS + c, p), above = (r - 1) * COLS + c;
      return !fourFrom(after.with(above, you), above);
    });
    const pick = safe.length ? safe : open;
    return pick[Math.min(pick.length - 1, Math.floor(rand() * rand() * pick.length))]; // leans to the middle
  },
};

// ---------- Memory match: 16 cards, 8 pairs; find a pair and you go again ----------
export const MEMORY_EMOJI = ["🐶", "🐱", "🦊", "🐼", "🐸", "🐙", "🦋", "🌻", "🍉", "🍩", "🚲", "🎈"];
// Faces: "p:<photo path>" or "e:<emoji>". Uses up to 8 photos, then fills with emoji.
export function memoryDeck(photos, rand = Math.random) {
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const faces = [...shuffle([...new Set(photos)]).slice(0, 8).map((p) => `p:${p}`), ...shuffle(MEMORY_EMOJI).map((e) => `e:${e}`)].slice(0, 8);
  return shuffle([...faces, ...faces]);
}

const memory = {
  name: "Memory match",
  // open: cards turned up this turn; shown: the last pair that didn't match, left up until the next card is turned.
  start: (players, cards) => ({ players, turn: players[0], winner: null, cards, taken: Array(cards.length).fill(null),
    open: [], shown: [], scores: { [players[0]]: 0, [players[1]]: 0 } }),
  move(s, p, at) {
    if (s.turn !== p || s.taken[at] !== null || s.open.includes(at) || at < 0 || at >= s.cards.length) return null;
    if (!s.open.length) return { ...s, open: [at], shown: [] };
    const [first] = s.open;
    if (s.cards[first] !== s.cards[at]) return { ...s, open: [], shown: [first, at], turn: other(s, p) };
    const taken = s.taken.with(first, p).with(at, p), scores = { ...s.scores, [p]: s.scores[p] + 1 };
    const next = { ...s, taken, scores, open: [], shown: [] };
    if (!taken.every(Boolean)) return next;
    const [a, b] = s.players;
    return ended(next, scores[a] === scores[b] ? "draw" : scores[a] > scores[b] ? a : b);
  },
  // The phone remembers cards it has seen (`seen`: index -> face), but forgets some of them.
  computer(s, p, rand = Math.random, seen = new Map()) {
    const free = s.cards.map((_, i) => i).filter((i) => s.taken[i] === null && !s.open.includes(i));
    const recall = [...seen].filter(([i]) => free.includes(i) && rand() < 0.75);
    const unseen = free.filter((i) => !seen.has(i));
    const any = (list) => list[Math.floor(rand() * list.length)];
    if (s.open.length) {
      const face = s.cards[s.open[0]], match = recall.find(([, f]) => f === face);
      return match ? match[0] : any(unseen.length ? unseen : free);
    }
    const pair = recall.find(([i, f]) => recall.some(([j, g]) => j !== i && g === f));
    return pair ? pair[0] : any(unseen.length ? unseen : free);
  },
};

export const GAMES = { tictactoe, connect4, memory };
