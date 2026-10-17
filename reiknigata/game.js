'use strict';
// Reiknigáta (math crossword). Uses helpers from ../common.js.
//
// The board is a grid of tiles. Every equation reads "A op B = C" and takes five
// tiles in a row (across) or column (down). Numbers sit on tiles where both the
// row and the column are even, so an across and a down equation can share a number.
//
// Easy is a fixed 3x3 square of numbers (6 equations):   a + b = c
//                                                         +   +   +
//                                                         d + e = f
//                                                         =   =   =
//                                                         g + h = i
// Medium and hard get a new crossword layout every time, on a bigger board.

const LEVELS = {
  easy:   { max: 20,  board: 5, slots: 6,  blanks: 3 },
  medium: { max: 50,  board: 7, slots: 7,  blanks: 7 },
  hard:   { max: 100, board: 9, slots: 10, blanks: 10 },
};
const MAX_CYCLES = 2;   // places where equations loop back on each other; more makes good numbers hard to find
const ALL_OPS = ['+', '−', '×', '÷'];
const SAVE_VERSION = 2;

const store = makeStore('rg-');
const records = makeRecords(store);

const boardEl = $('board');
const wrapEl = $('wrap');
const timeEl = $('time');

// Current game.
//   cells:  [[row, col], ...] position of each number, in reading order
//   slots:  [{ dir: 'h' | 'v', r, c, op, cells: [A, B, C] }, ...]  A op B = C, indexes into cells
let level, ops, cells, slots, values, blank, entries, done;
let selected = -1;
let elapsedMs = 0, runningSince = 0, ticker = null;
let numEls = [], opEls = [], eqEls = [];
let bounds = { rows: 5, cols: 5 };

// --- arithmetic ---

function calc(op, a, b) {
  if (op === '+') return a + b;
  if (op === '−') return a - b;
  if (op === '×') return a * b;
  return b && a % b === 0 ? a / b : NaN;
}

