'use strict';
// Crowd Runner. Uses helpers from ../common.js.
//
// The group runs forward on its own; the player steers left or right. Gates come in
// pairs (+10 | ×2 ...) and change the group's size, red groups on the road fight one
// for one, spikes cut off runners that touch them, and the castle at the end has to be
// beaten with more runners than it holds. There are numbered levels; each level is
// always the same road (it's built from a seed), and finishing one unlocks the next.
//
// The road is drawn in simple perspective: world x is -1..1 across the road, z is the
// distance along it, h is height. Things are drawn at depth d = z - dist + PLAYER_D.

const MAX_LEVEL = 40;
const SPACING = 10;         // world units between gate rows
const FIRST = 12;           // the first gates are this far ahead
const PLAYER_D = 2.4;       // how far in front of the camera the group runs
const FAR = 60;             // nothing is drawn further away than this
const MAX_DRAWN = 150;      // runners drawn; the number itself can be higher
const UNIT = 0.055;         // spacing between runners in the group, in world units
const MAX_R = 0.55;         // a big group is squeezed to this radius so it can always pass a spike patch
const RED_FROM = 10;        // red gates only show up once the group is about this big
const FIGHT_SHARE = 0.45;   // a red group is this share of a careful kid's group at that point

const store = makeStore('cr-');

const canvas = $('game');
const ctx = canvas.getContext('2d');
// Older phones (iOS before 16) don't have roundRect on canvas: square corners are fine there.
if (!ctx.roundRect) ctx.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
const wrapEl = $('wrap');

// --- seeded random numbers, so a level is the same road every time ---

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- gates ---

// What a gate does to a group of n. A gate never empties the group: at least 1 is left.
function apply(op, n, v) {
  if (op === '+') return n + v;
  if (op === '−') return Math.max(1, n - v);
  if (op === '×') return n * v;
  return Math.max(1, Math.floor(n / v));
}
const isGood = (g) => g.op === '+' || g.op === '×';

function makeGate(rand, op, n) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  if (op === '+') return { op, v: pick([3, 5, 8, 10, 15, 20, 25, 30, 40, 50].filter((v) => v <= Math.max(10, n * 1.2))) };
  if (op === '×') return { op, v: n < 40 ? pick([2, 2, 3]) : 2 };
  if (op === '−') return { op, v: pick([3, 5, 10, 15, 20, 30].filter((v) => v <= Math.max(3, n * 0.6))) };
  return { op, v: n >= 30 && rand() < 0.4 ? 3 : 2 };
}

// Two gates side by side. Usually both help and the kid works out which helps more;
// on later levels sometimes one of them hurts.
function gatePair(rand, ops, n) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const good = ops.filter((o) => o === '+' || (o === '×' && n < 400));
  const bad = n >= RED_FROM ? ops.filter((o) => o === '−' || o === '÷') : [];
  for (let t = 0; t < 30; t++) {
    let a, b;
    if (bad.length && rand() < 0.35) {
      a = makeGate(rand, pick(good), n);
      b = makeGate(rand, pick(bad), n);
    } else {
      a = makeGate(rand, pick(good), n);
      b = makeGate(rand, good.length > 1 && rand() < 0.75 ? good.find((o) => o !== a.op) : pick(good), n);
    }
    if (apply(a.op, n, a.v) !== apply(b.op, n, b.v)) return rand() < 0.5 ? [a, b] : [b, a];
  }
  return [{ op: '+', v: 10 }, { op: '+', v: 5 }];
}

// --- levels ---

function levelParams(n) {
  const k = Math.min(1, (n - 1) / 29);   // 0 on level 1, 1 from level 30
  return {
    rows: Math.min(12, 5 + Math.floor(n / 3)),
    fights: n < 3 ? 0 : Math.min(4, 1 + Math.floor((n - 3) / 5)),
    spikes: n < 6 ? 0 : Math.min(5, 1 + Math.floor((n - 6) / 4)),
    moving: n >= 14,
    ops: n < 4 ? ['+', '×'] : n < 9 ? ['+', '×', '−'] : ['+', '×', '−', '÷'],
    speed: 5.2 + 2 * k,
    // share of runs that a kid who picks the better gate 80% of the time should win
    target: 0.97 - 0.42 * k,
  };
}

// A kid playing the level, for sizing the castle: picks the better gate 80% of the time,
// and clips a spike patch now and then. Returns the group left when reaching the castle.
function simulateKid(items, rand) {
  let n = 1;
  for (const it of items) {
    if (it.kind === 'gates') {
      const a = apply(it.left.op, n, it.left.v), b = apply(it.right.op, n, it.right.v);
      n = rand() < 0.8 ? Math.max(a, b) : Math.min(a, b);
    } else if (it.kind === 'spikes') {
      if (rand() < 0.35) n = Math.max(1, Math.round(n * 0.8));
    } else if (it.kind === 'enemy') {
      n -= it.start;
      if (n <= 0) return 0;
    }
  }
  return n;
}

