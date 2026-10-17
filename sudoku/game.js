'use strict';
// Sudoku. Uses helpers from ../common.js.

const GIVENS = { easy: 45, medium: 36, hard: 30 };   // numbers shown at the start

const store = makeStore('sd-');
const records = makeRecords(store);

const boardEl = $('board');
const wrapEl = $('wrap');
const timeEl = $('time');
const filledEl = $('filled');
const HINT = 'Veldu reit og ýttu svo á tölu';

// Current game. Arrays have 81 entries, row by row; 0 means empty.
// Wrong numbers aren't shown straight away: only once every square is filled do the
// wrong ones get `marked` (red) and counted as mistakes. Changing a square unmarks it.
let level, puzzle, solution, entries, marked, mistakes, done;
let selected = -1;
let elapsedMs = 0, runningSince = 0, ticker = null;
let els = [];

// --- puzzle generation ---

const box = (i) => Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3);

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
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    if (!grid[i]) continue;
    const bit = 1 << grid[i];
    rows[Math.floor(i / 9)] |= bit; cols[i % 9] |= bit; boxes[box(i)] |= bit;
  }
  let count = 0;
  let first = null;

  const rec = () => {
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (grid[i]) continue;
      const mask = ~(rows[Math.floor(i / 9)] | cols[i % 9] | boxes[box(i)]) & 0x3fe;
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
    for (let d = 1; d <= 9; d++) if (bestMask & (1 << d)) digits.push(d);
    if (randomOrder) shuffle(digits);
    const r = Math.floor(best / 9), c = best % 9, b = box(best);
    for (const d of digits) {
      const bit = 1 << d;
      grid[best] = d; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      rec();
      grid[best] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      if (count >= limit) return;
    }
  };

  rec();
  if (first) for (let i = 0; i < 81; i++) grid[i] = first[i];
  return count;
}

// A full random grid, then numbers removed one by one as long as the answer stays unique.
function makePuzzle(lv) {
  const full = new Array(81).fill(0);
  solve(full, 1, true);
  const p = full.slice();
  let givens = 81;
  for (const i of shuffle([...Array(81).keys()])) {
    if (givens <= GIVENS[lv]) break;
    const keep = p[i];
    p[i] = 0;
    if (solve(p.slice(), 2, false) === 1) givens--;
    else p[i] = keep;
  }
  return { puzzle: p, solution: full };
}

// --- game state ---

function newPuzzle(lv) {
  level = lv;
  store.set('level', level);
  ({ puzzle, solution } = makePuzzle(level));
  entries = new Array(81).fill(0);
  marked = new Array(81).fill(false);
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
  store.setJSON('current', { level, puzzle, solution, entries, marked, mistakes, elapsed: currentMs() });
}

function loadGame() {
  const g = store.getJSON('current', null);
  const ok = (a) => Array.isArray(a) && a.length === 81;
  if (!g || !GIVENS[g.level] || !ok(g.puzzle) || !ok(g.solution) || !ok(g.entries)) return false;
  ({ level, puzzle, solution, entries } = g);
  marked = ok(g.marked) ? g.marked.map(Boolean) : new Array(81).fill(false);
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
  boardEl.replaceChildren();
  els = [];
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / 9), c = i % 9;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell'
      + (c === 2 || c === 5 ? ' bx' : '') + (c === 8 ? ' c9' : '')
      + (r === 2 || r === 5 ? ' by' : '') + (r === 8 ? ' r9' : '');
    b.dataset.i = i;
    boardEl.appendChild(b);
    els.push(b);
  }
  document.querySelectorAll('#levels button').forEach((b) => {
    b.classList.toggle('active', b.dataset.level === level);
  });
  updateBest();
  fit();
  render();
}