// The missing number in A op B = C (pass null for the missing one).
function solveFor(op, A, B, C) {
  if (C == null) return calc(op, A, B);
  if (A == null) {
    if (op === '+') return C - B;
    if (op === '−') return C + B;
    if (op === '×') return B && C % B === 0 ? C / B : NaN;
    return C * B;
  }
  if (op === '+') return C - A;
  if (op === '−') return A - C;
  if (op === '×') return A && C % A === 0 ? C / A : NaN;
  return C && A % C === 0 ? A / C : NaN;
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- layouts ---

// Tile positions of an equation's three numbers.
function slotNumbers(s) {
  return s.dir === 'h'
    ? [[s.r, s.c], [s.r, s.c + 2], [s.r, s.c + 4]]
    : [[s.r, s.c], [s.r + 2, s.c], [s.r + 4, s.c]];
}

function squareLayout() {
  return [
    { dir: 'h', r: 0, c: 0 }, { dir: 'h', r: 2, c: 0 }, { dir: 'h', r: 4, c: 0 },
    { dir: 'v', r: 0, c: 0 }, { dir: 'v', r: 0, c: 2 }, { dir: 'v', r: 0, c: 4 },
  ];
}

// Grow a crossword: start with one equation, then keep adding equations that cross
// a number already on the board, until there are `target` of them.
function crosswordLayout(size, target) {
  const evens = [...Array(Math.floor((size - 5) / 2) + 1).keys()].map((k) => 2 * k);   // where an equation can start
  let best = [];
  for (let attempt = 0; attempt < 200 && best.length < target; attempt++) {
    const first = { dir: pick(['h', 'v']), r: 2 * Math.floor(Math.random() * ((size + 1) / 2)), c: pick(evens) };
    if (first.dir === 'v') [first.r, first.c] = [first.c, first.r];
    const layout = [first];
    let cycles = 0;

    for (let fails = 0; layout.length < target && fails < 150; fails++) {
      // a number that only has an equation in one direction so far
      const owners = new Map();
      for (const s of layout) for (const [r, c] of slotNumbers(s)) {
        const k = r + ',' + c;
        owners.set(k, (owners.get(k) || '') + s.dir);
      }
      const open = [...owners].filter(([, d]) => d.length === 1);
      if (!open.length) break;
      const [key, d] = pick(open);
      const [r, c] = key.split(',').map(Number);
      const dir = d === 'h' ? 'v' : 'h';
      const k = Math.floor(Math.random() * 3);   // which of the new equation's three numbers it is
      const s = dir === 'h' ? { dir, r, c: c - 2 * k } : { dir, r: r - 2 * k, c };
      const start = dir === 'h' ? s.c : s.r;
      if (start < 0 || start + 4 > size - 1) continue;

      // Equations in the same direction on the same line need a gap tile between them.
      const line = dir === 'h' ? s.r : s.c;
      const clash = layout.some((o) => {
        if (o.dir !== dir || (dir === 'h' ? o.r : o.c) !== line) return false;
        const os = dir === 'h' ? o.c : o.r;
        return !(os + 4 <= start - 2 || start + 4 <= os - 2);
      });
      if (clash) continue;

      // Each extra shared number closes a loop; allow only a couple.
      const shared = slotNumbers(s).filter(([rr, cc]) => owners.has(rr + ',' + cc)).length;
      if (shared > 1 && cycles + shared - 1 > MAX_CYCLES) continue;
      cycles += shared - 1;
      layout.push(s);
    }
    if (layout.length > best.length) best = layout;
  }
  return best;
}

// --- numbers ---

// A random whole number from lo to hi; small numbers come up more often.
function randomBetween(lo, hi) {
  if (hi < lo) return null;
  const top = Math.random() < 0.5 ? Math.min(hi, lo + 11) : hi;
  return lo + Math.floor(Math.random() * (top - lo + 1));
}

// A random divisor of n, preferring ones other than 1 and n.
function randomDivisor(n) {
  const all = [];
  for (let d = 1; d <= n; d++) if (n % d === 0) all.push(d);
  const middle = all.filter((d) => d !== 1 && d !== n);
  return pick(middle.length && Math.random() < 0.85 ? middle : all);
}

// Random numbers for A op B = C that fit the ones already known (null = not known yet).
function randomTriple(op, A, B, C, max) {
  const fit = (x) => Number.isInteger(x) && x >= 1 && x <= max;
  let a = A, b = B, c = C;
  if (op === '+') {
    if (c != null) { if (a == null && b == null) a = randomBetween(1, c - 1); }
    else if (a == null && b == null) a = randomBetween(1, max - 1);
    if (a != null && b == null && c == null) b = randomBetween(1, max - a);
    if (b != null && a == null && c == null) a = randomBetween(1, max - b);
  } else if (op === '−') {
    if (a != null && b == null && c == null) b = randomBetween(1, a - 1);
    else if (b != null && a == null && c == null) c = randomBetween(1, max - b);
    else if (c != null && a == null && b == null) b = randomBetween(1, max - c);
    else if (a == null && b == null && c == null) { b = randomBetween(1, max - 1); c = randomBetween(1, max - b); }
  } else if (op === '×') {
    if (c != null) { if (a == null && b == null) a = randomDivisor(c); }
    else if (a == null && b == null) a = randomBetween(1, Math.min(12, max));
    if (a != null && b == null && c == null) b = randomBetween(1, Math.floor(max / a));
    if (b != null && a == null && c == null) a = randomBetween(1, Math.floor(max / b));
  } else {   // A ÷ B = C means A = B × C
    if (a != null && b == null && c == null) b = randomDivisor(a);
    else if (b != null && a == null && c == null) c = randomBetween(1, Math.floor(max / b));
    else if (c != null && a == null && b == null) b = randomBetween(1, Math.floor(max / c));
    else if (a == null && b == null && c == null) { b = randomBetween(2, Math.min(12, Math.floor(max / 2))); c = randomBetween(1, Math.floor(max / b)); }
  }
  if ([a, b, c].filter((x) => x != null).length < 2) return null;
  // the third number follows from the other two
  if (a == null) a = solveFor(op, null, b, c);
  else if (b == null) b = solveFor(op, a, null, c);
  else if (c == null) c = solveFor(op, a, b, null);
  return fit(a) && fit(b) && fit(c) && calc(op, a, b) === c ? [a, b, c] : null;
}

// Fill in numbers so every equation is true: work out any equation with two numbers
// known, otherwise pick numbers that fit it. Returns null if it got stuck.
function fillNumbers(eqs, eqOps, count, max) {
  const maxOnes = Math.max(1, Math.floor(count / 8));
  for (let t = 0; t < 3000; t++) {
    const v = new Array(count).fill(null);
    const left = new Set(eqs.keys());
    let ok = true;
    while (ok && left.size) {
      let best = -1, bestKnown = -1;
      for (const e of left) {
        const known = eqs[e].filter((i) => v[i] != null).length;
        if (known > bestKnown) { best = e; bestKnown = known; }
      }
      const [a, b, c] = eqs[best], op = eqOps[best];
      if (bestKnown === 3) {
        if (calc(op, v[a], v[b]) !== v[c]) ok = false;
        left.delete(best);
      } else if (bestKnown === 2) {
        const missing = [a, b, c].find((i) => v[i] == null);
        const x = solveFor(op, v[a], v[b], v[c]);
        if (!Number.isInteger(x) || x < 1 || x > max) ok = false;
        else v[missing] = x;
      } else {
        const t = randomTriple(op, v[a], v[b], v[c], max);
        if (!t) ok = false;
        else [v[a], v[b], v[c]] = t;
      }
    }
    if (ok && v.filter((x) => x === 1).length <= maxOnes) return v;
  }
  return null;
}

// Solvable one equation at a time: repeatedly fill any equation with just one number missing.
function solvable(blankSet, v, eqs, eqOps) {
  const known = v.map((x, i) => (blankSet.has(i) ? null : x));
  let progress = true;
  while (progress) {
    progress = false;
    eqs.forEach(([a, b, c], e) => {
      const missing = [a, b, c].filter((i) => known[i] == null);
      if (missing.length !== 1) return;
      const x = solveFor(eqOps[e], known[a], known[b], known[c]);
      if (x !== v[missing[0]]) return;
      known[missing[0]] = x;
      progress = true;
    });
  }
  return known.every((x) => x != null);
}

function chooseBlanks(v, eqs, eqOps, count) {
  let best = new Set();
  for (let tries = 0; tries < 40 && best.size < count; tries++) {
    const set = new Set();
    for (const i of shuffle([...v.keys()])) {
      if (set.size >= count) break;
      set.add(i);
      if (!solvable(set, v, eqs, eqOps)) set.delete(i);
    }
    if (set.size > best.size) best = set;
  }
  return v.map((_, i) => best.has(i));
}

// Number positions in reading order, and each equation as indexes into them.
function indexLayout(layout) {
  const keys = new Map();
  for (const s of layout) for (const [r, c] of slotNumbers(s)) keys.set(r + ',' + c, [r, c]);
  const pos = [...keys.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const index = new Map(pos.map(([r, c], i) => [r + ',' + c, i]));
  const eqs = layout.map((s) => slotNumbers(s).map(([r, c]) => index.get(r + ',' + c)));
  return { pos, eqs };
}

function makePuzzle(lv, chosen) {
  const L = LEVELS[lv];
  for (let attempt = 0; attempt < 60; attempt++) {
    const layout = lv === 'easy' ? squareLayout() : crosswordLayout(L.board, L.slots);
    const { pos, eqs } = indexLayout(layout);
    // First try to use every chosen sign at least once; then settle for any mix of them.
    for (const needAll of [true, false]) {
      for (let k = 0; k < 40; k++) {
        const eqOps = eqs.map(() => pick(chosen));
        if (needAll && !chosen.every((o) => eqOps.includes(o))) continue;
        const v = fillNumbers(eqs, eqOps, pos.length, L.max);
        if (!v) continue;
        return {
          cells: pos,
          slots: layout.map((s, e) => ({ ...s, op: eqOps[e], cells: eqs[e] })),
          values: v,
          blank: chooseBlanks(v, eqs, eqOps, L.blanks),
        };
      }
    }
  }
  return makePuzzle('easy', ['+']);   // plain + on the square always works
}

// --- game state ---

const eqsOf = () => slots.map((s) => s.cells);
const opsOf = () => slots.map((s) => s.op);

function newPuzzle(lv) {
  level = lv;
  store.set('level', level);
  ({ cells, slots, values, blank } = makePuzzle(level, ops));
  entries = values.map(() => '');
  done = false;
  selected = blank.indexOf(true);
  elapsedMs = 0;
  $('overlay').hidden = true;
  $('confirm').hidden = true;
  buildBoard();
  startClock();
  saveGame();
}

function saveGame() {
  if (done) { store.remove('current'); return; }
  store.setJSON('current', { v: SAVE_VERSION, level, ops, cells, slots, values, blank, entries, elapsed: currentMs() });
}

function loadGame() {
  const g = store.getJSON('current', null);
  if (!g || g.v !== SAVE_VERSION || !LEVELS[g.level]) return false;
  const n = Array.isArray(g.cells) ? g.cells.length : 0;
  const ok = (a) => Array.isArray(a) && a.length === n;
  if (!n || !ok(g.values) || !ok(g.blank) || !ok(g.entries) || !Array.isArray(g.slots) || !g.slots.length) return false;
  ({ level, cells, slots, values, blank, entries } = g);
  if (Array.isArray(g.ops) && g.ops.length) ops = g.ops.filter((o) => ALL_OPS.includes(o));
  elapsedMs = Number(g.elapsed) || 0;
  done = false;
  selected = blank.findIndex((b, i) => b && !entries[i]);
  buildBoard();
  startClock();
  return true;
}

// The number in cell i as the board shows it (null when empty).
function shown(i) {
  if (!blank[i]) return values[i];
  return entries[i] === '' ? null : Number(entries[i]);
}

// For each equation: 'ok', 'bad', '' (not filled in yet) or 'given' (nothing to fill in;
// those don't turn green or count, so the counter starts at 0).
function checks() {
  return slots.map(({ op, cells: [a, b, c] }) => {
    if (![a, b, c].some((i) => blank[i])) return 'given';
    const A = shown(a), B = shown(b), C = shown(c);
    if (A == null || B == null || C == null) return '';
    return calc(op, A, B) === C ? 'ok' : 'bad';
  });
}

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
  numEls = []; opEls = []; eqEls = [];
  const at = new Map();   // "row,col" -> element

  cells.forEach(([r, c], k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile num' + (blank[k] ? ' blank' : '');
    b.dataset.i = k;
    numEls.push(b);
    at.set(r + ',' + c, b);
  });
  for (const s of slots) {
    const op = document.createElement('div');
    op.className = 'tile op';
    op.dataset.op = s.op;
    op.textContent = s.op;
    const eq = document.createElement('div');
    eq.className = 'tile eq';
    eq.textContent = '=';
    opEls.push(op);
    eqEls.push(eq);
    at.set(s.dir === 'h' ? `${s.r},${s.c + 1}` : `${s.r + 1},${s.c}`, op);
    at.set(s.dir === 'h' ? `${s.r},${s.c + 3}` : `${s.r + 3},${s.c}`, eq);
  }

  // Only draw the part of the board that's used, so the tiles can be as big as possible.
  const rs = [...at.keys()].map((k) => Number(k.split(',')[0]));
  const cs = [...at.keys()].map((k) => Number(k.split(',')[1]));
  const r0 = Math.min(...rs), c0 = Math.min(...cs);
  bounds = { rows: Math.max(...rs) - r0 + 1, cols: Math.max(...cs) - c0 + 1 };
  // Numbers are on even rows/columns (the board always starts on one); the ones between only hold signs.
  const tracks = (k) => [...Array(k).keys()].map((i) => (i % 2 ? 'var(--thin)' : 'var(--tile)')).join(' ');
  boardEl.style.gridTemplateColumns = tracks(bounds.cols);
  boardEl.style.gridTemplateRows = tracks(bounds.rows);
  for (let r = r0; r < r0 + bounds.rows; r++) {
    for (let c = c0; c < c0 + bounds.cols; c++) {
      let el = at.get(r + ',' + c);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tile gap';
      }
      boardEl.appendChild(el);
    }
  }

  document.querySelectorAll('#levels button').forEach((b) => b.classList.toggle('active', b.dataset.level === level));
  drawSigns();
  updateBest();
  fit();
  render();
}