// Builds level n while following two kids: `best` takes the bigger gate every time,
// `low` avoids red gates but always takes the smaller blue one. Red groups are sized from
// `low` so one wrong choice doesn't end the game. The castle is then sized by playing the
// level many times as a typical kid, so it's beaten about `target` of the time.
function makeLevel(n) {
  const P = levelParams(n);
  const rand = seeded(n * 2654435761);
  const items = [];
  const spread = (count) => new Set([...Array(count).keys()].map((k) => Math.round(((k + 1) * P.rows) / (count + 1)) - 1));
  const fightAfter = spread(P.fights);
  const spikeAfter = spread(P.spikes);
  let best = 1, low = 1, z = FIRST;
  for (let r = 0; r < P.rows; r++) {
    const [left, right] = gatePair(rand, P.ops, Math.round(Math.sqrt(best * low)));
    items.push({ kind: 'gates', z, left, right, done: false });
    best = Math.max(apply(left.op, best, left.v), apply(right.op, best, right.v));
    low = Math.min(...[left, right].filter(isGood).map((g) => apply(g.op, low, g.v)));
    if (spikeAfter.has(r)) {
      const w = 0.55 + rand() * 0.2;
      const side = rand() < 0.5 ? -1 : 1;
      const moving = P.moving && rand() < 0.5;
      items.push({ kind: 'spikes', z: z + 3.5, len: 3, w, side, moving, phase: rand() * 6.28, done: false });
    }
    z += SPACING;
    if (fightAfter.has(r)) {
      const size = Math.max(1, Math.min(low - 1, Math.round(low * FIGHT_SHARE)));
      items.push({ kind: 'enemy', z, count: size, start: size, done: false });
      best -= size;
      low -= size;
      z += SPACING;
    }
  }
  const sim = seeded(n * 7919 + 13);
  const finals = [...Array(300)].map(() => simulateKid(items, sim)).sort((a, b) => a - b);
  const castle = Math.max(3, Math.min(best - 1, finals[Math.floor((1 - P.target) * finals.length)]));
  items.push({ kind: 'boss', z: z + 2, count: castle, start: castle, done: false });
  return { n, P, items, end: z + 2, best, castle };
}

// Stars: 1 for winning, more for how much of the possible margin was kept.
function starsFor(lvl, left) {
  const margin = left / Math.max(1, lvl.best - lvl.castle);
  return margin >= 0.6 ? 3 : margin >= 0.25 ? 2 : 1;
}

// --- progress: unlocked levels, stars and best result per level ---

function loadProgress() {
  const p = store.getJSON('progress', null) || {};
  return { unlocked: Math.max(1, Number(p.unlocked) || 1), stars: p.stars || {}, best: p.best || {} };
}
let progress = loadProgress();
const saveProgress = () => store.setJSON('progress', progress);
const totalStars = () => Object.values(progress.stars).reduce((a, b) => a + b, 0);
const starText = (s) => '★'.repeat(s) + '☆'.repeat(3 - s);

// Clothes the group can wear, picked in the level picker. Never red: that's the enemies.
const OUTFITS = [
  { name: 'Blár', body: '#2f7fc4', dark: '#1d5b93' },
  { name: 'Grænn', body: '#3f9a4a', dark: '#26692f' },
  { name: 'Fjólublár', body: '#7b4bb3', dark: '#53307f' },
  { name: 'Appelsínugulur', body: '#f08a24', dark: '#b45f0c' },
  { name: 'Bleikur', body: '#e45fa4', dark: '#a83a73' },
  { name: 'Gulur', body: '#f2c230', dark: '#a8820f' },
];
let outfit = OUTFITS[Number(store.get('outfit', '0'))] || OUTFITS[0];

// Who runs in the group. Animals have fur (head and arms), legs and a darker shade for
// ears and spikes; people use the skin colour and dark trousers in the outfit's colour.
const CREATURES = {
  person: { emoji: '🧑', name: 'Fólk' },
  bear: { emoji: '🐻', name: 'Björn', fur: '#8b5a2b', legs: '#8b5a2b', dark: '#5e3b1b' },
  penguin: { emoji: '🐧', name: 'Mörgæs', fur: '#23272f', legs: '#f5a623', dark: '#111' },
  dog: { emoji: '🐕', name: 'Golden retriever', fur: '#e0aa4f', legs: '#e0aa4f', dark: '#b07a2a' },
  gorilla: { emoji: '🦍', name: 'Górilla', fur: '#3b3b40', legs: '#3b3b40', dark: '#26262a', back: '#7d7d86' },   // a silverback
  shark: { emoji: '🦈', name: 'Hákarl', fur: '#7f97ab', legs: '#7f97ab', dark: '#5c7285' },
  trex: { emoji: '🦖', name: 'Grameðla', fur: '#5aa05a', legs: '#5aa05a', dark: '#3c7a3c' },
};
let creature = CREATURES[store.get('creature', '')] ? store.get('creature', '') : 'person';
// The group's main and dark colour: the clothes on people, the fur on animals.
const groupColors = () => {
  const c = CREATURES[creature];
  return c.fur ? { body: c.fur, dark: c.dark } : outfit;
};

// --- sound: little tones made in the browser, no files ---

let soundOn = store.get('sound', '1') === '1';
let actx = null, lastHit = 0;

function audioStart() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  }
  if (actx.state === 'suspended') actx.resume();
}

