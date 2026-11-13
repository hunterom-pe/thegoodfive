-- The Good Five — schema, row-level security and editorial functions.
--
-- Security model in one paragraph:
--   * Readers (the `anon` role) have NO access to any table. They can read
--     two views, `public_editions` and `public_stories`, which expose only
--     published editions, only their five running stories, and only
--     reader-facing columns.
--   * The editor signs in with Supabase Auth and must also be listed in
--     `editors`. Every policy and function checks `is_editor()` in the
--     database, so hiding a button in the UI is never the only safeguard.
--   * Status changes and lineup changes go through functions that validate
--     the edition. There is no way to publish by writing a row directly.
--   * The discovery pipeline uses the service-role key, server-side only.

create extension if not exists pgcrypto;

create type public.edition_status as enum ('draft', 'review', 'published');
create type public.story_role as enum ('primary', 'backup', 'rejected');
create type public.story_category as enum ('humanity', 'health', 'science', 'nature', 'progress');

-- ── Tables ──────────────────────────────────────────────────────────────

-- Who may use /editor. Rows are added by hand in the SQL editor (see README).
create table public.editors (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- One row per day. `edition_date` is unique, which is also what makes the
-- daily job safe to retry.
create table public.editions (
  id uuid primary key default gen_random_uuid(),
  edition_date date not null unique,
  status public.edition_status not null default 'draft',
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_has_timestamp check ((status = 'published') = (published_at is not null))
);

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions (id) on delete cascade,

  -- Editorial status and ordering
  role public.story_role not null default 'backup',
  position smallint,
  rejected_reason text,

  -- What readers see
  category public.story_category not null,
  headline text not null,
  summary text not null,

  -- Source metadata (attribution shown to readers)
  source_name text not null,
  source_url text not null,
  source_published_at timestamptz,

  -- Imagery. Never shown publicly unless the editor confirms usage rights.
  image_url text,
  image_alt text,
  image_credit text,
  image_license text,
  image_rights_confirmed boolean not null default false,

  -- Research trail for fact-checking (editor only)
  original_title text,
  original_excerpt text,
  discovered_via text,
  ai_rationale text,
  claims_to_check jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint position_matches_role check ((role = 'rejected') = (position is null)),
  constraint five_primary_slots check (role <> 'primary' or position between 1 and 5),
  constraint source_url_is_http check (source_url ~* '^https?://'),
  -- Deferrable so a reorder can swap slots inside one transaction.
  constraint one_story_per_slot unique (edition_id, role, position) deferrable initially deferred
);

create index stories_edition_idx on public.stories (edition_id);
create index stories_source_url_idx on public.stories (source_url);

-- A log of pipeline runs, and the lock that stops two running at once.
create table public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  edition_date date not null,
  status text not null check (status in ('running', 'succeeded', 'skipped', 'failed')),
  trigger text not null default 'schedule',
  stats jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index one_running_discovery_per_date on public.discovery_runs (edition_date) where status = 'running';

-- ── Housekeeping ────────────────────────────────────────────────────────

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger editions_touch before update on public.editions for each row execute function public.touch_updated_at();
create trigger stories_touch before update on public.stories for each row execute function public.touch_updated_at();

-- ── Authorisation ───────────────────────────────────────────────────────

create function public.is_editor() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.editors where user_id = (select auth.uid()));
$$;

alter table public.editors enable row level security;
alter table public.editions enable row level security;
alter table public.stories enable row level security;
alter table public.discovery_runs enable row level security;

-- Start from nothing, then grant the minimum.
revoke all on public.editors, public.editions, public.stories, public.discovery_runs from anon, authenticated;

grant select on public.editors, public.editions, public.stories, public.discovery_runs to authenticated;
-- The editor may edit a story's words, source details and image fields
-- directly. Role, position and edition can only change through set_lineup().
grant update (
  category, headline, summary, source_name, source_url, source_published_at,
  image_url, image_alt, image_credit, image_license, image_rights_confirmed
) on public.stories to authenticated;

create policy "editors can see their own membership" on public.editors
  for select to authenticated using (user_id = (select auth.uid()));

create policy "editors read all editions" on public.editions
  for select to authenticated using ((select public.is_editor()));

create policy "editors read all stories" on public.stories
  for select to authenticated using ((select public.is_editor()));

create policy "editors edit story content" on public.stories
  for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()));

create policy "editors read discovery runs" on public.discovery_runs
  for select to authenticated using ((select public.is_editor()));

-- ── What readers can see ────────────────────────────────────────────────
-- These views deliberately run with their owner's rights (security_invoker
-- off) so that anonymous visitors, who have no table access at all, can read
-- exactly this slice and nothing else.

create view public.public_editions with (security_invoker = false) as
  select id, edition_date, published_at
  from public.editions
  where status = 'published';

