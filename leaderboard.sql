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

-- Crowd Runner ranks total stars instead of time, with a board for each of its modes
-- (medium and hard). Safe to run again on a table made before this was added.
alter table public.scores alter column seconds drop not null;
alter table public.scores add column if not exists stars integer check (stars between 1 and 120);
alter table public.scores drop constraint if exists scores_game_check;
alter table public.scores add constraint scores_game_check
  check (game in ('minesweeper', 'sudoku', 'reiknigata', 'crowd'));
alter table public.scores drop constraint if exists scores_level_check;
alter table public.scores drop constraint if exists scores_score_check;
-- Crowd Runner first had one board, 'stars'; those scores were all played on medium.
update public.scores set level = 'medium' where game = 'crowd' and level = 'stars';
alter table public.scores add constraint scores_level_check
  check (level in ('easy', 'medium', 'hard'));
-- a Crowd Runner row has stars and no time (and no easy board); every other row a time
-- and no stars
alter table public.scores add constraint scores_score_check check (
  case when game = 'crowd' then level <> 'easy' and stars is not null and seconds is null
       else seconds is not null and stars is null end
);
create index if not exists scores_stars_board on public.scores (game, level, stars desc);

alter table public.scores enable row level security;

drop policy if exists "anyone can read scores" on public.scores;
create policy "anyone can read scores" on public.scores
  for select to anon using (true);

drop policy if exists "anyone can add a score" on public.scores;
create policy "anyone can add a score" on public.scores
  for insert to anon with check (true);

grant select, insert on public.scores to anon;

-- Row level security above already stops changes and deletes (there's no policy for
-- them); this takes away the permission too, as a second lock.
revoke update, delete, truncate on public.scores from anon, authenticated;
