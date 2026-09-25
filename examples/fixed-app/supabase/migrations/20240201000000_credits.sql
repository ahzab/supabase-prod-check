create or replace function public.grant_credits(uid uuid, amount int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set display_name = display_name where id = uid;
end;
$$;