function render() {
  numEls.forEach((el, i) => {
    const v = shown(i);
    el.textContent = v == null ? '' : v;
    el.classList.toggle('filled', blank[i] && v != null);
    el.classList.toggle('sel', i === selected);
  });
  const state = checks();
  state.forEach((s, e) => {
    for (const el of [opEls[e], eqEls[e]]) {
      el.classList.toggle('ok', s === 'ok');
      el.classList.toggle('bad', s === 'bad');
    }
  });
  // squares filled in out of squares to fill (filled, not necessarily right)
  $('solved').textContent = `${blank.filter((b, i) => b && entries[i] !== '').length}/${blank.filter(Boolean).length}`;
}

function drawSigns() {
  document.querySelectorAll('#signs [data-op]').forEach((b) => b.classList.toggle('on', ops.includes(b.dataset.op)));
}

function updateBest() {
  const best = records.best(level);
  $('best').textContent = best ? clock(best) : '–';
}

// Biggest tiles that fit the space. Sign rows/columns are THIN times a number tile.
const THIN = 0.6;
function fit() {
  const n = Math.max(bounds.rows, bounds.cols);
  const gap = n <= 5 ? 6 : n <= 7 ? 4 : 3;
  const units = (k) => Math.ceil(k / 2) + THIN * Math.floor(k / 2);
  const size = Math.floor(Math.min(
    (wrapEl.clientWidth - (bounds.cols - 1) * gap) / units(bounds.cols),
    (wrapEl.clientHeight - (bounds.rows - 1) * gap) / units(bounds.rows),
    80));
  const tile = Math.max(size, 26);
  boardEl.style.setProperty('--gap', gap + 'px');
  boardEl.style.setProperty('--tile', tile + 'px');
  boardEl.style.setProperty('--thin', Math.round(tile * THIN) + 'px');
}
window.addEventListener('resize', fit);

