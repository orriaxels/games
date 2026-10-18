'use strict';
// Tetris. Uses helpers from ../common.js.
//
// Pieces fall into a 10×20 well; a full row clears. The difficulty sets the starting
// speed, and the speed goes up by one every 10 rows. Play with the buttons under the
// board, by tapping (turn) and dragging (move, flick down to drop) on the board, or
// with the arrow keys on a computer. An unfinished game is saved when the app closes.

const COLS = 10, ROWS = 20;
const START_SPEED = { easy: 1, medium: 4, hard: 8 };
const ROWS_PER_SPEED = 10;
const LOCK_MS = 500;        // a piece resting on something locks after this long...
const LOCK_RESETS = 15;     // ...but moving or turning it starts the wait again, this many times
const CLEAR_MS = 200;       // full rows flash this long before they go
const POINTS = [0, 100, 300, 500, 800];   // for 1, 2, 3 or 4 rows at once, times the speed
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const PIECES = {
  I: { color: '#22b8cf', shape: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
  O: { color: '#f6c445', shape: [[1, 1], [1, 1]] },
  T: { color: '#8e5bd1', shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
  S: { color: '#4cb35a', shape: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
  Z: { color: '#e5484d', shape: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
  J: { color: '#2f7fc4', shape: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
  L: { color: '#ff8a1f', shape: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] },
};
// Where to try a turned piece when it doesn't fit where it is: beside it, then up one.
const KICKS = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];

const store = makeStore('tt-');
const records = makeRecords(store, { higher: true });

const canvas = $('game');
const ctx = canvas.getContext('2d');
// Older phones (iOS before 16) don't have roundRect on canvas: square corners are fine there.
if (!ctx.roundRect) ctx.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
const wrapEl = $('wrap');

// --- the game ---

let level = LEVEL_NAMES[store.get('level', '')] ? store.get('level', '') : 'easy';
let board, piece, bag, nextKey, score, lines, speed, state, fallAcc, lockAt, lockResets, clearing, popup;
// state: 'ready' (waiting for the first tap), 'playing', 'paused' or 'over'

const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pieces come out of a shuffled bag of all seven, so none is missing for long.
function takeFromBag() {
  if (!bag.length) bag = shuffle(Object.keys(PIECES));
  return bag.pop();
}

function newGame() {
  board = emptyBoard();
  bag = [];
  nextKey = takeFromBag();
  score = 0;
  lines = 0;
  speed = START_SPEED[level];
  clearing = null;
  popup = null;
  state = 'ready';
  store.remove('current');
  spawn();
  $('overlay').hidden = true;
  updateStats();
}

function spawn() {
  const key = nextKey;
  nextKey = takeFromBag();
  const shape = PIECES[key].shape.map((r) => [...r]);
  piece = { key, shape, x: Math.floor((COLS - shape[0].length) / 2), y: key === 'I' ? -1 : 0 };
  fallAcc = 0;
  lockAt = null;
  lockResets = 0;
  if (collides(piece.shape, piece.x, piece.y)) gameOver();
}

// Rows above the top of the well (y < 0) are open air.
function collides(shape, x, y) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const bx = x + c, by = y + r;
      if (bx < 0 || bx >= COLS || by >= ROWS) return true;
      if (by >= 0 && board[by][bx]) return true;
    }
  }
  return false;
}

const resting = () => collides(piece.shape, piece.x, piece.y + 1);
const canAct = () => state === 'playing' && piece && !clearing;

// A move or turn while resting gives the player a little more time before it locks.
function moved() {
  if (lockAt !== null && lockResets < LOCK_RESETS) {
    lockAt = performance.now() + LOCK_MS;
    lockResets++;
  }
}

function shift(dx) {
  if (!canAct() || collides(piece.shape, piece.x + dx, piece.y)) return false;
  piece.x += dx;
  moved();
  return true;
}

