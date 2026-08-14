-- =========================================================
-- Whot App - Supabase Schema
-- Run this in the Supabase SQL editor (or via `supabase db push`)
-- =========================================================

-- Requires: Supabase Auth already enabled (auth.users table exists)

-- ---------- PROFILES ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  is_searchable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_username on public.profiles using gin (username gin_trgm_ops);

-- ---------- WALLETS ----------
-- real_balance   : deposited / withdrawable real money (kobo/cents integer). INACTIVE for now.
-- bonus_balance  : non-withdrawable play money, used for mock/demo games against the computer.
create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  real_balance bigint not null default 0,
  bonus_balance bigint not null default 1000000, -- e.g. ₦10,000.00 stored in kobo
  currency text not null default 'NGN',
  updated_at timestamptz not null default now()
);

-- Welcome bonus given once per user; can be "recharged" (rebundle) when it hits zero,
-- subject to a cooldown, entirely separate from real money.
create table if not exists public.bonus_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null,
  reason text not null default 'welcome_bonus', -- welcome_bonus | rebundle
  created_at timestamptz not null default now()
);

-- ---------- TRANSACTIONS (ledger) ----------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null, -- deposit | withdrawal | stake_hold | stake_win | stake_refund | bonus_grant | bonus_spend
  amount bigint not null, -- positive = credit, negative = debit
  wallet text not null default 'real', -- real | bonus
  status text not null default 'completed', -- pending | completed | failed | disabled
  reference text,
  game_id uuid,
  created_at timestamptz not null default now()
);

-- ---------- WITHDRAWAL REQUESTS (feature disabled for now, table ready for later) ----------
create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null,
  bank_account jsonb,
  status text not null default 'disabled', -- disabled | pending | approved | rejected | paid
  created_at timestamptz not null default now()
);

-- ---------- GAME REQUESTS (challenge another user) ----------
create table if not exists public.game_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  proposed_stake bigint not null default 0,
  wallet text not null default 'bonus', -- real (disabled for now) | bonus
  status text not null default 'pending', -- pending | accepted | declined | cancelled | expired
  game_id uuid,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

-- ---------- GAMES ----------
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'pvp', -- pvp | vs_computer
  player_one uuid not null references public.profiles(id) on delete cascade,
  player_two uuid references public.profiles(id) on delete cascade, -- null when vs_computer
  stake bigint not null default 0,
  wallet text not null default 'bonus', -- real | bonus
  state jsonb not null, -- full whotEngine state
  status text not null default 'active', -- active | finished | abandoned
  winner_id uuid references public.profiles(id),
  request_id uuid references public.game_requests(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_games_players on public.games (player_one, player_two);

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.bonus_claims enable row level security;
alter table public.transactions enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.game_requests enable row level security;
alter table public.games enable row level security;

-- Profiles: readable by any authenticated user (for search), editable only by owner
create policy "profiles_select_all" on public.profiles for select using (auth.role() = 'authenticated');
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

-- Wallets: only visible/editable by the owner (server uses service role to credit/debit)
create policy "wallets_select_own" on public.wallets for select using (auth.uid() = user_id);

-- Transactions: only visible to owner
create policy "transactions_select_own" on public.transactions for select using (auth.uid() = user_id);

-- Withdrawal requests: only visible to owner
create policy "withdrawals_select_own" on public.withdrawal_requests for select using (auth.uid() = user_id);
create policy "withdrawals_insert_own" on public.withdrawal_requests for insert with check (auth.uid() = user_id);

-- Game requests: visible to sender or recipient
create policy "gamereq_select_involved" on public.game_requests for select
  using (auth.uid() = from_user or auth.uid() = to_user);
create policy "gamereq_insert_own" on public.game_requests for insert
  with check (auth.uid() = from_user);
create policy "gamereq_update_involved" on public.game_requests for update
  using (auth.uid() = from_user or auth.uid() = to_user);

-- Games: visible to the two players involved
create policy "games_select_involved" on public.games for select
  using (auth.uid() = player_one or auth.uid() = player_two);

-- =========================================================
-- HELPER FUNCTION: auto-create profile + wallet + welcome bonus on signup
-- =========================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', 'player_' || substr(new.id::text, 1, 8)),
          coalesce(new.raw_user_meta_data->>'display_name', 'New Player'));

  insert into public.wallets (user_id, bonus_balance) values (new.id, 1000000);

  insert into public.bonus_claims (user_id, amount, reason) values (new.id, 1000000, 'welcome_bonus');

  insert into public.transactions (user_id, type, amount, wallet, status, reference)
  values (new.id, 'bonus_grant', 1000000, 'bonus', 'completed', 'welcome_bonus');

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Enable trigram search for username lookup
create extension if not exists pg_trgm;