function tone(f, dur, { type = 'triangle', vol = 0.08, delay = 0, to = null } = {}) {
  if (!soundOn || !actx) return;
  const t0 = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(actx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

const sfx = {
  start: () => tone(660, 0.08),
  good: () => { tone(523, 0.1); tone(784, 0.14, { delay: 0.07 }); },
  bad: () => { tone(392, 0.12, { type: 'square', vol: 0.04 }); tone(262, 0.18, { type: 'square', vol: 0.04, delay: 0.08 }); },
  hit: () => {
    const now = performance.now();
    if (now - lastHit < 70) return;
    lastHit = now;
    tone(170 + Math.random() * 130, 0.05, { type: 'square', vol: 0.025 });
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, { delay: i * 0.11, vol: 0.09 })),
  lose: () => tone(300, 0.35, { type: 'sawtooth', vol: 0.05, to: 110 }),
};

// --- the run ---

let levelNo = Math.min(progress.unlocked, Math.max(1, Number(store.get('level-n', progress.unlocked)) || 1));
let lvl, count, dist, steer, crowdX, cam, state, battle, popups, particles, units, shake, wonAt, runId = 0;
let t = 0;   // seconds since the page loaded, for animation

function newRun() {
  runId++;
  lvl = makeLevel(levelNo);
  lvl.items.forEach((it) => { it.done = false; if (it.start) it.count = it.start; });
  count = 1;
  dist = 0;
  steer = crowdX = cam = 0;
  state = 'ready';
  if (paused) setPaused(false);
  battle = null;
  popups = [];
  particles = [];
  units = [];
  shake = 0;
  makeMountains();
  syncUnits();
  $('overlay').hidden = true;
  $('picker').hidden = true;
  $('boss').textContent = lvl.castle;
  $('level-no').textContent = levelNo;
  $('level-stars').textContent = progress.stars[levelNo] ? starText(progress.stars[levelNo]) : '';
  $('hint').textContent = lvl.P.spikes ? 'Veldu hlið og forðastu broddana!' : 'Dragðu hópinn til hliðar til að velja hlið';
  updateCount();
}

function setLevel(n) {
  levelNo = Math.max(1, Math.min(MAX_LEVEL, n));
  store.set('level-n', levelNo);
  newRun();
}

const updateCount = () => { $('count').textContent = count; };
const groupRadius = () => Math.min(MAX_R, UNIT * Math.sqrt(Math.min(count, MAX_DRAWN)));
const groupX = () => { const r = groupRadius(); return Math.max(-1 + r + 0.04, Math.min(1 - r - 0.04, crowdX)); };

// Drawn runners follow the count: new ones pop in at the middle, lost ones vanish in a puff.
function syncUnits() {
  const want = Math.min(count, MAX_DRAWN);
  while (units.length < want) units.push({ ox: (Math.random() - 0.5) * 0.05, oz: (Math.random() - 0.5) * 0.05, born: t });
  while (units.length > want) {
    const u = units.pop();
    puff(groupX() + u.ox, PLAYER_D + u.oz, groupColors().body, 2);
  }
}

// Runners stand in a sunflower spiral, so any number of them packs into a round group.
const spiral = [];
for (let i = 0; i < MAX_DRAWN; i++) {
  const r = UNIT * Math.sqrt(i), a = i * 2.39996;
  spiral.push([Math.cos(a) * r, Math.sin(a) * r * 0.8]);
}
const squeeze = (n) => Math.min(1, MAX_R / (UNIT * Math.sqrt(Math.max(1, Math.min(n, MAX_DRAWN)))));

function puff(x, d, color, n = 3) {
  for (let k = 0; k < n && particles.length < 260; k++) {
    particles.push({ x, d, h: 0.08, vx: (Math.random() - 0.5) * 0.9, vd: (Math.random() - 0.5) * 0.6, vh: 0.6 + Math.random() * 0.8, life: 0.5 + Math.random() * 0.3, age: 0, color });
  }
}

// --- update ---

// How close the group gets before a fight: front to front with a red group; the castle is
// fought from further away so it stays on screen.
const fightGap = (it) => (it.kind === 'boss' ? 2.6 : groupRadius() + 0.12);
// Where a spike patch is across the road: fixed to one side, or sliding from side to side.
const spikeX = (it) => {
  const x0 = it.moving
    ? -it.w / 2 + Math.sin(t * 1.4 + it.phase) * (1 - it.w / 2)
    : it.side < 0 ? -1 : 1 - it.w;
  return [x0, x0 + it.w];
};

function step(dt) {
  t += dt;
  keySteer(dt);
  crowdX += (steer - crowdX) * Math.min(1, dt * 14);
  cam += (groupX() * 0.35 - cam) * Math.min(1, dt * 5);
  shake = Math.max(0, shake - dt * 3);

  if (state === 'running') {
    dist += lvl.P.speed * dt;
    for (const it of lvl.items) {
      if (it.done) continue;
      if (it.kind === 'gates') {
        if (dist < it.z) break;
        it.done = true;
        const g = groupX() < 0 ? it.left : it.right;
        const before = count;
        count = apply(g.op, count, g.v);
        it.chosen = g === it.left ? -1 : 1;
        popups.push({ text: `${g.op}${g.v}`, good: count >= before, age: 0 });
        if (count >= before) { sfx.good(); buzz(15); } else { sfx.bad(); buzz([30, 30, 30]); }
        syncUnits();
        updateCount();
      } else if (it.kind === 'spikes') {
        if (dist < it.z) break;
        if (dist > it.z + it.len) { it.done = true; continue; }
        const [x0, x1] = spikeX(it), r = groupRadius(), cx = groupX();
        const overlap = Math.max(0, Math.min(x1, cx + r) - Math.max(x0, cx - r)) / (2 * r);
        if (overlap > 0) {
          it.acc = (it.acc || 0) + overlap * count * 1.4 * dt;
          const k = Math.min(count - 1, Math.floor(it.acc));
          if (k > 0) {
            it.acc -= k;
            count -= k;
            sfx.hit();
            buzz(10);
            syncUnits();
            updateCount();
          }
        }
        break;
      } else {
        if (dist < it.z - fightGap(it)) break;
        state = 'battle';
        battle = { it, acc: 0 };
        dist = it.z - fightGap(it);
        break;
      }
    }
  } else if (state === 'battle') {
    const it = battle.it;
    battle.acc += Math.max(10, (count + it.count) / 1.4) * dt;   // runners lost per second, on each side
    const k = Math.min(Math.floor(battle.acc), count, it.count);
    battle.acc -= k;
    if (k) {
      count -= k;
      it.count -= k;
      shake = Math.min(1, shake + 0.15);
      sfx.hit();
      const cx = groupX(), front = PLAYER_D + groupRadius();
      for (let j = 0; j < Math.min(k, 4); j++) {
        const x = cx + (Math.random() - 0.5) * groupRadius() * 1.6;
        puff(x, front + 0.2, groupColors().body, 1);
        puff(x, front + 0.45, '#e5484d', 1);
      }
      syncUnits();
      updateCount();
    }
    if (count === 0) return lose();
    if (it.count === 0) {
      it.done = true;
      battle = null;
      if (it.kind === 'boss') return win();
      state = 'running';
    }
  } else if (state === 'won') {
    dist += lvl.P.speed * 0.45 * dt;   // the group runs into the castle
  }

  // regroup towards the spiral
  const k = squeeze(units.length);
  units.forEach((u, i) => {
    u.ox += (spiral[i][0] * k - u.ox) * Math.min(1, dt * 7);
    u.oz += (spiral[i][1] * k - u.oz) * Math.min(1, dt * 7);
  });
  for (const p of particles) {
    p.age += dt;
    p.x += p.vx * dt;
    p.d += p.vd * dt;
    p.h += p.vh * dt;
    p.vh -= 2.4 * dt;
  }
  particles = particles.filter((p) => p.age < p.life);
  popups.forEach((p) => { p.age += dt; });
  popups = popups.filter((p) => p.age < 1);
}

function win() {
  state = 'won';
  wonAt = t;
  const left = count;
  const stars = starsFor(lvl, left);
  const oldBest = progress.best[levelNo] || 0;
  const oldTotal = totalStars();
  progress.stars[levelNo] = Math.max(progress.stars[levelNo] || 0, stars);
  progress.best[levelNo] = Math.max(oldBest, left);
  progress.unlocked = Math.max(progress.unlocked, Math.min(MAX_LEVEL, levelNo + 1));
  saveProgress();
  sfx.win();
  buzz([40, 30, 40]);
  confetti();
  const id = runId;
  setTimeout(() => {
    if (id !== runId) return;
    showResult('🎉', `Borð ${levelNo} klárað!`, `${left} eftir í hópnum.${left > oldBest && oldBest ? ' Nýtt met á borðinu! 🏆' : ''}`);
    $('stars').replaceChildren(...[1, 2, 3].map((s) => {
      const el = document.createElement('span');
      el.textContent = '⭐';
      if (s > stars) el.className = 'off';
      return el;
    }));
    $('stars').hidden = false;
    $('next').hidden = levelNo >= MAX_LEVEL;
    $('again').textContent = 'Aftur';
    // the scoreboard ranks total stars, so only a new star changes the place
    if (totalStars() > oldTotal) lbAfterWin('crowd', 'stars', totalStars());
  }, 1300);
}

function lose() {
  state = 'lost';
  sfx.lose();
  buzz([80, 40, 120]);
  shake = 1;
  const castle = battle && battle.it.kind === 'boss';
  const text = castle
    ? `Kastalinn hafði ${battle.it.count} eftir. Veldu stærri hliðin og reyndu aftur!`
    : 'Hópurinn kláraðist. Reyndu aftur!';
  const id = runId;
  setTimeout(() => {
    if (id !== runId) return;
    showResult('💥', 'Búmm!', text);
    $('stars').hidden = true;
    $('next').hidden = true;
    $('again').textContent = 'Reyna aftur';
  }, 900);
}

// --- drawing ---

let W = 0, H = 0, dpr = 1;
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

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const horizon = () => H * 0.24;
const vScale = () => (H * 0.8 - horizon()) * PLAYER_D;   // the road at the group's depth sits at 80% height
const hScale = () => W * 0.44 * PLAYER_D;                 // and is 88% of the width
const sx = (x, d) => W / 2 + ((x - cam) * hScale()) / d;
const gy = (d, h = 0) => horizon() + ((1 - h) * vScale()) / d;

function quad(xa, xb, da, db, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(sx(xa, da), gy(da));
  ctx.lineTo(sx(xb, da), gy(da));
  ctx.lineTo(sx(xb, db), gy(db));
  ctx.lineTo(sx(xa, db), gy(db));
  ctx.fill();
}

// Mountains on the horizon, made once per level from its seed.
let mountains = null;
function makeMountains() {
  const rand = seeded(levelNo * 31 + 5);
  const layer = (n, hMin, hMax) => [...Array(n + 1)].map((_, i) => [i / n, hMin + rand() * (hMax - hMin)]);
  mountains = { far: layer(9, 0.05, 0.14), near: layer(6, 0.03, 0.09) };
}

function drawSky() {
  const hz = horizon();
  const sky = ctx.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, '#9fcdf0');
  sky.addColorStop(1, '#e6f1f9');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, hz + 1);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(W * 0.78 - cam * 6, hz * 0.38, Math.max(10, W * 0.05), 0, Math.PI * 2);
  ctx.fill();
  const ridge = (pts, color, shift, snow) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-20, hz + 1);
    pts.forEach(([fx, fh]) => ctx.lineTo(fx * (W + 40) - 20 - shift, hz - fh * H));
    ctx.lineTo(W + 20, hz + 1);
    ctx.fill();
    if (!snow) return;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    pts.forEach(([fx, fh], i) => {
      if (fh < 0.1 || i === 0 || i === pts.length - 1) return;
      const px = fx * (W + 40) - 20 - shift, py = hz - fh * H, s = fh * H * 0.28;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - s, py + s * 0.8);
      ctx.lineTo(px + s, py + s * 0.8);
      ctx.fill();
    });
  };
  ridge(mountains.far, '#a9bed2', cam * 10, true);
  ridge(mountains.near, '#8aa6bf', cam * 20, false);
}