function rotate() {
  if (!canAct() || piece.key === 'O') return;
  const turned = piece.shape[0].map((_, c) => piece.shape.map((row) => row[c]).reverse());   // clockwise
  for (const [dx, dy] of KICKS) {
    if (!collides(turned, piece.x + dx, piece.y + dy)) {
      piece.shape = turned;
      piece.x += dx;
      piece.y += dy;
      moved();
      return;
    }
  }
}

function softDrop() {
  if (!canAct()) return;
  if (resting()) return;
  piece.y++;
  score += 1;
  fallAcc = 0;
  updateStats();
}

function hardDrop() {
  if (!canAct()) return;
  while (!resting()) {
    piece.y++;
    score += 2;
  }
  lockPiece();
}

function lockPiece() {
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (!piece.shape[r][c]) continue;
      const by = piece.y + r;
      if (by < 0) { gameOver(); return; }   // stuck out of the top of the well
      board[by][piece.x + c] = piece.key;
    }
  }
  piece = null;
  const full = [];
  board.forEach((row, y) => { if (row.every(Boolean)) full.push(y); });
  if (full.length) {
    score += POINTS[full.length] * speed;
    lines += full.length;
    clearing = { rows: full, until: performance.now() + CLEAR_MS };
    popup = { text: full.length === 4 ? 'TETRIS! 🎉' : `+${POINTS[full.length] * speed}`, at: performance.now() };
    buzz(full.length === 4 ? [40, 30, 40] : 25);
    if (full.length === 4) confetti();
  } else {
    spawn();
  }
  updateStats();
}

function finishClear() {
  board = board.filter((_, y) => !clearing.rows.includes(y));
  while (board.length < ROWS) board.unshift(Array(COLS).fill(null));
  clearing = null;
  const newSpeed = START_SPEED[level] + Math.floor(lines / ROWS_PER_SPEED);
  if (newSpeed > speed) {
    speed = newSpeed;
    popup = { text: `Hraði ${speed}! 🚀`, at: performance.now() };
  }
  spawn();
}

// Time between one-row steps down: 1 s at speed 1, quicker each speed, never under 50 ms.
const stepMs = () => Math.max(50, 1000 * Math.pow(0.8, speed - 1));

function step(dt) {
  if (state !== 'playing') return;
  const now = performance.now();
  if (clearing) {
    if (now >= clearing.until) finishClear();
    return;
  }
  if (!piece) return;
  if (resting()) {
    if (lockAt === null) lockAt = now + LOCK_MS;
    else if (now >= lockAt) lockPiece();
    return;
  }
  lockAt = null;   // slid off a ledge: falling again
  fallAcc += dt;
  if (fallAcc >= stepMs()) {
    fallAcc = 0;
    piece.y++;
  }
}

function begin() {
  if (state === 'ready') {
    state = 'playing';
    fallAcc = 0;
    drawPause();
  }
}

function gameOver() {
  state = 'over';
  piece = null;
  store.remove('current');
  drawPause();
  buzz([80, 40, 120]);
  const best = records.best(level);
  const isRecord = records.add({ level, won: true, score, lines });
  let text = `${score} stig og ${rowsText(lines)}.`;
  if (isRecord && score) text += ' Nýtt met! 🏆';
  else if (best) text += ` Metið er ${best} stig.`;
  updateBest();
  setTimeout(() => {
    if (state !== 'over') return;
    showResult(isRecord && score ? '🏆' : '🧱', 'Leik lokið!', text);
  }, 600);
}

// Icelandic: 1 lína, 2 línur, 21 lína
function rowsText(n) {
  return n + (n % 10 === 1 && n % 100 !== 11 ? ' lína' : ' línur');
}

// --- pause and saving ---

function setPaused(on) {
  if (on && state !== 'playing') return;
  if (!on && state !== 'paused') return;
  state = on ? 'paused' : 'playing';
  stopAllHolds();
  drawPause();
}

