'use strict';
// Sudoku. Uses helpers from ../common.js.
//
// Two sizes: the usual 9×9 with 3×3 boxes, and 6×6 with 2×3 boxes (numbers 1 to 6)
// for smaller kids. Each size has its own records and its own board on the scoreboard.

const SIZES = {
  9: { boxRows: 3, boxCols: 3, givens: { easy: 45, medium: 36, hard: 30 }, game: 'sudoku' },
  6: { boxRows: 2, boxCols: 3, givens: { easy: 22, medium: 18, hard: 14 }, game: 'sudoku6' },
};

const store = makeStore('sd-');
const RECORDS = { 9: makeRecords(store), 6: makeRecords(makeStore('sd6-')) };

const boardEl = $('board');
const wrapEl = $('wrap');
const timeEl = $('time');
const filledEl = $('filled');
const HINT = 'Veldu reit og ýttu svo á tölu';

// Current game. Arrays have N×N entries, row by row; 0 means empty.
// Wrong numbers aren't shown straight away: only once every square is filled do the
// wrong ones get `marked` (red) and counted as mistakes. Changing a square unmarks it.
let N = 9, CELLS = 81;
let level, puzzle, solution, entries, marked, mistakes, done;
let undoStack = [];   // [{ i, before }]: what each changed square held before, most recent last
let selected = -1;
let elapsedMs = 0, runningSince = 0, ticker = null;
let els = [];

const records = () => RECORDS[N];

function setSize(n) {
  N = n;
  CELLS = n * n;
}

// --- puzzle generation ---

function box(i) {
  const { boxRows, boxCols } = SIZES[N];
  return Math.floor(Math.floor(i / N) / boxRows) * (N / boxCols) + Math.floor((i % N) / boxCols);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Backtracking with bitmasks; always tries the cell with the fewest options first.
// Fills `grid` in place with the first solution found and returns how many it found (up to `limit`).
function solve(grid, limit, randomOrder) {
  const rows = new Array(N).fill(0), cols = new Array(N).fill(0), boxes = new Array(N).fill(0);
  const all = ((1 << (N + 1)) - 1) & ~1;   // bits 1..N
  for (let i = 0; i < CELLS; i++) {
    if (!grid[i]) continue;
    const bit = 1 << grid[i];
    rows[Math.floor(i / N)] |= bit; cols[i % N] |= bit; boxes[box(i)] |= bit;
  }
  let count = 0;
  let first = null;

  const rec = () => {
    let best = -1, bestMask = 0, bestN = N + 1;
    for (let i = 0; i < CELLS; i++) {
      if (grid[i]) continue;
      const mask = ~(rows[Math.floor(i / N)] | cols[i % N] | boxes[box(i)]) & all;
      let n = 0;
      for (let m = mask; m; m &= m - 1) n++;
      if (n === 0) return;
      if (n < bestN) { best = i; bestMask = mask; bestN = n; if (n === 1) break; }
    }
    if (best < 0) {
      count++;
      if (!first) first = grid.slice();
      return;
    }
    const digits = [];
    for (let d = 1; d <= N; d++) if (bestMask & (1 << d)) digits.push(d);
    if (randomOrder) shuffle(digits);
    const r = Math.floor(best / N), c = best % N, b = box(best);
    for (const d of digits) {
      const bit = 1 << d;
      grid[best] = d; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      rec();
      grid[best] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      if (count >= limit) return;
    }
  };

  rec();
  if (first) for (let i = 0; i < CELLS; i++) grid[i] = first[i];
  return count;
}

// A full random grid, then numbers removed one by one as long as the answer stays unique.
function makePuzzle(lv) {
  const full = new Array(CELLS).fill(0);
  solve(full, 1, true);
  const p = full.slice();
  let givens = CELLS;
  for (const i of shuffle([...Array(CELLS).keys()])) {
    if (givens <= SIZES[N].givens[lv]) break;
    const keep = p[i];
    p[i] = 0;
    if (solve(p.slice(), 2, false) === 1) givens--;
    else p[i] = keep;
  }
  return { puzzle: p, solution: full };
}

// --- game state ---

function newPuzzle(lv, size = N) {
  setSize(size);
  level = lv;
  store.set('level', level);
  store.set('size', N);
  ({ puzzle, solution } = makePuzzle(level));
  entries = new Array(CELLS).fill(0);
  marked = new Array(CELLS).fill(false);
  undoStack = [];
  mistakes = 0;
  done = false;
  selected = -1;
  elapsedMs = 0;
  $('hint').textContent = HINT;
  $('overlay').hidden = true;
  $('confirm').hidden = true;
  buildBoard();
  startClock();
  saveGame();
}

function saveGame() {
  if (done) { store.remove('current'); return; }
  store.setJSON('current', { size: N, level, puzzle, solution, entries, marked, undo: undoStack, mistakes, elapsed: currentMs() });
}

function loadGame() {
  const g = store.getJSON('current', null);
  const size = g && SIZES[g.size] ? g.size : 9;   // puzzles saved before 6×6 have no size
  const ok = (a) => Array.isArray(a) && a.length === size * size;
  if (!g || !LEVEL_NAMES[g.level] || !ok(g.puzzle) || !ok(g.solution) || !ok(g.entries)) return false;
  setSize(size);
  ({ level, puzzle, solution, entries } = g);
  marked = ok(g.marked) ? g.marked.map(Boolean) : new Array(CELLS).fill(false);
  undoStack = Array.isArray(g.undo)
    ? g.undo.filter((u) => u && Number.isInteger(u.i) && u.i >= 0 && u.i < CELLS && !puzzle[u.i])
    : [];
  mistakes = Number(g.mistakes) || 0;
  elapsedMs = Number(g.elapsed) || 0;
  done = false;
  selected = -1;
  buildBoard();
  startClock();
  return true;
}

const value = (i) => puzzle[i] || entries[i];
const hasProgress = () => !done && entries.some(Boolean);

// --- clock: pauses while the app is in the background ---

function currentMs() {
  return elapsedMs + (runningSince ? Date.now() - runningSince : 0);
}
function elapsedSec() {
  return Math.floor(currentMs() / 1000);
}
function startClock() {
  stopClock();
  runningSince = Date.now();
  ticker = setInterval(updateClock, 250);
  updateClock();
}
function stopClock() {
  if (runningSince) elapsedMs += Date.now() - runningSince;
  runningSince = 0;
  clearInterval(ticker);
  ticker = null;
}
function updateClock() {
  timeEl.textContent = clock(elapsedSec());
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopClock();
    saveGame();
  } else if (!done) {
    startClock();
  }
});
window.addEventListener('pagehide', saveGame);

