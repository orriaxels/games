-- Shared leaderboard for Leikir. Paste into Supabase: SQL Editor -> New query -> Run.
--
-- Anyone with the public key may ADD a score and READ scores. Nobody can change or
-- delete scores through the app; do that yourself in Supabase's Table Editor.

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  player     text    not null check (char_length(btrim(player)) between 1 and 20),
  game       text    not null check (game in ('minesweeper', 'sudoku', 'reiknigata')),
  level      text    not null check (level in ('easy', 'medium', 'hard')),
  seconds    integer not null check (seconds between 1 and 86400)
);

create index if not exists scores_board on public.scores (game, level, seconds);

alter table public.scores enable row level security;

drop policy if exists "anyone can read scores" on public.scores;
create policy "anyone can read scores" on public.scores
  for select to anon using (true);

drop policy if exists "anyone can add a score" on public.scores;
create policy "anyone can add a score" on public.scores
  for insert to anon with check (true);

grant select, insert on public.scores to anon;
