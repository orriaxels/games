'use strict';
// Crowd Runner. Uses helpers from ../common.js.
//
// The group runs forward on its own; the player steers left or right. Gates come in
// pairs (+10 | ×2 ...) and change the group's size. Red groups on the road fight the
// group one for one. At the end a castle has defenders: arrive with more to win.
// The road is drawn in simple perspective: world x is -1..1 across the road, z is
// distance along it; things are drawn at depth d = z - distance + PLAYER_D.

// castle: where the castle's size sits between `low` (a careful kid who avoids red gates
// but always takes the smaller blue one, = 0) and `best` (the bigger gate every time, = 1).
// Measured by simulation so that a kid who picks the better gate 80% of the time wins
// about 95% / 75% / 55% of runs, and picking at random about 60% / 30% / 8%.
const LEVELS = {
  easy:   { rows: 6,  enemies: 1, ops: ['+', '×'],           speed: 6.5, castle: 0.1 },
  medium: { rows: 8,  enemies: 2, ops: ['+', '×', '−'],      speed: 7.5, castle: 0.15 },
  hard:   { rows: 10, enemies: 3, ops: ['+', '×', '−', '÷'], speed: 8.5, castle: 0.22 },
};
const FIGHT_SHARE = 0.45;   // a red group is this share of the careful kid's group at that point
const SPACING = 10;        // world units between things on the road
const FIRST = 12;          // the first gates are this far ahead
const PLAYER_D = 2.4;      // how far in front of the camera the group runs
const FAR = 60;            // nothing is drawn further away than this
const MAX_DRAWN = 160;     // runners drawn; the number can be higher
const UNIT = 0.055;        // spacing between runners in the group, in world units

const store = makeStore('cr-');
const records = makeRecords(store, { higher: true });

const canvas = $('game');
const ctx = canvas.getContext('2d');
// Older phones (iOS before 16) don't have roundRect on canvas: square corners are fine there.
if (!ctx.roundRect) ctx.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
const wrapEl = $('wrap');

let level = store.get('level', 'easy');
if (!LEVELS[level]) level = 'easy';

// Current run
let track, count, dist, steer, crowdX, state, battle, popups, runId = 0;
let W = 0, H = 0, dpr = 1;

// --- maths ---

// What a gate does to a group of n. A gate never empties the group: at least 1 is left,
// so the group can only be lost in a fight.
function apply(op, n, v) {
  if (op === '+') return n + v;
  if (op === '−') return Math.max(1, n - v);
  if (op === '×') return n * v;
  return Math.max(1, Math.floor(n / v));
}
const RED_FROM = 10;   // red gates only show up once the group is about this big

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const isGood = (g) => g.op === '+' || g.op === '×';

// A gate for a group of about n runners. Numbers stay round so they're easy to compare.
function gate(op, n) {
  if (op === '+') {
    const opts = [3, 5, 8, 10, 15, 20, 25, 30, 40, 50].filter((v) => v <= Math.max(10, n * 1.2));
    return { op, v: pick(opts) };
  }
  if (op === '×') return { op, v: n < 40 ? pick([2, 2, 3]) : 2 };
  if (op === '−') {
    const opts = [3, 5, 10, 15, 20, 30].filter((v) => v <= Math.max(3, n * 0.6));
    return { op, v: pick(opts) };
  }
  return { op, v: n >= 30 && Math.random() < 0.4 ? 3 : 2 };
}

// Two gates side by side. Usually both help and the kid works out which helps more;
// on medium and hard sometimes one of them hurts.
function gatePair(ops, n) {
  const good = ops.filter((o) => o === '+' || (o === '×' && n < 400));
  const bad = n >= RED_FROM ? ops.filter((o) => o === '−' || o === '÷') : [];
  for (let t = 0; t < 30; t++) {
    let a, b;
    if (bad.length && Math.random() < 0.35) {
      a = gate(pick(good), n);
      b = gate(pick(bad), n);
    } else {
      a = gate(pick(good), n);
      b = gate(good.length > 1 && Math.random() < 0.75 ? good.find((o) => o !== a.op) : pick(good), n);
    }
    if (apply(a.op, n, a.v) !== apply(b.op, n, b.v)) return Math.random() < 0.5 ? [a, b] : [b, a];
  }
  return [{ op: '+', v: 10 }, { op: '+', v: 5 }];
}

