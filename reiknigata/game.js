'use strict';
// Reiknigáta (math crossword). Uses helpers from ../common.js.
//
// Nine numbers in a 3x3 square, laid out on a 5x5 board with signs between them:
//
//    a + b = c        3 equations across (rows)
//    +   +   +        3 equations down (columns)
//    d + e = f
//    =   =   =
//    g + h = i

const MAX = { easy: 20, medium: 50, hard: 100 };      // largest number in a puzzle
const BLANKS = { easy: 3, medium: 4, hard: 5 };       // numbers the kids fill in (5 is the most that can be solved one equation at a time)
const ALL_OPS = ['+', '−', '×', '÷'];

// Each equation is [A, B, C] meaning A op B = C, as indexes into the nine numbers.
const EQS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],   // across
  [0, 3, 6], [1, 4, 7], [2, 5, 8],   // down
];

const store = makeStore('rg-');
const records = makeRecords(store);

const boardEl = $('board');
const wrapEl = $('wrap');
const timeEl = $('time');

// Current game
let level, ops, values, eqOps, blank, entries, done;
let selected = -1;
let elapsedMs = 0, runningSince = 0, ticker = null;
let numEls = [], opEls = [], eqEls = [];

// --- arithmetic ---

function calc(op, a, b) {
  if (op === '+') return a + b;
  if (op === '−') return a - b;
  if (op === '×') return a * b;
  return b && a % b === 0 ? a / b : NaN;
}

// Find the missing number in A op B = C. `known` holds the other two (null for the missing one).
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

// --- puzzle generation ---

// Small numbers come up more often, which helps × and ÷ work out evenly.
function randomNumber(max) {
  return 1 + Math.floor(Math.random() * (Math.random() < 0.5 ? Math.min(max, 12) : max));
}

// Pick random a, b, d, e; work out the rest from the equations; keep it if the
// last column also works and every number is a whole number between 1 and max.
function tryNumbers(opsFor, max) {
  for (let t = 0; t < 1500; t++) {
    const v = new Array(9);
    v[0] = randomNumber(max); v[1] = randomNumber(max);
    v[3] = randomNumber(max); v[4] = randomNumber(max);
    v[2] = calc(opsFor[0], v[0], v[1]);
    v[5] = calc(opsFor[1], v[3], v[4]);
    v[6] = calc(opsFor[3], v[0], v[3]);
    v[7] = calc(opsFor[4], v[1], v[4]);
    v[8] = calc(opsFor[2], v[6], v[7]);
    if (calc(opsFor[5], v[2], v[5]) !== v[8]) continue;
    if (!v.every((x) => Number.isInteger(x) && x >= 1 && x <= max)) continue;
    if (v.filter((x) => x === 1).length > 1) continue;     // avoid lots of "× 1"
    return v;
  }
  return null;
}

function makePuzzle(lv, chosen) {
  const max = MAX[lv];
  // First try to use every chosen sign at least once; then settle for any mix of them.
  for (const needAll of [true, false]) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const opsFor = EQS.map(() => pick(chosen));
      if (needAll && !chosen.every((o) => opsFor.includes(o))) continue;
      const v = tryNumbers(opsFor, max);
      if (v) return { values: v, eqOps: opsFor, blank: chooseBlanks(v, opsFor, BLANKS[lv]) };
    }
  }
  // Can't happen in practice; plain + always works.
  return makePuzzle(lv, ['+']);
}

// Solvable one equation at a time: repeatedly fill any equation with just one number missing.
function solvable(blankSet, v, opsFor) {
  const known = v.map((x, i) => (blankSet.has(i) ? null : x));
  let progress = true;
  while (progress) {
    progress = false;
    EQS.forEach(([a, b, c], e) => {
      const missing = [a, b, c].filter((i) => known[i] == null);
      if (missing.length !== 1) return;
      const x = solveFor(opsFor[e], known[a], known[b], known[c]);
      if (x !== v[missing[0]]) return;
      known[missing[0]] = x;
      progress = true;
    });
  }
  return known.every((x) => x != null);
}