// --- input ---

function selectNext() {
  const n = cells.length;
  const order = [...Array(n).keys()].map((k) => (selected + 1 + k) % n);
  const next = order.find((i) => blank[i] && !entries[i]) ?? order.find((i) => blank[i]);
  if (next != null) selected = next;
  render();
}

function key(k) {
  if (done) return;
  if (k === 'next') return selectNext();
  if (selected < 0 || !blank[selected]) return;
  let s = entries[selected];
  if (k === 'back') s = s.slice(0, -1);
  else if (s === '0' || s.length >= String(LEVELS[level].max).length) s = k;   // start over instead of growing too long
  else s += k;
  entries[selected] = s;
  numEls[selected].classList.remove('pop');
  void numEls[selected].offsetWidth;   // restart the pop animation
  numEls[selected].classList.add('pop');
  render();

  const state = checks();
  if (state.every((x) => x === 'ok' || x === 'given')) return win();
  if (state.some((x, e) => x === 'bad' && slots[e].cells.includes(selected))) buzz(40);
  saveGame();
}

function win() {
  done = true;
  stopClock();
  const time = elapsedSec();
  const best = records.best(level);
  const isRecord = records.add({ level, won: true, time, ops });
  store.remove('current');
  selected = -1;
  render();
  updateBest();
  buzz([40, 30, 40]);
  confetti();
  const text = isRecord ? `${clock(time)} — nýtt met! 🏆` : `${clock(time)} · Metið er ${clock(best)}`;
  setTimeout(() => {
    if (!done) return;
    showResult('🎉', 'Þú kláraðir!', text);
    lbAfterWin('reiknigata', level, time);
  }, 600);
}