function drawGround() {
  const near = 0.8, band = 2;
  ctx.fillStyle = '#9fcf6c';
  ctx.fillRect(0, horizon(), W, H - horizon());
  for (let k = Math.floor((dist - PLAYER_D) / band); ; k++) {
    const d1raw = k * band - dist + PLAYER_D, d2 = d1raw + band;
    if (d1raw > FAR) break;
    if (d2 <= near) continue;
    const d1 = Math.max(near, d1raw);
    if (k % 2) quad(-8, -1, d1, d2, '#95c763');
    if (k % 2) quad(1, 8, d1, d2, '#95c763');
    quad(-1, 1, d1, d2, k % 2 ? '#d5dbe2' : '#dfe4ea');
    // kerbs along the edges
    const kerb = k % 2 ? '#e5484d' : '#ffffff';
    quad(-1.06, -1, d1, d2, kerb);
    quad(1, 1.06, d1, d2, kerb);
    // dashed middle line, so the two sides of a gate are clear
    if (k % 2 === 0) quad(-0.012, 0.012, d1, Math.min(d2, d1 + 1.2), 'rgba(255, 255, 255, 0.9)');
  }
}

// Trees and rocks beside the road, fixed to the road so they stream past.
function drawScenery() {
  const step = 5;
  const first = Math.floor((dist - PLAYER_D) / step);
  for (let k = first + Math.ceil(FAR / step); k >= first; k--) {
    const d = k * step - dist + PLAYER_D;
    if (d < 0.9 || d > FAR) continue;
    const r = seeded(k * 97 + levelNo)();
    const side = k % 2 ? -1 : 1;
    const x = side * (1.35 + r * 0.9);
    const px = sx(x, d), base = gy(d), s = vScale() / d;
    if (r < 0.62) {   // a spruce
      ctx.fillStyle = '#6b4f35';
      ctx.fillRect(px - s * 0.02, base - s * 0.12, s * 0.04, s * 0.12);
      ctx.fillStyle = r < 0.3 ? '#2e7d4f' : '#3a8f5c';
      for (let j = 0; j < 3; j++) {
        const w = s * (0.16 - j * 0.035), y = base - s * (0.1 + j * 0.12);
        ctx.beginPath();
        ctx.moveTo(px - w, y);
        ctx.lineTo(px + w, y);
        ctx.lineTo(px, y - s * 0.2);
        ctx.fill();
      }
    } else {           // a rock
      ctx.fillStyle = '#8d99a6';
      ctx.beginPath();
      ctx.ellipse(px, base - s * 0.04, s * 0.11, s * 0.07, 0, Math.PI, 0);
      ctx.fill();
    }
  }
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

function drawGates(it, d) {
  const top = gy(d, 0.78), bottom = gy(d), post = Math.max(2, (0.035 * hScale()) / d);
  for (const [side, g] of [[-1, it.left], [1, it.right]]) {
    const x0 = side < 0 ? -1 : 0, x1 = side < 0 ? 0 : 1;
    const good = isGood(g);
    const L = sx(x0, d), R = sx(x1, d);
    const fill = ctx.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, good ? 'rgba(63, 146, 222, 0.75)' : 'rgba(240, 92, 97, 0.75)');
    fill.addColorStop(1, good ? 'rgba(63, 146, 222, 0.25)' : 'rgba(240, 92, 97, 0.25)');
    ctx.fillStyle = fill;
    ctx.fillRect(L, top, R - L, bottom - top);
    const size = Math.max(10, (0.27 * vScale()) / d);
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, size * 0.12);
    ctx.strokeStyle = good ? '#1d5b93' : '#a8262b';
    ctx.strokeText(`${g.op}${g.v}`, (L + R) / 2, top + (bottom - top) * 0.42);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${g.op}${g.v}`, (L + R) / 2, top + (bottom - top) * 0.42);
  }
  // posts and the bar across the top
  ctx.fillStyle = '#f4f7fa';
  for (const x of [-1, 0, 1]) ctx.fillRect(sx(x, d) - post / 2, top, post, bottom - top);
  ctx.fillRect(sx(-1, d) - post / 2, top - post, sx(1, d) - sx(-1, d) + post, post * 1.4);
}

function drawSpikes(it, d1) {
  const [x0, x1] = spikeX(it);
  const d2 = d1 + it.len;
  quad(x0, x1, Math.max(0.8, d1), d2, '#5b6573');
  // rows of little spikes
  for (let z = 0.25; z < it.len; z += 0.5) {
    const d = d1 + z;
    if (d < 0.9) continue;
    const s = (0.05 * vScale()) / d;
    for (let x = x0 + 0.06; x < x1 - 0.03; x += 0.12) {
      const px = sx(x, d), py = gy(d);
      ctx.fillStyle = '#d7dde4';
      ctx.beginPath();
      ctx.moveTo(px - s * 0.5, py);
      ctx.lineTo(px, py - s * 1.3);
      ctx.lineTo(px + s * 0.5, py);
      ctx.fill();
    }
  }
}

// One runner, seen from behind. `phase` swings the legs; `still` is for the red groups
// waiting on the road. `kind` is a key of CREATURES: people wear `body` and `dark`,
// animals are their own colour all over.
function runner(px, py, s, phase, body, dark, still, alpha = 1, kind = 'person') {
  const c = CREATURES[kind];
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.13)';
  ctx.beginPath();
  ctx.ellipse(px, py, s * 0.7, s * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  const swing = still ? 0.15 : Math.sin(phase) * 0.6;
  ctx.strokeStyle = c.legs || dark;
  ctx.lineWidth = Math.max(1.5, s * 0.28);
  ctx.lineCap = 'round';
  const hipY = py - s * 0.85;
  const blob = (x, y, rx, ry, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(px + x * s, py + y * s, rx * s, ry * s, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  if (kind === 'penguin') {   // a round body on two waddling feet instead of legs
    for (const sgn of [1, -1]) blob(sgn * 0.17 + Math.sin(swing * sgn) * 0.12, -0.06, 0.15, 0.07, c.legs);
    blob(0, -0.6, 0.4, 0.5, c.fur);
  } else {
    for (const sgn of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(px + sgn * s * 0.15, hipY);
      ctx.lineTo(px + sgn * s * 0.15 + Math.sin(swing * sgn) * s * 0.55, py - s * 0.05);
      ctx.stroke();
    }
  }
  const tri = (pts, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, px + x * s, py + y * s));
    ctx.fill();
  };
  // arms and flippers hang beside the shirt
  if (kind === 'gorilla') for (const sgn of [1, -1]) blob(sgn * 0.45, -1.15, 0.17, 0.5, c.fur);
  if (kind === 'penguin') for (const sgn of [1, -1]) blob(sgn * 0.42, -1.3, 0.1, 0.32, c.fur);
  // the body: a shirt on people, fur (or scales) on animals, broader on the big ones
  const half = kind === 'gorilla' ? 0.5 : kind === 'bear' ? 0.46 : 0.4;
  ctx.fillStyle = c.back || c.fur || body;
  ctx.beginPath();
  ctx.roundRect(px - s * half, py - s * 1.85, s * half * 2, s * 1.1, s * 0.38);
  ctx.fill();
  // head, plus whatever sticks out of it
  if (kind === 'bear') for (const sgn of [1, -1]) blob(sgn * 0.27, -2.42, 0.13, 0.13, c.fur);
  if (kind === 'shark') tri([[-0.13, -2.4], [0.06, -2.95], [0.17, -2.38]], c.fur);
  if (kind === 'gorilla') blob(0, -2.36, 0.22, 0.2, c.fur);
  blob(0, -2.15, kind === 'trex' ? 0.42 : 0.38, kind === 'shark' ? 0.44 : 0.38, c.fur || '#ffe0c2');
  if (kind === 'dog') for (const sgn of [1, -1]) blob(sgn * 0.36, -2.06, 0.12, 0.26, c.dark);
  if (kind === 'trex') for (const x of [-0.18, 0, 0.18]) tri([[x - 0.08, -2.5], [x, -2.72], [x + 0.08, -2.5]], c.dark);
  // tails reach back towards the camera, so they go on top
  const wag = Math.sin(phase * 2);
  if (kind === 'dog') {
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = Math.max(1.5, s * 0.2);
    ctx.beginPath();
    ctx.moveTo(px, py - s * 0.95);
    ctx.lineTo(px + wag * s * 0.35, py - s * 1.45);
    ctx.stroke();
  }
  if (kind === 'shark') tri([[0, -0.95], [-0.4 + wag * 0.08, -0.25], [0, -0.5], [0.4 + wag * 0.08, -0.25]], c.fur);
  if (kind === 'trex') tri([[-0.24, -1.0], [0.24, -1.0], [wag * 0.25, 0.1]], c.dark);
  ctx.globalAlpha = 1;
}

// The group is drawn flat at its own depth rather than each runner in perspective, so it
// reads as a round blob instead of a wedge that widens towards the camera.
function drawCrowd() {
  const cx = groupX();
  const fade = state === 'won' ? Math.max(0, 1 - (t - wonAt) / 1.1) : 1;
  const unit = hScale() / PLAYER_D, y0 = gy(PLAYER_D);
  const list = units.map((u, i) => [u, i]).sort((a, b) => b[0].oz - a[0].oz);
  for (const [u, i] of list) {
    const grow = Math.min(1, (t - u.born) / 0.18);   // new runners pop in
    const depth = 1 - u.oz * 0.35;                    // the back rows a touch smaller
    const s = ((0.042 * vScale()) / PLAYER_D) * depth * (0.6 + 0.4 * grow);
    const bob = state === 'running' ? Math.abs(Math.sin(t * 12 + i * 1.7)) * s * 0.25 : 0;
    runner(sx(cx, PLAYER_D) + u.ox * unit, y0 - u.oz * unit - bob, s, t * 14 + i * 1.3, outfit.body, outfit.dark, state !== 'running' && state !== 'won', fade, creature);
  }
  if (count > 0 && state !== 'won' && state !== 'battle') {
    pill(String(count), sx(cx, PLAYER_D), gy(PLAYER_D + groupRadius(), 0.2) - 34, 22, '#fff', groupColors().dark);
  }
}

function drawEnemy(it, d) {
  const n = Math.min(it.count, MAX_DRAWN), k = squeeze(n), back = d + Math.min(MAX_R, UNIT * Math.sqrt(n));
  const pts = spiral.slice(0, n).map(([dx, dz], i) => [dx * k, back + dz * k, i]).sort((a, b) => b[1] - a[1]);
  for (const [x, dd, i] of pts) {
    if (dd <= 0.6) continue;
    const s = (0.042 * vScale()) / dd;
    runner(sx(x, dd), gy(dd), s, i, '#e5484d', '#a8262b', state !== 'battle');
  }
  if (!battle || battle.it !== it) {
    pill(String(it.count), sx(0, back), gy(back, 0.5) - 14, Math.max(12, Math.min(26, (0.2 * vScale()) / d)), '#fff', '#a8262b');
  }
}

// During a fight: one label with both numbers, above where the groups meet.
function drawFightLabel() {
  if (!battle || battle.it.kind !== 'enemy') return;
  const d = PLAYER_D + groupRadius() + 0.1;
  const text = `${count} ⚔ ${battle.it.count}`;
  pill(text, sx(groupX(), d), gy(d, 0.2) - 44, 22, '#fff', '#1b2a4a');
}

function drawCastle(it, d) {
  const top = gy(d, 0.85), bottom = gy(d);
  const left = sx(-0.7, d), right = sx(0.7, d), w = right - left, h = bottom - top;
  ctx.fillStyle = '#b8bfc8';
  ctx.fillRect(left, top, w, h);
  ctx.fillStyle = '#a3abb5';   // stones
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      if ((row + col) % 2) continue;
      ctx.fillRect(left + (col / 6) * w + (row % 2 ? w / 12 : 0), top + (row / 6) * h, w / 7, h / 7);
    }
  }
  const tooth = w / 7;
  ctx.fillStyle = '#b8bfc8';
  for (let k = 0; k < 7; k += 2) ctx.fillRect(left + k * tooth, top - tooth * 0.8, tooth, tooth * 0.8);
  // flag
  const poleX = left + w / 2, poleTop = top - tooth * 2.6;
  ctx.fillStyle = '#5b6573';
  ctx.fillRect(poleX - 1.5, poleTop, 3, tooth * 1.8);
  ctx.fillStyle = '#e5484d';
  ctx.beginPath();
  ctx.moveTo(poleX + 1.5, poleTop);
  for (let k = 0; k <= 8; k++) ctx.lineTo(poleX + 1.5 + (k / 8) * tooth * 1.4, poleTop + Math.sin(t * 6 + k) * 2.5);
  for (let k = 8; k >= 0; k--) ctx.lineTo(poleX + 1.5 + (k / 8) * tooth * 1.4, poleTop + tooth * 0.8 + Math.sin(t * 6 + k) * 2.5);
  ctx.fill();
  // door
  ctx.fillStyle = '#4a3a2c';
  const door = w * 0.24;
  ctx.beginPath();
  ctx.roundRect(left + w / 2 - door / 2, bottom - h * 0.48, door, h * 0.48, [door / 2, door / 2, 0, 0]);
  ctx.fill();
  if (it.count > 0) {
    const size = Math.min(34, Math.max(12, (0.24 * vScale()) / d));
    pill(String(it.count), left + w / 2, Math.max(size, poleTop - size * 1.05), size, '#fff', '#a8262b');   // above the flag
  }
}

function drawParticles() {
  for (const p of particles) {
    if (p.d <= 0.6) continue;
    const s = ((0.03 * vScale()) / p.d) * (1 - p.age / p.life);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = 1 - p.age / p.life;
    ctx.beginPath();
    ctx.arc(sx(p.x, p.d), gy(p.d, p.h), Math.max(1, s), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawProgress() {
  const x = 14, y = 12, w = W - 28 - 22, h = 7;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = '#138a84';
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(h, w * Math.min(1, dist / (lvl.end - 2.6))), h, h / 2);
  ctx.fill();
  ctx.font = `16px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('🏰', x + w + 4, y + h / 2 + 1);
}

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 6, (Math.random() - 0.5) * shake * 6);
  drawSky();
  drawGround();
  drawScenery();

  // everything on the road, far to near
  const ahead = lvl.items.filter((it) => !(it.kind === 'gates' && it.done) && !(it.kind === 'enemy' && it.count === 0)
    && !(it.kind === 'spikes' && it.z + it.len < dist - PLAYER_D));
  for (const it of [...ahead].reverse()) {
    const d = it.z - dist + PLAYER_D;
    if (d > FAR) continue;
    if (it.kind === 'spikes') { if (d + it.len > 0.8) drawSpikes(it, d); continue; }
    if (d < 0.6) continue;
    if (it.kind === 'gates') drawGates(it, d);
    else if (it.kind === 'enemy') drawEnemy(it, d);
    else drawCastle(it, d);
  }
  drawCrowd();
  drawParticles();
  drawFightLabel();

  // "+10" floating up after a gate
  for (const p of popups) {
    ctx.globalAlpha = 1 - p.age;
    pill(p.text, sx(groupX(), PLAYER_D), gy(PLAYER_D + groupRadius(), 0.2) - 70 - p.age * 40, 20, p.good ? '#2f7fc4' : '#e5484d', '#fff');
    ctx.globalAlpha = 1;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawProgress();
  if (state === 'ready') {
    ctx.fillStyle = 'rgba(27, 42, 74, 0.38)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.round(Math.min(46, W * 0.11))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Borð ${levelNo}`, W / 2, H * 0.36);
    pill('Ýttu til að byrja', W / 2, H * 0.48, 22, '#ff8a1f', '#1b2a4a');
  }
}

