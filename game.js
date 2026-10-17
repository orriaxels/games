'use strict';

const LEVELS = {
  easy:   { cols: 8,  rows: 8,  mines: 8 },
  medium: { cols: 9,  rows: 12, mines: 18 },
  hard:   { cols: 10, rows: 15, mines: 30 },
};
const LEVEL_NAMES = { easy: 'Létt', medium: 'Miðlungs', hard: 'Erfitt' };
const HISTORY_MAX = 50;
const LONG_PRESS_MS = 400;
const TAP_MAX_MS = 250;   // a release between this and LONG_PRESS_MS does nothing, so a hold that ends early never digs
const MOVE_TOLERANCE = 12;

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const wrapEl = $('wrap');
const flagsEl = $('flags');
const timeEl = $('time');
const faceEl = $('face');
const modeEl = $('mode');
const overlayEl = $('overlay');

let level = load('level', 'easy');
if (!LEVELS[level]) level = 'easy';

let cols, rows, mineCount;
let cells, els;
let status;          // 'ready' | 'playing' | 'won' | 'lost'
let flagsPlaced, opened;
let timer = null, startedAt = 0;
let flagMode = false;
let gameId = 0;      // stops a late result popup from showing over a newer game

// --- storage (may be unavailable in private mode) ---

function load(key, fallback) {
  try { return localStorage.getItem('ms-' + key) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem('ms-' + key, value); } catch { /* ignore */ }
}
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem('ms-' + key)) ?? fallback; } catch { return fallback; }
}
function saveJSON(key, value) {
  save(key, JSON.stringify(value));
}

// --- game setup ---

function newGame() {
  gameId++;
  clearPeek();
  ({ cols, rows, mines: mineCount } = LEVELS[level]);
  cells = Array.from({ length: cols * rows }, () => ({ mine: false, n: 0, open: false, flag: false }));
  status = 'ready';
  flagsPlaced = 0;
  opened = 0;
  stopTimer();
  timeEl.textContent = '0';
  faceEl.textContent = '🙂';
  overlayEl.hidden = true;

  boardEl.style.setProperty('--cols', cols);
  boardEl.replaceChildren();
  els = cells.map((_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell' + (((i % cols) + Math.floor(i / cols)) % 2 ? ' alt' : '');
    b.dataset.i = i;
    boardEl.appendChild(b);
    return b;
  });

  document.querySelectorAll('#levels button').forEach((b) => {
    b.classList.toggle('active', b.dataset.level === level);
  });
  updateFlags();
  updateBest();
  fit();
}

function neighbors(i) {
  const x = i % cols, y = Math.floor(i / cols), out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) out.push(ny * cols + nx);
    }
  }
  return out;
}

// Mines are placed after the first tap so the first tap (and its neighbours) is always safe.
function placeMines(safe) {
  const banned = new Set([safe, ...neighbors(safe)]);
  const pool = cells.map((_, i) => i).filter((i) => !banned.has(i));
  for (let k = 0; k < mineCount; k++) {
    const j = k + Math.floor(Math.random() * (pool.length - k));
    [pool[k], pool[j]] = [pool[j], pool[k]];
    cells[pool[k]].mine = true;
  }
  cells.forEach((c, i) => {
    c.n = neighbors(i).filter((j) => cells[j].mine).length;
  });
}

// --- actions ---

function isOver() { return status === 'won' || status === 'lost'; }

function dig(i) {
  const c = cells[i];
  if (isOver() || c.open || c.flag) return;
  if (status === 'ready') {
    placeMines(i);
    status = 'playing';
    startTimer();
  }
  if (c.mine) return lose(i);
  flood(i);
  if (opened === cells.length - mineCount) win();
}

function flood(start) {
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    const c = cells[i];
    if (c.open || c.flag) continue;
    c.open = true;
    opened++;
    draw(i);
    if (c.n === 0) stack.push(...neighbors(i).filter((j) => !cells[j].open && !cells[j].flag));
  }
}

function toggleFlag(i) {
  const c = cells[i];
  if (isOver() || c.open) return;
  c.flag = !c.flag;
  flagsPlaced += c.flag ? 1 : -1;
  draw(i);
  updateFlags();
  buzz(25);
}

function draw(i) {
  const c = cells[i], el = els[i];
  el.classList.toggle('open', c.open);
  if (c.open) {
    el.textContent = c.n || '';
    if (c.n) el.classList.add('n' + c.n);
  } else {
    el.innerHTML = c.flag ? '<span>🚩</span>' : '';
  }
}