// --- drawing ---

function buildBoard() {
  const { boxRows, boxCols } = SIZES[N];
  boardEl.replaceChildren();
  boardEl.style.setProperty('--n', N);
  els = [];
  for (let i = 0; i < CELLS; i++) {
    const r = Math.floor(i / N), c = i % N;
    const b = document.createElement('button');
    b.type = 'button';
    // thick lines between boxes; no line after the last row and column
    b.className = 'cell'
      + (c % boxCols === boxCols - 1 && c < N - 1 ? ' bx' : '') + (c === N - 1 ? ' c9' : '')
      + (r % boxRows === boxRows - 1 && r < N - 1 ? ' by' : '') + (r === N - 1 ? ' r9' : '');
    b.dataset.i = i;
    boardEl.appendChild(b);
    els.push(b);
  }
  document.querySelectorAll('#levels button').forEach((b) => {
    b.classList.toggle('active', b.dataset.level === level);
  });
  document.querySelectorAll('#sizes button').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.size) === N);
  });
  // only the numbers that are used: 1 to 6 on the small board
  document.querySelectorAll('#pad [data-digit]').forEach((b) => {
    b.hidden = Number(b.dataset.digit) > N;
  });
  updateBest();
  fit();
  render();
}

function render() {
  const sel = selected;
  const selVal = sel >= 0 ? value(sel) : 0;
  const counts = new Array(N + 1).fill(0);
  let filled = 0;
  for (let i = 0; i < CELLS; i++) {
    const v = value(i);
    if (v) { counts[v]++; filled++; }
    const el = els[i];
    el.textContent = v || '';
    el.classList.toggle('given', !!puzzle[i]);
    el.classList.toggle('wrong', marked[i]);
    el.classList.toggle('sel', i === sel);
    const peer = sel >= 0 && i !== sel &&
      (Math.floor(i / N) === Math.floor(sel / N) || i % N === sel % N || box(i) === box(sel));
    el.classList.toggle('peer', peer);
    el.classList.toggle('same', !!selVal && i !== sel && v === selVal);
  }
  $('undo').disabled = done || !undoStack.length;
  // Each number shows how many are left to place, and greys out once all N are on the
  // board (right or wrong, so it doesn't give mistakes away).
  document.querySelectorAll('#pad [data-digit]').forEach((b) => {
    const d = Number(b.dataset.digit);
    if (!d || d > N) return;
    const left = Math.max(0, N - counts[d]);
    b.dataset.left = left;
    b.setAttribute('aria-label', `${d}, ${left} eftir`);
    b.classList.toggle('done', left === 0);
  });
  filledEl.textContent = `${filled}/${CELLS}`;
}

function updateBest() {
  const best = records().best(level);
  $('best').textContent = best ? clock(best) : '–';
}

// Biggest square cells that fit the space.
function fit() {
  const size = Math.floor(Math.min(wrapEl.clientWidth, wrapEl.clientHeight, N * 60) / N) - 1;
  boardEl.style.setProperty('--cell', Math.max(size, 24) + 'px');
}
window.addEventListener('resize', fit);

// --- input ---

// Undo history: what each changed square held before, most recent last.
const UNDO_MAX = 200;

