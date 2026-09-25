-- Mistake: SECURITY DEFINER without a pinned search_path.
create or replace function public.grant_credits(uid uuid, amount int)
returns void
language plpgsql
security definer
as $$
begin
  update public.profiles set display_name = display_name where id = uid;
end;
$$;

-- Mistake: RLS was enabled in an earlier draft and switched off "temporarily".
alter table public.profiles disable row level security;