// Tapping an opened number briefly outlines the 8 squares it counts.
const PEEK_MS = 1500;
let peekTimer = null, peeked = [];

function peek(i) {
  if (!cells[i].n) return;
  clearPeek();
  peeked = [i, ...neighbors(i)];
  peeked.forEach((j) => els[j].classList.add(j === i ? 'peek-source' : 'peek'));
  peekTimer = setTimeout(clearPeek, PEEK_MS);
}

function clearPeek() {
  clearTimeout(peekTimer);
  peeked.forEach((j) => els[j]?.classList.remove('peek', 'peek-source'));
  peeked = [];
}

function updateFlags() {
  flagsEl.textContent = mineCount - flagsPlaced;
}

function lose(hit) {
  status = 'lost';
  stopTimer();
  faceEl.textContent = '😵';
  buzz([80, 40, 120]);
  els[hit].classList.add('boom');
  els[hit].innerHTML = '<span>💥</span>';

  const others = [];
  cells.forEach((c, i) => {
    if (i === hit) return;
    if (c.mine && !c.flag) others.push(i);
    if (!c.mine && c.flag) els[i].innerHTML = '<span>❌</span>';
  });
  others.forEach((i, k) => setTimeout(() => { els[i].innerHTML = '<span>💣</span>'; }, 40 * k));
  finishGame(false, 700 + 40 * others.length);
}

function win() {
  status = 'won';
  stopTimer();
  faceEl.textContent = '😎';
  cells.forEach((c, i) => {
    if (c.mine && !c.flag) { c.flag = true; draw(i); }
  });
  flagsPlaced = mineCount;
  updateFlags();
  buzz([40, 30, 40]);
  confetti();
  finishGame(true, 500);
}

// Saves the game to this phone's records right away, then shows the popup after `delay`.
function finishGame(won, delay) {
  const time = elapsed();
  const best = bestTime(level);
  let text;
  if (won && (!best || time < best)) {
    save('best-' + level, time);
    text = `${seconds(time)} — nýtt met! 🏆`;
  } else if (won) {
    text = `${seconds(time)} · Metið er ${seconds(best)}`;
  } else {
    text = best ? `Úps, sprengja! Metið þitt er ${seconds(best)}.` : 'Úps, sprengja! Reyna aftur?';
  }
  recordGame(won, time);
  updateBest();

  const id = gameId;
  setTimeout(() => {
    if (id !== gameId) return;
    $('result-emoji').textContent = won ? '🎉' : '💣';
    $('result-title').textContent = won ? 'Þú vannst!' : 'Búmm!';
    $('result-text').textContent = text;
    overlayEl.hidden = false;
  }, delay);
}

// --- records: kept in this phone's browser storage ---

function bestTime(lv) {
  return Number(load('best-' + lv, 0)) || 0;
}

function recordGame(won, time) {
  const stats = loadJSON('stats', {});
  const s = stats[level] || (stats[level] = { played: 0, won: 0 });
  s.played++;
  if (won) s.won++;
  saveJSON('stats', stats);

  const history = loadJSON('history', []);
  const list = Array.isArray(history) ? history : [];
  list.unshift({ at: Date.now(), level, won, time });
  saveJSON('history', list.slice(0, HISTORY_MAX));
}