// --- pause: the road is covered while paused, so it can't be used to study the gates ---

let paused = false;
const canPause = () => state === 'running' || state === 'battle';

function setPaused(on) {
  if (on && !canPause()) return;
  paused = on;
  held.ArrowLeft = held.ArrowRight = false;
  drag = null;
  $('pause').textContent = paused ? '▶️' : '⏸️';
  $('pause').setAttribute('aria-label', paused ? 'Halda áfram' : 'Hlé');
}

function drawPaused() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#1b2a4a';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = `800 ${Math.round(Math.min(46, W * 0.11))}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Hlé', W / 2, H * 0.36);
  pill('Ýttu til að halda áfram', W / 2, H * 0.48, 22, '#ff8a1f', '#1b2a4a');
}

document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0);
  last = ts;
  const off = !canPause() && !paused;
  if ($('pause').disabled !== off) $('pause').disabled = off;
  if (!document.hidden && W) {
    if (paused) drawPaused();
    else {
      step(dt);
      draw();
    }
  }
  requestAnimationFrame(frame);
}

// --- input: drag sideways to steer, tap a side to move there, arrow keys on a computer ---

const STEER_MAX = 0.85;
const clampSteer = (v) => Math.max(-STEER_MAX, Math.min(STEER_MAX, v));
let drag = null;