function drawPause() {
  $('pause').disabled = state !== 'playing' && state !== 'paused';
  $('pause').textContent = state === 'paused' ? '▶️' : '⏸️';
  $('pause').setAttribute('aria-label', state === 'paused' ? 'Halda áfram' : 'Hlé');
}

function save() {
  if (state !== 'playing' && state !== 'paused') return;
  if (clearing) finishClear();
  store.setJSON('current', { level, board, piece, bag, nextKey, score, lines, speed });
}

function restore() {
  const s = store.getJSON('current', null);
  if (!s || !LEVEL_NAMES[s.level] || !Array.isArray(s.board) || s.board.length !== ROWS) return false;
  level = s.level;
  board = s.board;
  piece = s.piece && PIECES[s.piece.key] ? s.piece : null;
  bag = Array.isArray(s.bag) ? s.bag : [];
  nextKey = PIECES[s.nextKey] ? s.nextKey : takeFromBag();
  score = Number(s.score) || 0;
  lines = Number(s.lines) || 0;
  speed = Number(s.speed) || START_SPEED[level];
  clearing = null;
  popup = null;
  fallAcc = 0;
  lockAt = null;
  lockResets = 0;
  state = 'paused';   // waits for a tap, so a game never carries on unseen
  if (!piece) spawn();
  updateStats();
  return true;
}

window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  setPaused(true);
  save();
});

// --- stats, records and the difficulty tabs ---

function updateStats() {
  $('score').textContent = score;
  drawPause();
}

function updateBest() {
  const best = records.best(level);
  $('best').textContent = best || '–';
}

function showLevel() {
  document.querySelectorAll('#levels button').forEach((b) => b.classList.toggle('active', b.dataset.level === level));
  updateBest();
}

$('levels').addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  level = b.dataset.level;
  store.set('level', level);
  showLevel();
  newGame();
});

$('trophy').addEventListener('click', () => {
  setPaused(true);
  const stats = records.stats();
  const rows = Object.keys(LEVEL_NAMES).map((lv) => [LEVEL_NAMES[lv], records.best(lv) || '–', (stats[lv] || {}).played || 0]);
  const games = records.history().map((g) => ({ what: `🧱 ${LEVEL_NAMES[g.level] || ''}`, value: `${g.score} stig`, at: g.at }));
  showRecords(rows, games);
});

$('new').addEventListener('click', newGame);
$('again').addEventListener('click', newGame);
$('pause').addEventListener('click', () => setPaused(state === 'playing'));

// --- drawing ---

let W = 0, H = 0, dpr = 1, cell = 20, boardX = 0, boardY = 0, panelX = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = wrapEl.clientWidth;
  H = wrapEl.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  // the well on the left, a panel 4.4 cells wide on the right with the next piece and speed
  cell = Math.floor(Math.min(H / ROWS, (W - 10) / (COLS + 4.4)));
  const total = cell * COLS + 10 + cell * 4.4;
  boardX = Math.round((W - total) / 2);
  boardY = Math.round((H - cell * ROWS) / 2);
  panelX = boardX + cell * COLS + 10;
}
window.addEventListener('resize', resize);

function block(x, y, s, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, s - 2, s - 2, s * 0.18);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';   // a shine along the top
  ctx.beginPath();
  ctx.roundRect(x + s * 0.18, y + s * 0.14, s * 0.64, s * 0.16, s * 0.08);
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';        // and a shadow along the bottom
  ctx.fillRect(x + 1 + s * 0.1, y + s - 1 - s * 0.14, s - 2 - s * 0.2, s * 0.1);
  ctx.globalAlpha = 1;
}

