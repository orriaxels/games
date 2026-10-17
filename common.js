'use strict';
// Shared helpers for the start page and both games.

const LEVEL_NAMES = { easy: 'Létt', medium: 'Miðlungs', hard: 'Erfitt' };
const HISTORY_MAX = 50;

const $ = (id) => document.getElementById(id);

// --- storage: this phone's browser storage, may be unavailable in private mode ---

function makeStore(prefix) {
  const get = (key, fallback) => {
    try { return localStorage.getItem(prefix + key) ?? fallback; } catch { return fallback; }
  };
  const set = (key, value) => {
    try { localStorage.setItem(prefix + key, value); } catch { /* ignore */ }
  };
  const getJSON = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(prefix + key)) ?? fallback; } catch { return fallback; }
  };
  const setJSON = (key, value) => set(key, JSON.stringify(value));
  const remove = (key) => {
    try { localStorage.removeItem(prefix + key); } catch { /* ignore */ }
  };
  return { get, set, getJSON, setJSON, remove };
}

// Best time per level, played/won counts and a capped history list.
function makeRecords(store) {
  const best = (lv) => Number(store.get('best-' + lv, 0)) || 0;
  const stats = () => store.getJSON('stats', {});
  const history = () => {
    const h = store.getJSON('history', []);
    return Array.isArray(h) ? h : [];
  };
  return {
    best,
    stats,
    history,
    // Returns true when this is a new record.
    add(entry) {
      entry = { ...entry, time: Math.max(1, entry.time) };   // 0 would read as "no record"
      const s = stats();
      const lv = s[entry.level] || (s[entry.level] = { played: 0, won: 0 });
      lv.played++;
      if (entry.won) lv.won++;
      store.setJSON('stats', s);
      store.setJSON('history', [{ at: Date.now(), ...entry }, ...history()].slice(0, HISTORY_MAX));
      const old = best(entry.level);
      if (entry.won && (!old || entry.time < old)) {
        store.set('best-' + entry.level, entry.time);
        return true;
      }
      return false;
    },
  };
}

// --- text ---

// Icelandic: numbers ending in 1 (but not 11) take the singular.
function seconds(n) {
  return n + (n % 10 === 1 && n % 100 !== 11 ? ' sekúnda' : ' sekúndur');
}

// 75 -> "1:15"
function clock(n) {
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
}

// Browsers don't all ship Icelandic date names, so format by hand: "17. okt. 13:52"
const MONTHS = ['jan.', 'feb.', 'mars', 'apr.', 'maí', 'júní', 'júlí', 'ágúst', 'sept.', 'okt.', 'nóv.', 'des.'];
function formatWhen(ms) {
  const d = new Date(ms), pad = (n) => String(n).padStart(2, '0');
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

// --- popups (markup lives in each game's index.html) ---

function showResult(emoji, title, text) {
  $('result-emoji').textContent = emoji;
  $('result-title').textContent = title;
  $('result-text').textContent = text;
  $('result-board')?.replaceChildren();   // filled by lbAfterWin() after a win
  $('overlay').hidden = false;
}

// rows: arrays of cell texts; games: [{ text, at }]
function showRecords(rows, games) {
  const body = $('records-body');
  body.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const text of row) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }

  const list = $('history');
  list.replaceChildren();
  if (!games.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Engir leikir enn. Spilaðu fyrst!';
    list.appendChild(li);
  }
  for (const g of games.slice(0, 20)) {
    const li = document.createElement('li');
    const what = document.createElement('span');
    what.textContent = g.text;
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = formatWhen(g.at);
    li.append(what, when);
    list.appendChild(li);
  }
  $('records').hidden = false;
}

// Close popups by tapping the dark background or a [data-close] button.
document.addEventListener('click', (e) => {
  const overlay = e.target.closest('.overlay');
  if (!overlay) return;
  if (e.target === overlay || e.target.closest('[data-close]')) overlay.hidden = true;
});

// --- app setup ---

// Ask the browser not to clear our storage when the phone runs low on space.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// Registers offline support and keeps the app up to date: checks for a new version
// whenever the app comes back on screen, and reloads once a new version takes over.
// (Sudoku and Reiknigáta save on 'pagehide', so a reload doesn't lose a puzzle.)
function registerServiceWorker(path) {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;   // first install: nothing old to replace
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(path).then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}