function begin() {
  audioStart();
  if (state === 'ready') {
    state = 'running';
    sfx.start();
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (paused) { setPaused(false); return; }
  if (state === 'won' || state === 'lost') return;
  begin();
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

// Arrow keys: the group slides for as long as a key is held (key repeat is ignored).
const KEY_SPEED = 2.6;
const KEY_NUDGE = 0.12;
const held = { ArrowLeft: false, ArrowRight: false };
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input')) return;
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape' || (e.key === ' ' && paused)) {
    e.preventDefault();
    setPaused(!paused);
    return;
  }
  if (paused) return;
  if (e.key in held) {
    e.preventDefault();
    if (state === 'won' || state === 'lost') return;
    begin();
    if (!e.repeat && !held[e.key]) steer = clampSteer(steer + (e.key === 'ArrowLeft' ? -KEY_NUDGE : KEY_NUDGE));
    held[e.key] = true;
  } else if (e.key === ' ' && state === 'ready') {
    e.preventDefault();
    begin();
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key in held) held[e.key] = false;
});
window.addEventListener('blur', () => { held.ArrowLeft = held.ArrowRight = false; });

function keySteer(dt) {
  const dir = (held.ArrowRight ? 1 : 0) - (held.ArrowLeft ? 1 : 0);
  if (dir) steer = clampSteer(steer + dir * KEY_SPEED * dt);
}