// Builds the road while following two kids: `best` takes the bigger gate every time,
// `low` avoids red gates but always takes the smaller blue one. Red groups are sized from
// `low` so one wrong choice doesn't end the game, and the castle sits between the two.
function makeTrack(lv) {
  const L = LEVELS[lv];
  const items = [];
  const fightAfter = new Set([...Array(L.enemies).keys()].map((k) => Math.round(((k + 1) * L.rows) / (L.enemies + 1)) - 1));
  let best = 1, low = 1, z = FIRST;
  for (let r = 0; r < L.rows; r++) {
    // gates are made for the group size in between, so they make sense either way
    const [left, right] = gatePair(L.ops, Math.round(Math.sqrt(best * low)));
    items.push({ kind: 'gates', z, left, right, done: false });
    best = Math.max(apply(left.op, best, left.v), apply(right.op, best, right.v));
    const blue = [left, right].filter(isGood);
    low = Math.min(...blue.map((g) => apply(g.op, low, g.v)));
    z += SPACING;
    if (fightAfter.has(r)) {
      const size = Math.max(1, Math.min(low - 1, Math.round(low * FIGHT_SHARE)));
      items.push({ kind: 'enemy', z, count: size, start: size, done: false });
      best -= size;
      low -= size;
      z += SPACING;
    }
  }
  const boss = Math.max(3, Math.min(best - 1, Math.round(low + (best - low) * L.castle)));
  items.push({ kind: 'boss', z: z + 2, count: boss, start: boss, done: false });
  return { items, end: z + 2, best, low, boss };
}

// --- game state ---

function newRun() {
  runId++;
  track = makeTrack(level);
  count = 1;
  dist = 0;
  steer = 0;
  crowdX = 0;
  state = 'ready';
  battle = null;
  popups = [];
  $('overlay').hidden = true;
  $('boss').textContent = track.boss;
  document.querySelectorAll('#levels button').forEach((b) => b.classList.toggle('active', b.dataset.level === level));
  updateBest();
  updateCount();
}

function updateCount() { $('count').textContent = count; }
function updateBest() { $('best').textContent = records.best(level) || '–'; }

// How close the group gets before a fight starts; the castle is fought from further
// away so it stays on screen.
const fightGap = (it) => (it.kind === 'boss' ? 2.6 : 0.9);

function step(dt) {
  crowdX += (steer - crowdX) * Math.min(1, dt * 10);
  if (state === 'running') {
    dist += LEVELS[level].speed * dt;
    for (const it of track.items) {
      if (it.done) continue;
      if (it.kind === 'gates' && dist >= it.z) {
        it.done = true;
        const g = crowdX < 0 ? it.left : it.right;
        const before = count;
        count = apply(g.op, count, g.v);
        popups.push({ text: `${g.op}${g.v}`, good: count >= before, t: 0 });
        buzz(isGood(g) ? 15 : [30, 30, 30]);
        updateCount();
      } else if (it.kind !== 'gates' && dist >= it.z - fightGap(it)) {
        state = 'battle';
        battle = { it, acc: 0 };
        dist = it.z - fightGap(it);
      }
      break;   // things are in order: only the next one matters
    }
  } else if (state === 'battle') {
    const it = battle.it;
    battle.acc += Math.max(10, (count + it.count) / 1.4) * dt;   // runners lost per second
    const k = Math.min(Math.floor(battle.acc), count, it.count);
    battle.acc -= k;
    count -= k;
    it.count -= k;
    if (k) updateCount();
    if (count === 0) return lose();
    if (it.count === 0) {
      it.done = true;
      battle = null;
      if (it.kind === 'boss') return win();
      state = 'running';
    }
  }
  popups.forEach((p) => { p.t += dt; });
  popups = popups.filter((p) => p.t < 1);
}

function win() {
  state = 'won';
  const best = records.best(level);
  const isRecord = records.add({ level, won: true, score: count });
  updateBest();
  buzz([40, 30, 40]);
  confetti();
  const text = isRecord
    ? `${count} eftir í hópnum. Nýtt met! 🏆`
    : `${count} eftir í hópnum. Metið er ${best}.`;
  const id = runId;
  setTimeout(() => { if (id === runId) showResult('🎉', 'Þú vannst!', text); }, 700);
}

function lose() {
  state = 'lost';
  records.add({ level, won: false, score: 0 });
  buzz([80, 40, 120]);
  const text = battle && battle.it.kind === 'boss'
    ? `Kastalinn hafði ${battle.it.count} eftir. Veldu stærri hliðin og reyndu aftur!`
    : 'Hópurinn kláraðist. Reyndu aftur!';
  const id = runId;
  setTimeout(() => { if (id === runId) showResult('💥', 'Búmm!', text); }, 700);
}

// --- drawing ---

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = wrapEl.clientWidth;
  H = wrapEl.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
}
window.addEventListener('resize', resize);