boardEl.addEventListener('click', (e) => {
  const el = e.target.closest('.num');
  if (!el || done) return;
  const i = Number(el.dataset.i);
  if (!blank[i]) return;
  selected = i;
  render();
});

$('pad').addEventListener('click', (e) => {
  const b = e.target.closest('[data-key]');
  if (b) key(b.dataset.key);
});

// Keyboard on a computer: digits, Backspace, Enter/Tab for the next square.
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input')) return;   // typing a name
  if (/^[0-9]$/.test(e.key)) key(e.key);
  else if (e.key === 'Backspace' || e.key === 'Delete') key('back');
  else if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowRight') { e.preventDefault(); key('next'); }
});

// New puzzle: ask first if there's a puzzle in progress.
let pending = null;
function requestNew(change) {
  if (hasProgress()) {
    pending = change;
    $('confirm').hidden = false;
  } else {
    change();
  }
}

$('confirm-yes').addEventListener('click', () => {
  if (pending) pending();
  pending = null;
});

$('levels').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && (b.dataset.level !== level || done)) requestNew(() => newPuzzle(b.dataset.level));
});

$('signs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-op]');
  if (!b) return;
  const op = b.dataset.op;
  const next = ops.includes(op) ? ops.filter((o) => o !== op) : ALL_OPS.filter((o) => o === op || ops.includes(o));
  if (!next.length) {   // at least one sign has to stay on
    b.classList.remove('shake');
    void b.offsetWidth;
    b.classList.add('shake');
    return;
  }
  requestNew(() => {
    ops = next;
    store.set('ops', ops.join(''));
    newPuzzle(level);
  });
});

$('new').addEventListener('click', () => requestNew(() => newPuzzle(level)));
$('again').addEventListener('click', () => newPuzzle(level));

$('trophy').addEventListener('click', () => {
  const stats = records.stats();
  const rows = Object.keys(LEVELS).map((lv) => {
    const best = records.best(lv);
    return [LEVEL_NAMES[lv], best ? clock(best) : '–', String((stats[lv] || {}).won || 0)];
  });
  const games = records.history().map((g) => ({
    at: g.at,
    text: `🎉 ${LEVEL_NAMES[g.level] || ''} · ${(g.ops || []).join(' ')} · ${clock(g.time)}`,
  }));
  showRecords(rows, games);
});

// --- start ---

ops = [...store.get('ops', '+−')].filter((o) => ALL_OPS.includes(o));
if (!ops.length) ops = ['+', '−'];
if (!loadGame()) {
  const saved = store.get('level', 'easy');
  newPuzzle(LEVELS[saved] ? saved : 'easy');
}
registerServiceWorker('../sw.js');