// --- buttons and the level picker ---

function drawSound() {
  $('sound').textContent = soundOn ? '🔊' : '🔇';
  $('sound').setAttribute('aria-label', soundOn ? 'Slökkva á hljóði' : 'Kveikja á hljóði');
}
$('sound').addEventListener('click', () => {
  soundOn = !soundOn;
  store.set('sound', soundOn ? '1' : '0');
  drawSound();
  if (soundOn) { audioStart(); sfx.good(); }
});

function drawOutfits() {
  $('outfits').replaceChildren(...OUTFITS.map((o, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.setProperty('--c', o.body);
    b.style.setProperty('--c-dark', o.dark);
    b.setAttribute('aria-label', o.name);
    b.setAttribute('aria-pressed', String(o === outfit));
    b.addEventListener('click', () => {
      outfit = o;
      store.set('outfit', String(i));
      drawOutfits();
    });
    return b;
  }));
}

function drawCreatures() {
  $('creatures').replaceChildren(...Object.entries(CREATURES).map(([key, c]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c.emoji;
    b.setAttribute('aria-label', c.name);
    b.setAttribute('aria-pressed', String(key === creature));
    b.addEventListener('click', () => {
      creature = key;
      store.set('creature', key);
      drawCreatures();
    });
    return b;
  }));
  // only people wear clothes
  $('outfit-label').hidden = $('outfits').hidden = !!CREATURES[creature].fur;
}

