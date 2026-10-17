'use strict';
// Shared leaderboard for all the games, stored in Supabase (see leaderboard-config.js
// and leaderboard.sql). Everything here does nothing until the config has a url and key.
// Needs ../common.js.

const GAME_NAMES = { minesweeper: 'Minesweeper', sudoku: 'Sudoku', reiknigata: 'Reiknigáta' };
const NAME_MAX = 20;
const lbStore = makeStore('lb-');

const lbOn = () => typeof LEADERBOARD === 'object' && !!LEADERBOARD.url && !!LEADERBOARD.key;
const playerName = () => lbStore.get('name', '').trim();
const setPlayerName = (name) => lbStore.set('name', name.trim().slice(0, NAME_MAX));

// Minesweeper times read as seconds, the puzzles as minutes:seconds.
const formatTime = (game, s) => (game === 'minesweeper' ? `${s} sek` : clock(s));

function lbHeaders(extra) {
  const h = { apikey: LEADERBOARD.key, ...extra };
  // Older "anon" keys are JWTs and also go in Authorization; new "sb_publishable_" keys don't.
  if (!LEADERBOARD.key.startsWith('sb_')) h.Authorization = 'Bearer ' + LEADERBOARD.key;
  return h;
}

// Wins are queued on the phone and sent when there's a connection.
let flushing = null;
function lbFlush() {
  if (!lbOn()) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    const sending = lbStore.getJSON('queue', []);
    if (!sending.length) return;
    try {
      const res = await fetch(LEADERBOARD.url.replace(/\/$/, '') + '/rest/v1/scores', {
        method: 'POST',
        headers: lbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify(sending),
      });
      // Sent, or rejected for good (bad data): either way don't send these again.
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        lbStore.setJSON('queue', lbStore.getJSON('queue', []).slice(sending.length));
      }
    } catch { /* offline: try again later */ }
  })().finally(() => { flushing = null; });
  return flushing;
}
window.addEventListener('online', () => lbFlush());

function lbSubmit(game, level, seconds) {
  if (!lbOn() || !playerName()) return Promise.resolve();
  const queue = lbStore.getJSON('queue', []);
  queue.push({ player: playerName(), game, level, seconds: Math.max(1, seconds) });
  lbStore.setJSON('queue', queue.slice(-50));
  return lbFlush();
}

// Each player's best time on one game and level, fastest first.
async function lbBoard(game, level) {
  const q = `select=player,seconds,created_at&game=eq.${game}&level=eq.${level}&order=seconds.asc,created_at.asc&limit=1000`;
  const res = await fetch(LEADERBOARD.url.replace(/\/$/, '') + '/rest/v1/scores?' + q, { headers: lbHeaders() });
  if (!res.ok) throw new Error('leaderboard ' + res.status);
  const best = new Map();
  for (const row of await res.json()) {
    const key = row.player.trim().toLowerCase();
    if (!best.has(key)) best.set(key, row);
  }
  return [...best.values()];
}

function rankOf(board, name) {
  const i = board.findIndex((r) => r.player.trim().toLowerCase() === name.toLowerCase());
  return i < 0 ? null : i + 1;
}

// --- name form (used in the win popup and on the start page) ---

function nameForm(onSaved, label) {
  const form = document.createElement('form');
  form.className = 'name-form';
  const text = document.createElement('p');
  text.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = NAME_MAX;
  input.placeholder = 'Nafnið þitt';
  input.value = playerName();
  input.autocomplete = 'nickname';
  input.enterKeyHint = 'done';
  input.autocapitalize = 'words';   // names start with a capital
  input.spellcheck = false;
  input.setAttribute('autocorrect', 'off');
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'again';
  save.textContent = 'Vista';
  form.append(text, input, save);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    setPlayerName(name);
    onSaved(name);
  });
  return form;
}

// --- after a win: send the time and show the place on the leaderboard ---

function lbAfterWin(game, level, seconds) {
  const box = document.getElementById('result-board');
  if (!lbOn() || !box) return;
  const show = (text) => {
    box.replaceChildren();
    const p = document.createElement('p');
    p.className = 'board-line';
    p.textContent = text;
    box.appendChild(p);
  };
  const submitAndRank = async () => {
    show('🏅 Sendi á stigatöfluna…');
    await lbSubmit(game, level, seconds);
    if (lbStore.getJSON('queue', []).length) {
      show('🏅 Fer á stigatöfluna þegar netið kemur');
      return;
    }
    try {
      const board = await lbBoard(game, level);
      const rank = rankOf(board, playerName());
      show(rank ? `🏅 ${rank}. sæti af ${board.length} á stigatöflunni` : '🏅 Komið á stigatöfluna');
    } catch {
      show('🏅 Komið á stigatöfluna');
    }
  };
  if (playerName()) submitAndRank();
  else {
    box.replaceChildren(nameForm(submitAndRank, 'Skrifaðu nafnið þitt til að komast á stigatöfluna:'));
  }
}

lbFlush();