function render() {
  const sel = selected;
  const selVal = sel >= 0 ? value(sel) : 0;
  const counts = new Array(10).fill(0);
  let filled = 0;
  for (let i = 0; i < 81; i++) {
    const v = value(i);
    if (v) { counts[v]++; filled++; }
    const el = els[i];
    el.textContent = v || '';
    el.classList.toggle('given', !!puzzle[i]);
    el.classList.toggle('wrong', marked[i]);
    el.classList.toggle('sel', i === sel);
    const peer = sel >= 0 && i !== sel &&
      (Math.floor(i / 9) === Math.floor(sel / 9) || i % 9 === sel % 9 || box(i) === box(sel));
    el.classList.toggle('peer', peer);
    el.classList.toggle('same', !!selVal && i !== sel && v === selVal);
  }
  // Each number shows how many are left to place, and greys out once nine are on the board
  // (right or wrong, so it doesn't give mistakes away).
  document.querySelectorAll('#pad [data-digit]').forEach((b) => {
    const d = Number(b.dataset.digit);
    if (!d) return;
    const left = Math.max(0, 9 - counts[d]);
    b.dataset.left = left;
    b.setAttribute('aria-label', `${d}, ${left} eftir`);
    b.classList.toggle('done', left === 0);
  });
  filledEl.textContent = `${filled}/81`;
}

function updateBest() {
  const best = records.best(level);
  $('best').textContent = best ? clock(best) : '–';
}

// Biggest square cells that fit the space.
function fit() {
  const size = Math.floor(Math.min(wrapEl.clientWidth, wrapEl.clientHeight, 9 * 56) / 9) - 1;
  boardEl.style.setProperty('--cell', Math.max(size, 24) + 'px');
}
window.addEventListener('resize', fit);

// --- input ---

function place(d) {
  if (done || selected < 0 || puzzle[selected]) return;
  if (entries[selected] === d) return;
  entries[selected] = d;
  marked[selected] = false;
  els[selected].classList.remove('placed');
  void els[selected].offsetWidth;   // restart the pop animation
  if (d) els[selected].classList.add('placed');

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
  const best = records.best(level);
  const isRecord = records.add({ level, won: true, time, mistakes });
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
    lbAfterWin('sudoku', level, time);
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

// Keyboard on a computer: arrows to move, 1-9 to fill, Backspace to erase.
document.addEventListener('keydown', (e) => {
  if (done || e.target.closest('input')) return;
  const moves = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
  if (e.key in moves) {
    e.preventDefault();
    if (selected < 0) selected = 40;
    else {
      const next = selected + moves[e.key];
      const sameRow = Math.floor(next / 9) === Math.floor(selected / 9);
      if (next >= 0 && next < 81 && (Math.abs(moves[e.key]) === 9 || sameRow)) selected = next;
    }
    render();
  } else if (/^[1-9]$/.test(e.key)) {
    place(Number(e.key));
  } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
    place(0);
  }
});

// New puzzle: ask first if there's a puzzle in progress.
let pendingLevel = null;
function requestNew(lv) {
  if (hasProgress()) {
    pendingLevel = lv;
    $('confirm').hidden = false;
  } else {
    newPuzzle(lv);
  }
}

$('confirm-yes').addEventListener('click', () => newPuzzle(pendingLevel || level));
$('levels').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && (b.dataset.level !== level || done)) requestNew(b.dataset.level);
});
$('new').addEventListener('click', () => requestNew(level));
$('again').addEventListener('click', () => newPuzzle(level));

$('trophy').addEventListener('click', () => {
  const stats = records.stats();
  const rows = Object.keys(GIVENS).map((lv) => {
    const best = records.best(lv);
    return [LEVEL_NAMES[lv], best ? clock(best) : '–', String((stats[lv] || {}).won || 0)];
  });
  const games = records.history().map((g) => ({
    at: g.at,
    what: `🎉 ${LEVEL_NAMES[g.level] || ''}, ${g.mistakes ? errors(g.mistakes) : 'engin villa ⭐'}`,
    value: clock(g.time),
  }));
  showRecords(rows, games);
});

// --- start ---

if (!loadGame()) {
  const saved = store.get('level', 'easy');
  newPuzzle(GIVENS[saved] ? saved : 'easy');
}
registerServiceWorker('../sw.js');