function openPicker() {
  $('picker-total').textContent = `⭐ ${totalStars()} af ${MAX_LEVEL * 3}`;
  drawCreatures();
  drawOutfits();
  $('level-grid').replaceChildren(...[...Array(MAX_LEVEL)].map((_, i) => {
    const n = i + 1, b = document.createElement('button');
    b.type = 'button';
    if (n > progress.unlocked) {
      b.disabled = true;
      b.textContent = '🔒';
      b.setAttribute('aria-label', `Borð ${n}, læst`);
    } else {
      const s = progress.stars[n] || 0;
      b.innerHTML = `${n}<small>${s ? starText(s) : ''}</small>`;
      b.setAttribute('aria-label', `Borð ${n}${s ? `, ${s} stjörnur` : ''}`);
      b.addEventListener('click', () => setLevel(n));
    }
    if (n === levelNo) b.classList.add('current');
    return b;
  }));
  $('picker').hidden = false;
  $('level-grid').querySelector('.current')?.scrollIntoView({ block: 'center' });
}

$('level-btn').addEventListener('click', () => { setPaused(true); openPicker(); });
$('pause').addEventListener('click', () => setPaused(!paused));
$('new').addEventListener('click', newRun);
$('again').addEventListener('click', newRun);
$('next').addEventListener('click', () => setLevel(levelNo + 1));

// --- start ---

resize();
drawSound();
newRun();
requestAnimationFrame(frame);
registerServiceWorker('../sw.js');
