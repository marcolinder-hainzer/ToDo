-- =============================================================================
-- ToDo-App – Datenbank-Einrichtung für Supabase
--
-- Im Supabase-Dashboard unter "SQL Editor" komplett einfügen und auf "Run" klicken.
-- Das Skript kann gefahrlos mehrfach ausgeführt werden (z. B. nach Updates).
--
-- Sicherheitsprinzip: Row Level Security (RLS). Jede Zeile gehört einem Benutzer
-- (user_id) und kann nur von diesem gelesen und geändert werden.
-- =============================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- -----------------------------------------------------------------------------
-- Tabellen
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  username             text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name         text not null check (char_length(display_name) between 1 and 60),
  is_admin             boolean not null default false,
  must_change_password boolean not null default false,
  settings             jsonb not null default '{}'::jsonb
                         check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 8192),
  created_at           timestamptz not null default now()
);

create table if not exists public.projects (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  area        text not null check (area in ('work', 'private')),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  color       text not null default '#6366f1' check (color ~ '^#[0-9a-f]{6}$'),
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects (user_id);

create table if not exists public.todos (
  id                 bigint generated always as identity primary key,
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id         bigint references public.projects (id) on delete set null,
  area               text not null check (area in ('work', 'private')),
  title              text not null check (char_length(btrim(title)) between 1 and 200),
  description        text not null default '' check (char_length(description) <= 10000),
  priority           smallint not null default 1 check (priority between 0 and 2),
  due_date           date,
  due_time           text check (due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  reminder_at        timestamptz,
  reminder_sent_at   timestamptz,
  reminder_dismissed boolean not null default false,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  search_text        text generated always as (lower(title || ' ' || description)) stored
);
create index if not exists todos_user_idx on public.todos (user_id, completed_at);
create index if not exists todos_project_idx on public.todos (project_id);
create index if not exists todos_reminder_idx on public.todos (reminder_at)
  where reminder_at is not null and reminder_sent_at is null;

create table if not exists public.todo_images (
  id            bigint generated always as identity primary key,
  todo_id       bigint not null references public.todos (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path          text not null unique,
  original_name text not null check (char_length(original_name) <= 200),
  mime_type     text not null check (mime_type in ('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif')),
  size          integer not null check (size > 0),
  created_at    timestamptz not null default now()
);
create index if not exists todo_images_todo_idx on public.todo_images (todo_id);

-- Vom Admin freigegebene Konten (nur die Edge Function "admin-users" kann hier schreiben).
create table if not exists public.user_invites (
  email      text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- -----------------------------------------------------------------------------
-- Trigger-Funktionen
-- -----------------------------------------------------------------------------

-- Neues Konto -> Profil. Der allererste Benutzer wird Administrator.
-- Danach werden nur Konten angenommen, die ein Admin über die App angelegt hat (Eintrag in user_invites);
-- eine Selbstregistrierung ist damit auch dann unmöglich, wenn sie in den Auth-Einstellungen aktiv wäre.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles) then
    delete from public.user_invites
     where email = lower(new.email) and created_at > now() - interval '10 minutes';
    if not found then
      raise exception 'Registrierung ist deaktiviert' using errcode = '42501';
    end if;
  end if;
  insert into public.profiles (id, username, display_name, is_admin, must_change_password)
  values (
    new.id,
    lower(coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1))),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)),
    not exists (select 1 from public.profiles where is_admin),
    coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, false)
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Hat der Benutzer sein Passwort tatsächlich geändert, entfällt die Pflicht zur Änderung.
create or replace function public.handle_password_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles set must_change_password = false where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_password_changed on auth.users;
create trigger on_auth_user_password_changed
  after update of encrypted_password on auth.users
  for each row execute function public.handle_password_change();

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Todos: Bereich immer passend zum Projekt, keine Uhrzeit ohne Datum,
-- geänderte Erinnerung wird neu "scharf" geschaltet.
create or replace function public.todos_before_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  project_area text;
begin
  if new.project_id is not null and (
    tg_op = 'INSERT' or new.project_id is distinct from old.project_id or new.area is distinct from old.area
  ) then
    select p.area into project_area from public.projects p where p.id = new.project_id and p.user_id = new.user_id;
    if project_area is null then
      raise exception 'Projekt nicht gefunden' using errcode = '23503';
    end if;
    new.area := project_area;
  end if;
  new.title := btrim(new.title);
  if new.due_date is null then
    new.due_time := null;
  end if;
  if tg_op = 'UPDATE' then
    if new.reminder_at is distinct from old.reminder_at then
      new.reminder_sent_at := null;
      new.reminder_dismissed := false;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists todos_before_write on public.todos;