create view public.public_stories with (security_invoker = false) as
  select
    s.id, s.edition_id, s.position, s.category, s.headline, s.summary,
    s.source_name, s.source_url, s.source_published_at,
    case when s.image_rights_confirmed then s.image_url end as image_url,
    case when s.image_rights_confirmed then s.image_alt end as image_alt,
    case when s.image_rights_confirmed then s.image_credit end as image_credit
  from public.stories s
  join public.editions e on e.id = s.edition_id
  where e.status = 'published' and s.role = 'primary';

grant select on public.public_editions, public.public_stories to anon, authenticated;

-- ── Editorial actions ───────────────────────────────────────────────────

-- Set which stories run (in order), which wait as backups, and by omission
-- which are rejected. One atomic statement, so the edition is never seen
-- half-reordered.
create function public.set_lineup(
  p_edition uuid,
  p_primary uuid[],
  p_backup uuid[],
  p_rejected_id uuid default null,
  p_rejected_reason text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.edition_status;
  v_all uuid[] := coalesce(p_primary, '{}') || coalesce(p_backup, '{}');
begin
  if not public.is_editor() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select status into v_status from public.editions where id = p_edition for update;
  if not found then
    raise exception 'Edition not found';
  end if;
  if v_status = 'published' then
    raise exception 'This edition is published. Unpublish it before changing the lineup.';
  end if;
  if coalesce(array_length(p_primary, 1), 0) > 5 then
    raise exception 'An edition has exactly five stories.';
  end if;
  if (select count(distinct x) from unnest(v_all) x) <> coalesce(array_length(v_all, 1), 0) then
    raise exception 'A story can only appear once in the lineup.';
  end if;
  if exists (select 1 from unnest(v_all) x where x not in (select id from public.stories where edition_id = p_edition)) then
    raise exception 'Lineup contains a story from another edition.';
  end if;

  update public.stories s set
    role = case
      when s.id = any (p_primary) then 'primary'
      when s.id = any (p_backup) then 'backup'
      else 'rejected'
    end::public.story_role,
    position = coalesce(array_position(p_primary, s.id), array_position(p_backup, s.id)),
    rejected_reason = case
      when s.id = any (v_all) then null
      when s.id = p_rejected_id then nullif(trim(p_rejected_reason), '')
      else s.rejected_reason
    end
  where s.edition_id = p_edition;
end $$;

-- Draft → Review → Published, and back. Publishing is the only path to
-- readers, and it refuses anything short of a complete edition.
create function public.set_edition_status(p_edition uuid, p_status public.edition_status) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ready int;
begin
  if not public.is_editor() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform 1 from public.editions where id = p_edition for update;
  if not found then
    raise exception 'Edition not found';
  end if;

  if p_status = 'published' then
    select count(*) into v_ready
    from public.stories
    where edition_id = p_edition
      and role = 'primary'
      and position between 1 and 5
      and length(trim(headline)) > 0
      and length(trim(summary)) > 0
      and length(trim(source_name)) > 0;
    if v_ready <> 5 then
      raise exception 'An edition needs exactly five complete stories before it can be published (found %).', v_ready;
    end if;
    update public.editions
      set status = 'published', published_at = now(), published_by = (select auth.uid())
      where id = p_edition;
  else
    update public.editions
      set status = p_status, published_at = null, published_by = null
      where id = p_edition;
  end if;
end $$;

-- Called by the discovery pipeline with the service-role key. Creates the
-- edition and all its stories in one transaction, always as a draft.
-- Returns null (and changes nothing) if that day's edition already exists.
create function public.create_draft_edition(p_date date, p_stories jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.editions (edition_date, status)
  values (p_date, 'draft')
  on conflict (edition_date) do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  insert into public.stories (
    edition_id, role, position, category, headline, summary,
    source_name, source_url, source_published_at,
    original_title, original_excerpt, discovered_via, ai_rationale, claims_to_check
  )
  select
    v_id, x.role, x.position, x.category, x.headline, x.summary,
    x.source_name, x.source_url, x.source_published_at,
    x.original_title, x.original_excerpt, x.discovered_via, x.ai_rationale, coalesce(x.claims_to_check, '[]'::jsonb)
  from jsonb_to_recordset(p_stories) as x (
    role public.story_role, position smallint, category public.story_category,
    headline text, summary text, source_name text, source_url text, source_published_at timestamptz,
    original_title text, original_excerpt text, discovered_via text, ai_rationale text, claims_to_check jsonb
  );

  return v_id;
end $$;

revoke execute on function public.is_editor() from public, anon;
revoke execute on function public.set_lineup(uuid, uuid[], uuid[], uuid, text) from public, anon;
revoke execute on function public.set_edition_status(uuid, public.edition_status) from public, anon;
revoke execute on function public.create_draft_edition(date, jsonb) from public, anon, authenticated;

grant execute on function public.is_editor() to authenticated;
grant execute on function public.set_lineup(uuid, uuid[], uuid[], uuid, text) to authenticated;
grant execute on function public.set_edition_status(uuid, public.edition_status) to authenticated;
grant execute on function public.create_draft_edition(date, jsonb) to service_role;