// Browsers don't all ship Icelandic date names, so format by hand: "17. okt. 13:52"
const MONTHS = ['jan.', 'feb.', 'mars', 'apr.', 'maí', 'júní', 'júlí', 'ágúst', 'sept.', 'okt.', 'nóv.', 'des.'];
function formatWhen(ms) {
  const d = new Date(ms), pad = (n) => String(n).padStart(2, '0');
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function updateBest() {
  $('best').textContent = bestTime(level) || '–';
}

function showRecords() {
  const stats = loadJSON('stats', {});
  const body = $('records-body');
  body.replaceChildren();
  for (const lv of Object.keys(LEVELS)) {
    const s = stats[lv] || { played: 0, won: 0 };
    const best = bestTime(lv);
    const tr = document.createElement('tr');
    for (const text of [LEVEL_NAMES[lv], best ? best + ' sek' : '–', `${s.won} af ${s.played}`]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }

  const list = $('history');
  list.replaceChildren();
  const history = loadJSON('history', []);
  const games = (Array.isArray(history) ? history : []).slice(0, 20);
  if (!games.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Engir leikir enn. Spilaðu fyrst!';
    list.appendChild(li);
  }
  for (const g of games) {
    const li = document.createElement('li');
    const what = document.createElement('span');
    what.textContent = `${g.won ? '🎉' : '💣'} ${LEVEL_NAMES[g.level] || ''}${g.won ? ' · ' + g.time + ' sek' : ''}`;
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = formatWhen(g.at);
    li.append(what, when);
    list.appendChild(li);
  }
  $('records').hidden = false;
}

// Icelandic: numbers ending in 1 (but not 11) take the singular.
function seconds(n) {
  return n + (n % 10 === 1 && n % 100 !== 11 ? ' sekúnda' : ' sekúndur');
}

// --- timer ---

function elapsed() { return startedAt ? Math.min(999, Math.floor((Date.now() - startedAt) / 1000)) : 0; }

function startTimer() {
  startedAt = Date.now();
  timer = setInterval(() => { timeEl.textContent = elapsed(); }, 250);
}

function stopTimer() {
  clearInterval(timer);
  timer = null;
  if (status === 'ready') startedAt = 0;
}

// --- feedback ---

function buzz(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function confetti() {
  const bits = ['🎉', '⭐', '🎈', '✨', '🌟'];
  for (let k = 0; k < 28; k++) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.textContent = bits[k % bits.length];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDelay = Math.random() * 0.6 + 's';
    s.style.animationDuration = 1.8 + Math.random() * 1.2 + 's';
    s.addEventListener('animationend', () => s.remove());
    document.body.appendChild(s);
  }
}

// --- layout: biggest square cells that fit the space ---

function fit() {
  const size = Math.floor(Math.min(wrapEl.clientWidth / cols, wrapEl.clientHeight / rows, 64));
  boardEl.style.setProperty('--cell', Math.max(size, 20) + 'px');
}
window.addEventListener('resize', fit);

// --- input: tap = current mode, long-press = always flag, right-click = flag ---

let press = null;

function endPress() {
  if (!press) return;
  clearTimeout(press.timer);
  els[press.i]?.classList.remove('pressed');
  press = null;
}

boardEl.addEventListener('pointerdown', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const i = Number(cell.dataset.i);
  endPress();

  if (e.pointerType === 'mouse' && e.button === 2) {
    toggleFlag(i);
    return;
  }
  if (e.button !== 0) return;

  const p = { i, x: e.clientX, y: e.clientY, t: performance.now(), long: false };
  p.timer = setTimeout(() => {
    p.long = true;
    cell.classList.remove('pressed');
    toggleFlag(i);
  }, LONG_PRESS_MS);
  press = p;
  cell.classList.add('pressed');
});

boardEl.addEventListener('pointermove', (e) => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOLERANCE) endPress();
});

boardEl.addEventListener('pointerup', () => {
  if (!press) return;
  const { i, long, t } = press;
  endPress();
  if (long) return;
  if (cells[i].open) peek(i);
  else if (performance.now() - t > TAP_MAX_MS) return;
  else if (flagMode) toggleFlag(i);
  else dig(i);
});

boardEl.addEventListener('pointercancel', endPress);
boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

modeEl.addEventListener('click', () => {
  flagMode = !flagMode;
  modeEl.classList.toggle('on', flagMode);
  modeEl.setAttribute('aria-pressed', flagMode);
  $('mode-icon').textContent = flagMode ? '🚩' : '⛏️';
  $('mode-label').textContent = flagMode ? 'Flagga' : 'Grafa';
  $('hint').textContent = flagMode
    ? 'Ýttu til að flagga · Skiptu yfir í Grafa til að grafa'
    : 'Ýttu til að grafa · Haltu inni til að flagga';
});

$('levels').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  level = b.dataset.level;
  save('level', level);
  newGame();
});

faceEl.addEventListener('click', newGame);
$('again').addEventListener('click', newGame);
overlayEl.addEventListener('click', (e) => {
  if (e.target === overlayEl) overlayEl.hidden = true;
});

$('trophy').addEventListener('click', showRecords);
$('records-close').addEventListener('click', () => { $('records').hidden = true; });
$('records').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.hidden = true;
});

// Ask the browser not to clear our storage when the phone runs low on space.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

newGame();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
