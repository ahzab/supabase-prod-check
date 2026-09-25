create table public.profiles (
  id uuid primary key references auth.users,
  display_name text
);
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles
  for select using (auth.uid() = id);

create table public.orders (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  total_cents int not null,
  paid boolean not null default false
);
alter table public.orders enable row level security;
create policy "own orders" on public.orders
  for select to authenticated using (auth.uid() = user_id);

create table public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  body text
);
alter table public.feedback enable row level security;
create policy "signed-in users post as themselves" on public.feedback
  for insert to authenticated with check (auth.uid() = user_id);

-- Processed Stripe event ids, so a retried delivery is a no-op.
create table public.stripe_events (
  id text primary key,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
create policy "service role only" on public.stripe_events
  for select to service_role using (true);