function place(d) {
  if (done || selected < 0 || puzzle[selected]) return;
  if (entries[selected] === d) return;
  undoStack.push({ i: selected, before: entries[selected] });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  setCell(selected, d);
}

function undo() {
  if (done || !undoStack.length) return;
  const { i, before } = undoStack.pop();
  selected = i;
  setCell(i, before);
}

function setCell(i, d) {
  entries[i] = d;
  marked[i] = false;
  els[i].classList.remove('placed');
  void els[i].offsetWidth;   // restart the pop animation
  if (d) els[i].classList.add('placed');

  if (solution.every((v, i) => value(i) === v)) {
    render();
    return win();
  }
  // Every square filled but something's wrong: now show which ones.
  if (solution.every((_, i) => value(i))) {
    const wrong = entries.map((v, i) => !!v && v !== solution[i]);
    mistakes += wrong.filter((w, i) => w && !marked[i]).length;   // only ones not already shown
    marked = wrong;
    buzz([60, 40, 60]);
    $('hint').textContent = 'Næstum! Rauðu tölurnar eru rangar.';
  } else if (!marked.some(Boolean)) {
    $('hint').textContent = HINT;
  }
  render();
  saveGame();
}

function win() {
  done = true;
  stopClock();
  const time = elapsedSec();
  const best = records().best(level);
  const isRecord = records().add({ level, won: true, time, mistakes });
  store.remove('current');
  selected = -1;
  render();
  updateBest();
  buzz([40, 30, 40]);
  confetti();

  let text = isRecord ? `Nýtt met: ${clock(time)}! 🏆` : `Tíminn var ${clock(time)}. Metið er ${clock(best)}.`;
  text += mistakes ? ` ${errors(mistakes)[0].toUpperCase()}${errors(mistakes).slice(1)}.` : ' Engin villa ⭐';
  setTimeout(() => {
    if (!done) return;
    showResult('🎉', 'Þú kláraðir!', text);
    lbAfterWin(SIZES[N].game, level, time);
  }, 600);
}

// Icelandic: 1 villa, 2 villur, 21 villa
function errors(n) {
  return n + (n % 10 === 1 && n % 100 !== 11 ? ' villa' : ' villur');
}

boardEl.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || done) return;
  selected = Number(cell.dataset.i);
  render();
});

$('pad').addEventListener('click', (e) => {
  const b = e.target.closest('[data-digit]');
  if (b) place(Number(b.dataset.digit));
});

$('undo').addEventListener('click', undo);

// Keyboard on a computer: arrows to move, 1-9 to fill, Backspace to erase, Ctrl/Cmd+Z to undo.
document.addEventListener('keydown', (e) => {
  if (done || e.target.closest('input')) return;
  const moves = { ArrowUp: -N, ArrowDown: N, ArrowLeft: -1, ArrowRight: 1 };
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if (e.key in moves) {
    e.preventDefault();
    if (selected < 0) selected = Math.floor(CELLS / 2);
    else {
      const next = selected + moves[e.key];
      const sameRow = Math.floor(next / N) === Math.floor(selected / N);
      if (next >= 0 && next < CELLS && (Math.abs(moves[e.key]) === N || sameRow)) selected = next;
    }
    render();
  } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= N) {
    place(Number(e.key));
  } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
    place(0);
  }
});

// New puzzle: ask first if there's a puzzle in progress.
let pending = null;
function requestNew(lv, size = N) {
  if (hasProgress()) {
    pending = { lv, size };
    $('confirm').hidden = false;
  } else {
    newPuzzle(lv, size);
  }
}

$('confirm-yes').addEventListener('click', () => newPuzzle(pending ? pending.lv : level, pending ? pending.size : N));
$('levels').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && (b.dataset.level !== level || done)) requestNew(b.dataset.level);
});
$('sizes').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && (Number(b.dataset.size) !== N || done)) requestNew(level, Number(b.dataset.size));
});
$('new').addEventListener('click', () => requestNew(level));
$('again').addEventListener('click', () => newPuzzle(level));

$('trophy').addEventListener('click', () => {
  const stats = records().stats();
  const rows = Object.keys(LEVEL_NAMES).map((lv) => {
    const best = records().best(lv);
    return [LEVEL_NAMES[lv], best ? clock(best) : '–', String((stats[lv] || {}).won || 0)];
  });
  const games = records().history().map((g) => ({
    at: g.at,
    what: `🎉 ${LEVEL_NAMES[g.level] || ''}, ${g.mistakes ? errors(g.mistakes) : 'engin villa ⭐'}`,
    value: clock(g.time),
  }));
  showRecords(rows, games);
});

// --- start ---

if (!loadGame()) {
  const saved = store.get('level', 'easy');
  const size = Number(store.get('size', 9));
  newPuzzle(LEVEL_NAMES[saved] ? saved : 'easy', SIZES[size] ? size : 9);
}
registerServiceWorker('../sw.js');