const horizon = () => H * 0.2;
const vScale = () => (H * 0.8 - horizon()) * PLAYER_D;   // ground at the group's depth sits at 80% height
const hScale = () => W * 0.44 * PLAYER_D;                 // the road at the group's depth is 88% wide
const sx = (x, d) => W / 2 + (x * hScale()) / d;
const gy = (d, h = 0) => horizon() + ((1 - h) * vScale()) / d;   // y of a point h world units above the road

function drawRoad() {
  const sky = ctx.createLinearGradient(0, 0, 0, horizon());
  sky.addColorStop(0, '#bcdcf2');
  sky.addColorStop(1, '#e8f2f9');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon() + 1);
  ctx.fillStyle = '#9ccc6b';
  ctx.fillRect(0, horizon(), W, H - horizon());

  // stripes across the road every `band` units, fixed to the road so they stream past
  const near = 0.9, band = 2;
  for (let k = Math.floor((dist - PLAYER_D) / band); ; k++) {
    const d1raw = k * band - dist + PLAYER_D, d2 = d1raw + band;
    if (d1raw > FAR) break;
    if (d2 <= near) continue;
    const d1 = Math.max(near, d1raw);
    ctx.fillStyle = k % 2 ? '#d3d9e1' : '#dde2e8';
    ctx.beginPath();
    ctx.moveTo(sx(-1, d1), gy(d1));
    ctx.lineTo(sx(1, d1), gy(d1));
    ctx.lineTo(sx(1, d2), gy(d2));
    ctx.lineTo(sx(-1, d2), gy(d2));
    ctx.fill();
  }
  // road edges
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  for (const x of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx(x, near), gy(near));
    ctx.lineTo(sx(x, FAR), gy(FAR));
    ctx.stroke();
  }
}