create trigger todos_before_write
  before insert or update on public.todos
  for each row execute function public.todos_before_write();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- Wird ein Projekt in den anderen Bereich verschoben, wandern seine Todos mit.
create or replace function public.projects_after_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.area is distinct from old.area then
    update public.todos set area = new.area where project_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists projects_after_update on public.projects;
create trigger projects_after_update
  after update of area on public.projects
  for each row execute function public.projects_after_update();

-- -----------------------------------------------------------------------------
-- Funktionen für die App
-- -----------------------------------------------------------------------------

-- Zähler pro Projekt (offen / erledigt / überfällig) – nur eigene Todos (RLS).
create or replace function public.project_stats(today date)
returns table (project_id bigint, open_count int, done_count int, overdue_count int)
language sql stable security invoker set search_path = '' as $$
  select t.project_id,
         count(*) filter (where t.completed_at is null)::int,
         count(*) filter (where t.completed_at is not null)::int,
         count(*) filter (where t.completed_at is null and t.due_date < today)::int
    from public.todos t
   where t.project_id is not null
   group by t.project_id;
$$;

-- Push-Abo dieses Geräts für den angemeldeten Benutzer speichern.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Bitte melde dich an' using errcode = '42501';
  end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'Ungültiges Push-Abo' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

-- Nur für die Admin-Funktion (service_role): Statistik pro Benutzer.
create or replace function public.user_stats()
returns table (user_id uuid, todo_count bigint, project_count bigint)
language sql stable security invoker set search_path = '' as $$
  select u.id,
         (select count(*) from public.todos t where t.user_id = u.id),
         (select count(*) from public.projects p where p.user_id = u.id)
    from public.profiles u;
$$;

-- Nur für die Admin-Funktion (service_role): alle Sitzungen eines Benutzers beenden.
create or replace function public.revoke_user_sessions(target uuid)
returns void language sql security definer set search_path = '' as $$
  delete from auth.sessions where user_id = target;
$$;

-- -----------------------------------------------------------------------------
-- Rechte
-- -----------------------------------------------------------------------------

revoke all on public.profiles, public.projects, public.todos, public.todo_images, public.push_subscriptions from anon;
revoke all on public.user_invites from anon, authenticated;
grant all on public.user_invites to service_role;

revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, settings) on public.profiles to authenticated;

grant select, insert, update, delete on public.projects, public.todos, public.todo_images to authenticated;

revoke insert, update on public.push_subscriptions from authenticated;
grant select, delete on public.push_subscriptions to authenticated;

grant all on public.profiles, public.projects, public.todos, public.todo_images, public.push_subscriptions to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

revoke execute on function public.handle_new_user(), public.handle_password_change() from public, anon, authenticated;
revoke execute on function public.project_stats(date), public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.project_stats(date), public.save_push_subscription(text, text, text) to authenticated;
revoke execute on function public.user_stats(), public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.user_stats(), public.revoke_user_sessions(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security: jeder sieht nur seine eigenen Daten
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.todos enable row level security;
alter table public.todo_images enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.user_invites enable row level security; -- keine Policies: nur service_role

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "projects: own" on public.projects;
create policy "projects: own" on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "todos: own" on public.todos;
create policy "todos: own" on public.todos
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (project_id is null or exists (
      select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())
    ))
  );

drop policy if exists "todo_images: own" on public.todo_images;
create policy "todo_images: own" on public.todo_images
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and split_part(path, '/', 1) = (select auth.uid())::text
    and exists (select 1 from public.todos t where t.id = todo_id and t.user_id = (select auth.uid()))
  );

drop policy if exists "push_subscriptions: own" on public.push_subscriptions;
create policy "push_subscriptions: own" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Bildspeicher: privater Bucket, jeder Benutzer nur in seinem eigenen Ordner
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('todo-images', 'todo-images', false, 15728640,
        array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "todo-images: own files" on storage.objects;
create policy "todo-images: own files" on storage.objects
  for all to authenticated
  using (bucket_id = 'todo-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'todo-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
