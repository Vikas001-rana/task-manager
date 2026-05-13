create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password text,
  avatar text,
  skill text not null default 'Team Member',
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  description text,
  priority text not null default 'Medium',
  deadline date not null,
  status text not null default 'To Do',
  tasks jsonb not null default '[]'::jsonb,
  members text[] not null default '{}',
  created_at date not null default current_date
);

create table if not exists public.complaints (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  message text not null,
  reply text not null default '',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.clients disable row level security;
alter table public.projects disable row level security;
alter table public.complaints disable row level security;

alter table public.clients add column if not exists skill text not null default 'Team Member';
alter table public.clients alter column password drop not null;
alter table public.clients drop column if exists role;
alter table public.complaints add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.complaints add column if not exists messages jsonb not null default '[]'::jsonb;

create or replace function public.handle_new_auth_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.clients (id, name, email, avatar, skill)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'avatar', upper(left(coalesce(new.raw_user_meta_data->>'name', new.email), 2))),
    coalesce(new.raw_user_meta_data->>'skill', 'Team Member')
  )
  on conflict (email) do update
  set
    id = excluded.id,
    name = excluded.name,
    avatar = excluded.avatar,
    skill = excluded.skill;

  return new;
end;
$$;

drop trigger if exists on_auth_member_created on auth.users;

create trigger on_auth_member_created
after insert on auth.users
for each row execute function public.handle_new_auth_member();

alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.complaints enable row level security;

drop policy if exists "allow anon read clients" on public.clients;
drop policy if exists "allow authenticated read clients" on public.clients;
drop policy if exists "allow authenticated insert own client profile" on public.clients;
drop policy if exists "allow authenticated update own client profile" on public.clients;

create policy "allow anon read clients"
on public.clients for select
to anon
using (true);

create policy "allow authenticated read clients"
on public.clients for select
to authenticated
using (true);

create policy "allow authenticated insert own client profile"
on public.clients for insert
to authenticated
with check (auth.uid() = id);

create policy "allow authenticated update own client profile"
on public.clients for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "allow anon read projects" on public.projects;
drop policy if exists "allow anon insert projects" on public.projects;
drop policy if exists "allow anon update projects" on public.projects;
drop policy if exists "allow anon delete projects" on public.projects;
drop policy if exists "allow authenticated read projects" on public.projects;
drop policy if exists "allow authenticated update projects" on public.projects;

create policy "allow anon read projects"
on public.projects for select
to anon
using (true);

create policy "allow anon insert projects"
on public.projects for insert
to anon
with check (true);

create policy "allow anon update projects"
on public.projects for update
to anon
using (true)
with check (true);

create policy "allow anon delete projects"
on public.projects for delete
to anon
using (true);

create policy "allow authenticated read projects"
on public.projects for select
to authenticated
using (true);

create policy "allow authenticated update projects"
on public.projects for update
to authenticated
using (true)
with check (true);

drop policy if exists "allow anon read complaints" on public.complaints;
drop policy if exists "allow anon update complaints" on public.complaints;
drop policy if exists "allow authenticated read complaints" on public.complaints;
drop policy if exists "allow authenticated insert complaints" on public.complaints;
drop policy if exists "allow authenticated update complaints" on public.complaints;

create policy "allow anon read complaints"
on public.complaints for select
to anon
using (true);

create policy "allow anon update complaints"
on public.complaints for update
to anon
using (true)
with check (true);

create policy "allow authenticated read complaints"
on public.complaints for select
to authenticated
using (true);

create policy "allow authenticated insert complaints"
on public.complaints for insert
to authenticated
with check (auth.uid() = member_id);

create policy "allow authenticated update complaints"
on public.complaints for update
to authenticated
using (true)
with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clients'
  ) then
    alter publication supabase_realtime add table public.clients;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'complaints'
  ) then
    alter publication supabase_realtime add table public.complaints;
  end if;
end $$;