function pill(text, x, y, size, bg, fg) {
  ctx.font = `800 ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + size * 0.9, h = size * 1.35;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + size * 0.04);
}

function ghostY() {
  let y = piece.y;
  while (!collides(piece.shape, piece.x, y + 1)) y++;
  return y;
}

function eachCell(shape, fn) {
  shape.forEach((row, r) => row.forEach((v, c) => { if (v) fn(r, c); }));
}

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const bw = cell * COLS, bh = cell * ROWS;

  // the well
  ctx.fillStyle = '#1b2a4a';
  ctx.beginPath();
  ctx.roundRect(boardX - 4, boardY - 4, bw + 8, bh + 8, 14);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  for (let x = 1; x < COLS; x++) ctx.fillRect(boardX + x * cell, boardY, 1, bh);
  for (let y = 1; y < ROWS; y++) ctx.fillRect(boardX, boardY + y * cell, bw, 1);

  if (state === 'paused') {
    // the well is covered while paused
    pill('Hlé', boardX + bw / 2, boardY + bh * 0.4, 30, '#fff', '#1b2a4a');
    pill('Ýttu til að halda áfram', boardX + bw / 2, boardY + bh * 0.52, Math.min(18, cell * 0.8), '#ff8a1f', '#1b2a4a');
  } else {
    board.forEach((row, y) => row.forEach((key, x) => {
      if (key) block(boardX + x * cell, boardY + y * cell, cell, PIECES[key].color, state === 'over' ? 0.45 : 1);
    }));
    if (clearing) {
      const flash = 0.5 + 0.5 * Math.sin(performance.now() / 30);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + flash * 0.4})`;
      for (const y of clearing.rows) ctx.fillRect(boardX, boardY + y * cell, bw, cell);
    }
    if (piece && state !== 'over') {
      const color = PIECES[piece.key].color, gy = ghostY();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      eachCell(piece.shape, (r, c) => {
        if (gy + r < 0) return;
        ctx.globalAlpha = 0.55;
        ctx.strokeRect(boardX + (piece.x + c) * cell + 3, boardY + (gy + r) * cell + 3, cell - 6, cell - 6);
        ctx.globalAlpha = 1;
      });
      eachCell(piece.shape, (r, c) => {
        if (piece.y + r >= 0) block(boardX + (piece.x + c) * cell, boardY + (piece.y + r) * cell, cell, color);
      });
    }
    if (popup) {
      const age = (performance.now() - popup.at) / 1000;
      if (age > 1.1) popup = null;
      else {
        ctx.globalAlpha = Math.min(1, 2.2 - age * 2);
        pill(popup.text, boardX + bw / 2, boardY + bh * 0.42 - age * 30, Math.min(24, cell * 1.1), '#fff', '#8e2a58');
        ctx.globalAlpha = 1;
      }
    }
    if (state === 'ready') {
      ctx.fillStyle = 'rgba(27, 42, 74, 0.45)';
      ctx.fillRect(boardX, boardY, bw, bh);
      pill('Ýttu til að byrja', boardX + bw / 2, boardY + bh * 0.45, Math.min(20, cell * 0.85), '#ff8a1f', '#1b2a4a');
    }
  }

  // the panel: next piece, speed and rows
  const pw = cell * 4.4;
  const label = (text, y) => {
    ctx.fillStyle = '#4a5a78';
    ctx.font = `700 ${Math.max(11, Math.round(cell * 0.6))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, panelX + pw / 2, y);
  };
  const big = (text, y) => {
    ctx.fillStyle = '#1b2a4a';
    ctx.font = `800 ${Math.max(16, Math.round(cell * 1.1))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, panelX + pw / 2, y);
  };
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(panelX, boardY - 4, pw, cell * 4.6, 14);
  ctx.fill();
  label('Næst', boardY + cell * 0.9);
  if (state !== 'paused') {
    const next = PIECES[nextKey].shape, s = cell * 0.8;
    const used = next.map((row, r) => row.some(Boolean) ? r : -1).filter((r) => r >= 0);
    const cols = next[0].map((_, c) => next.some((row) => row[c]) ? c : -1).filter((c) => c >= 0);
    const ox = panelX + pw / 2 - (cols.length * s) / 2 - cols[0] * s;
    const oy = boardY + cell * 2.6 - (used.length * s) / 2 - used[0] * s;
    eachCell(next, (r, c) => block(ox + c * s, oy + r * s, s, PIECES[nextKey].color));
  }
  const y2 = boardY + cell * 5.4;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(panelX, y2, pw, cell * 6, 14);
  ctx.fill();
  label('Hraði', y2 + cell * 1.1);
  big(String(speed), y2 + cell * 2.5);
  label('Línur', y2 + cell * 3.9);
  big(String(lines), y2 + cell * 5.3);
}