function pill(text, x, y, size, bg, fg) {
  ctx.font = `800 ${size}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
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

function drawGates(it, d) {
  const sides = [[-1, it.left], [1, it.right]];
  for (const [side, g] of sides) {
    const x0 = side < 0 ? -0.98 : 0.02, x1 = side < 0 ? -0.02 : 0.98;
    const top = gy(d, 0.75), bottom = gy(d);
    const good = isGood(g);
    ctx.fillStyle = good ? 'rgba(47, 127, 196, 0.55)' : 'rgba(229, 72, 77, 0.55)';
    ctx.fillRect(sx(x0, d), top, sx(x1, d) - sx(x0, d), bottom - top);
    ctx.fillStyle = good ? '#1d5b93' : '#a8262b';
    ctx.fillRect(sx(x0, d), top, sx(x1, d) - sx(x0, d), Math.max(2, (bottom - top) * 0.07));
    const size = Math.max(10, (0.28 * vScale()) / d);
    ctx.font = `800 ${size}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${g.op}${g.v}`, sx((x0 + x1) / 2, d), (top + bottom) / 2);
  }
}

// Runners stand in a sunflower spiral, so any number of them packs into a round group.
const spiral = [];
for (let i = 0; i < MAX_DRAWN; i++) {
  const r = UNIT * Math.sqrt(i), a = i * 2.39996;
  spiral.push([Math.cos(a) * r, Math.sin(a) * r * 0.8]);
}
const groupRadius = (n) => UNIT * Math.sqrt(Math.min(n, MAX_DRAWN));

function drawGroup(n, cx, depth, color, dark, t, running) {
  const drawn = Math.min(n, MAX_DRAWN);
  const pts = spiral.slice(0, drawn).map(([dx, dz], i) => [cx + dx, depth + dz, i]);
  pts.sort((p, q) => q[1] - p[1]);   // far ones first
  for (const [x, d, i] of pts) {
    if (d <= 0.5) continue;
    const s = (0.045 * vScale()) / d;   // runner size on screen
    const bob = running ? Math.abs(Math.sin(t * 14 + i * 1.7)) * s * 0.35 : 0;
    const px = sx(x, d), py = gy(d) - bob;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.beginPath();
    ctx.ellipse(px, gy(d), s * 0.7, s * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.roundRect(px - s * 0.42, py - s * 1.5, s * 0.84, s * 1.3, s * 0.4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py - s * 1.75, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCastle(it, d) {
  const w = 0.7, x0 = -w, x1 = w;
  const top = gy(d, 0.85), bottom = gy(d);
  const left = sx(x0, d), right = sx(x1, d);
  ctx.fillStyle = '#c94a4f';
  ctx.fillRect(left, top, right - left, bottom - top);
  const tooth = (right - left) / 7;
  for (let k = 0; k < 7; k += 2) ctx.fillRect(left + k * tooth, top - tooth * 0.8, tooth, tooth * 0.8);
  ctx.fillStyle = '#7d1f24';
  const door = (right - left) * 0.22;
  ctx.beginPath();
  ctx.roundRect(W / 2 - door / 2, bottom - (bottom - top) * 0.45, door, (bottom - top) * 0.45, [door / 2, door / 2, 0, 0]);
  ctx.fill();
  const size = Math.min(34, Math.max(12, (0.26 * vScale()) / d));
  pill(String(it.count), W / 2, Math.max(size, top - tooth * 1.8), size, '#fff', '#a8262b');   // never off the top
}

function draw(t) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawRoad();

  // everything ahead, far to near
  const ahead = track.items.filter((it) => !it.done || (it.kind !== 'gates' && it.count > 0));
  for (const it of [...ahead].reverse()) {
    const d = it.z - dist + PLAYER_D;
    if (d > FAR || d < 0.6) continue;
    if (it.kind === 'gates') drawGates(it, d);
    else if (it.kind === 'enemy') {
      drawGroup(it.count, 0, d + groupRadius(it.count), '#e5484d', '#a8262b', t, false);
      pill(String(it.count), W / 2, gy(d + groupRadius(it.count), 0.5) - 10, Math.max(12, (0.2 * vScale()) / d), '#fff', '#a8262b');
    } else drawCastle(it, d);
  }

  // the group, kept on the road
  const r = groupRadius(count);
  const cx = Math.max(-1 + r + 0.05, Math.min(1 - r - 0.05, crowdX));
  drawGroup(count, cx, PLAYER_D, '#2f7fc4', '#1d5b93', t, state === 'running');
  if (count > 0) pill(String(count), sx(cx, PLAYER_D), gy(PLAYER_D + r, 0.2) - 30, 22, '#fff', '#1d5b93');

  // "+10" floating up from the group after a gate
  for (const p of popups) {
    ctx.globalAlpha = 1 - p.t;
    pill(p.text, sx(cx, PLAYER_D), gy(PLAYER_D + r, 0.2) - 64 - p.t * 40, 20, p.good ? '#2f7fc4' : '#e5484d', '#fff');
    ctx.globalAlpha = 1;
  }

  if (state === 'ready') {
    ctx.fillStyle = 'rgba(27, 42, 74, 0.35)';
    ctx.fillRect(0, 0, W, H);
    pill('Ýttu til að byrja', W / 2, H * 0.45, 24, '#ff8a1f', '#1b2a4a');
  }
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0);
  last = ts;
  if (!document.hidden && W) {
    step(dt);
    draw(ts / 1000);
  }
  requestAnimationFrame(frame);
}

// --- input: drag sideways to steer, tap a side to move there, arrows on a computer ---

let drag = null;
const STEER_MAX = 0.85;
const clampSteer = (v) => Math.max(-STEER_MAX, Math.min(STEER_MAX, v));

canvas.addEventListener('pointerdown', (e) => {
  if (state === 'won' || state === 'lost') return;
  if (state === 'ready') state = 'running';
  canvas.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, x: e.clientX, from: steer, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 6) drag.moved = true;
  steer = clampSteer(drag.from + (dx / W) * 2.6);
});
canvas.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved) {   // a tap moves to that side
    const r = canvas.getBoundingClientRect();
    steer = e.clientX - r.left < r.width / 2 ? -0.5 : 0.5;
  }
  drag = null;
});
canvas.addEventListener('pointercancel', () => { drag = null; });

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    if (state === 'ready') state = 'running';
    steer = clampSteer(steer + (e.key === 'ArrowLeft' ? -0.3 : 0.3));
  } else if (e.key === ' ' && state === 'ready') {
    e.preventDefault();
    state = 'running';
  }
});

$('levels').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  level = b.dataset.level;
  store.set('level', level);
  newRun();
});
$('new').addEventListener('click', newRun);
$('again').addEventListener('click', newRun);

$('trophy').addEventListener('click', () => {
  const stats = records.stats();
  const rows = Object.keys(LEVELS).map((lv) => {
    const s = stats[lv] || { played: 0, won: 0 };
    return [LEVEL_NAMES[lv], records.best(lv) ? `${records.best(lv)} eftir` : '–', `${s.won} af ${s.played}`];
  });
  const games = records.history().map((g) => ({
    at: g.at,
    what: `${g.won ? '🎉' : '💥'} ${LEVEL_NAMES[g.level] || ''}`,
    value: g.won ? `${g.score} eftir` : 'Tapað',
  }));
  showRecords(rows, games);
});

// --- start ---

resize();
newRun();
requestAnimationFrame(frame);
registerServiceWorker('../sw.js');
