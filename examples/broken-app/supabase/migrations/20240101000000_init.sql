-- create table not_a_table (id int);  <- a comment, must be ignored

create table public.profiles (
  id uuid primary key references auth.users,
  display_name text
);
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles
  for select using (auth.uid() = id);

-- Mistake: RLS never enabled, so the anon key can read every order.
create table public.orders (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  total_cents int not null
);

-- Mistake: RLS is on, but the insert policy lets anyone write any row.
create table public.feedback (
  id bigint generated always as identity primary key,
  body text
);
alter table public.feedback enable row level security;
create policy "anyone can post" on public.feedback
  for insert to anon, authenticated with check (true);

-- Server-only table: RLS on, no policy. Reported as a note, not an error.
create table public.audit_log (
  id bigint generated always as identity primary key,
  event text
);
alter table public.audit_log enable row level security;