function chooseBlanks(v, opsFor, count) {
  let best = new Set();
  for (let tries = 0; tries < 30 && best.size < count; tries++) {
    const set = new Set();
    for (const i of shuffle([...Array(9).keys()])) {
      if (set.size >= count) break;
      set.add(i);
      if (!solvable(set, v, opsFor)) set.delete(i);
    }
    if (set.size > best.size) best = set;
  }
  return [...Array(9).keys()].map((i) => best.has(i));
}

// --- game state ---

function newPuzzle(lv) {
  level = lv;
  store.set('level', level);
  ({ values, eqOps, blank } = makePuzzle(level, ops));
  entries = new Array(9).fill('');
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
  store.setJSON('current', { level, ops, values, eqOps, blank, entries, elapsed: currentMs() });
}

function loadGame() {
  const g = store.getJSON('current', null);
  const ok = (a, n) => Array.isArray(a) && a.length === n;
  if (!g || !MAX[g.level] || !ok(g.values, 9) || !ok(g.eqOps, 6) || !ok(g.blank, 9) || !ok(g.entries, 9)) return false;
  ({ level, values, eqOps, blank, entries } = g);
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

// 'ok', 'bad' or '' for each equation
function checks() {
  return EQS.map(([a, b, c], e) => {
    const A = shown(a), B = shown(b), C = shown(c);
    if (A == null || B == null || C == null) return '';
    return calc(eqOps[e], A, B) === C ? 'ok' : 'bad';
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
  const at = {};   // "row,col" -> element

  for (let k = 0; k < 9; k++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile num' + (blank[k] ? ' blank' : '');
    b.dataset.i = k;
    numEls.push(b);
    at[`${2 * Math.floor(k / 3)},${2 * (k % 3)}`] = b;
  }
  EQS.forEach((_, e) => {
    const across = e < 3, j = e % 3;
    const op = document.createElement('div');
    op.className = 'tile op';
    op.dataset.op = eqOps[e];
    op.textContent = eqOps[e];
    const eq = document.createElement('div');
    eq.className = 'tile eq';
    eq.textContent = '=';
    opEls.push(op);
    eqEls.push(eq);
    at[across ? `${2 * j},1` : `1,${2 * j}`] = op;
    at[across ? `${2 * j},3` : `3,${2 * j}`] = eq;
  });

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      let el = at[`${r},${c}`];
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
  $('solved').textContent = `${state.filter((s) => s === 'ok').length}/6`;
}

function drawSigns() {
  document.querySelectorAll('#signs [data-op]').forEach((b) => b.classList.toggle('on', ops.includes(b.dataset.op)));
}

function updateBest() {
  const best = records.best(level);
  $('best').textContent = best ? clock(best) : '–';
}

// Biggest tiles that fit the space.
function fit() {
  const gap = 6;
  const size = Math.floor(Math.min((wrapEl.clientWidth - 4 * gap) / 5, (wrapEl.clientHeight - 4 * gap) / 5, 76));
  boardEl.style.setProperty('--tile', Math.max(size, 34) + 'px');
}
window.addEventListener('resize', fit);

// --- input ---

function selectNext() {
  const order = [...Array(9).keys()].map((k) => (selected + 1 + k) % 9);
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
  else if (s === '0' || s.length >= String(MAX[level]).length) s = k;   // start over instead of growing too long
  else s += k;
  entries[selected] = s;
  numEls[selected].classList.remove('pop');
  void numEls[selected].offsetWidth;   // restart the pop animation
  numEls[selected].classList.add('pop');
  render();

  const state = checks();
  if (state.every((x) => x === 'ok')) return win();
  if (state.some((x, e) => x === 'bad' && EQS[e].includes(selected))) buzz(40);
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
    if (done) showResult('🎉', 'Þú kláraðir!', text);
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
  const rows = Object.keys(MAX).map((lv) => {
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
  newPuzzle(MAX[saved] ? saved : 'easy');
}
registerServiceWorker('../sw.js');