let last = 0;
function frame(ts) {
  const dt = Math.min(100, ts - last || 0);
  last = ts;
  if (!document.hidden && W) {
    step(dt);
    draw();
  }
  requestAnimationFrame(frame);
}

// --- input ---

// Holding a move button or arrow key repeats it, after a short wait (like a keyboard).
const HOLD_WAIT = 170, HOLD_REPEAT = { left: 55, right: 55, down: 40 };
const holds = {};
const ACTIONS = { left: () => shift(-1), right: () => shift(1), down: softDrop, rotate, drop: hardDrop };

function press(act) {
  if (state === 'paused') { setPaused(false); return; }
  if (state === 'over') return;
  begin();
  ACTIONS[act]();
  if (!HOLD_REPEAT[act] || holds[act]) return;
  const wait = act === 'down' ? HOLD_REPEAT.down : HOLD_WAIT;
  holds[act] = setTimeout(function again() {
    ACTIONS[act]();
    holds[act] = setTimeout(again, HOLD_REPEAT[act]);
  }, wait);
}

function release(act) {
  clearTimeout(holds[act]);
  delete holds[act];
}

function stopAllHolds() {
  Object.keys(holds).forEach(release);
  document.querySelectorAll('#controls .held').forEach((b) => b.classList.remove('held'));
}

$('controls').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  e.preventDefault();
  b.setPointerCapture(e.pointerId);
  b.classList.add('held');
  press(b.dataset.act);
});
for (const type of ['pointerup', 'pointercancel']) {
  $('controls').addEventListener(type, (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    b.classList.remove('held');
    release(b.dataset.act);
  });
}

// On the board: tap to turn, drag sideways to move a cell at a time, drag down to bring
// it down faster, or flick down to drop it all the way.
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (state === 'over') return;
  if (state === 'paused') { setPaused(false); return; }
  begin();
  canvas.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), dx: 0, dy: 0, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const cols = Math.trunc((e.clientX - drag.x) / cell);
  while (drag.dx < cols && shift(1)) drag.dx++;
  while (drag.dx > cols && shift(-1)) drag.dx--;
  if (cols !== 0) drag.moved = true;
  const rows = Math.trunc((e.clientY - drag.y) / cell);
  while (drag.dy < rows && canAct() && !resting()) { softDrop(); drag.dy++; }
  if (Math.abs(e.clientX - drag.x) > 8 || Math.abs(e.clientY - drag.y) > 8) drag.moved = true;
});
canvas.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.y, dt = performance.now() - drag.at;
  if (!drag.moved) rotate();
  else if (dy > cell * 2 && dt < 260 && dy > Math.abs(e.clientX - drag.x) * 2) hardDrop();   // a quick flick down
  drag = null;
});
canvas.addEventListener('pointercancel', () => { drag = null; });

const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'rotate', x: 'rotate', X: 'rotate', ' ': 'drop' };
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input')) return;
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    e.preventDefault();
    setPaused(state === 'playing');
    return;
  }
  const act = KEYS[e.key];
  if (!act) return;
  e.preventDefault();
  if (!e.repeat) press(act);
});
document.addEventListener('keyup', (e) => { if (KEYS[e.key]) release(KEYS[e.key]); });
window.addEventListener('blur', stopAllHolds);

// --- start ---

resize();
if (!restore()) newGame();
showLevel();
updateStats();
requestAnimationFrame(frame);
registerServiceWorker('../sw.js');
