-- Phase 2 controls: published editions are frozen, publishing is one-shot,
-- and editors can create editions and add stories through checked functions.

-- ── Input limits ────────────────────────────────────────────────────────
alter table public.stories
  add constraint image_url_is_http check (image_url is null or image_url ~* '^https?://'),
  add constraint headline_length check (char_length(headline) between 1 and 220),
  add constraint summary_length check (char_length(summary) between 1 and 1800),
  add constraint source_name_length check (char_length(source_name) between 1 and 120);

-- ── Published editions cannot be changed in place ───────────────────────
-- Applies to everyone, including the service role. To correct a published
-- edition, an editor must unpublish it first (set_edition_status → review),
-- fix it, and publish again. Nothing edits history silently.
create function public.guard_published_stories() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_edition uuid := case when tg_op = 'DELETE' then old.edition_id else new.edition_id end;
begin
  if exists (select 1 from public.editions where id = v_edition and status = 'published') then
    raise exception 'This edition is published and locked. Unpublish it to make changes.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger stories_guard_published
  before insert or update or delete on public.stories
  for each row execute function public.guard_published_stories();

-- ── Publishing is a one-shot, repeat-safe action ────────────────────────
create or replace function public.set_edition_status(p_edition uuid, p_status public.edition_status) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_current public.edition_status;
  v_ready int;
begin
  if not public.is_editor() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select status into v_current from public.editions where id = p_edition for update;
  if not found then
    raise exception 'Edition not found';
  end if;

  if p_status = 'published' then
    if v_current = 'published' then
      raise exception 'This edition is already published.';
    end if;
    select count(*) into v_ready
    from public.stories
    where edition_id = p_edition
      and role = 'primary'
      and position between 1 and 5
      and length(trim(headline)) > 0
      and length(trim(summary)) > 0
      and length(trim(source_name)) > 0
      and source_url ~* '^https?://';
    if v_ready <> 5 then
      raise exception 'An edition needs exactly five complete stories before it can be published (found %).', v_ready;
    end if;
    update public.editions
      set status = 'published', published_at = now(), published_by = (select auth.uid())
      where id = p_edition;
  elsif v_current <> p_status then
    update public.editions
      set status = p_status, published_at = null, published_by = null
      where id = p_edition;
  end if;
end $$;

-- ── Create an edition (always a draft) ──────────────────────────────────
create function public.create_edition(p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.is_editor() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  insert into public.editions (edition_date, status) values (p_date, 'draft')
  on conflict (edition_date) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'An edition for that date already exists.';
  end if;
  return v_id;
end $$;

-- ── Add a story by hand ─────────────────────────────────────────────────
-- Same shape the Phase 3 pipeline will use: a story enters as a primary (if
-- a slot is free) or a backup, then flows through the same review steps.
create function public.add_story(
  p_edition uuid,
  p_role public.story_role,
  p_category public.story_category,
  p_headline text,
  p_summary text,
  p_source_name text,
  p_source_url text,
  p_source_published_at timestamptz default null,
  p_image_url text default null,
  p_image_alt text default null,
  p_image_credit text default null,
  p_image_license text default null,
  p_image_rights_confirmed boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.edition_status;
  v_position smallint;
  v_id uuid;
begin
  if not public.is_editor() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_role = 'rejected' then
    raise exception 'A new story is either a primary or a backup.';
  end if;
  select status into v_status from public.editions where id = p_edition for update;
  if not found then
    raise exception 'Edition not found';
  end if;
  if v_status = 'published' then
    raise exception 'This edition is published and locked. Unpublish it to make changes.';
  end if;
  select coalesce(max(position), 0) + 1 into v_position from public.stories where edition_id = p_edition and role = p_role;
  if p_role = 'primary' and v_position > 5 then
    raise exception 'The edition already has five stories. Add this one as a backup.';
  end if;

  insert into public.stories (
    edition_id, role, position, category, headline, summary, source_name, source_url,
    source_published_at, image_url, image_alt, image_credit, image_license, image_rights_confirmed, discovered_via
  ) values (
    p_edition, p_role, v_position, p_category, trim(p_headline), trim(p_summary), trim(p_source_name), trim(p_source_url),
    p_source_published_at, nullif(trim(p_image_url), ''), nullif(trim(p_image_alt), ''), nullif(trim(p_image_credit), ''),
    nullif(trim(p_image_license), ''), p_image_rights_confirmed and nullif(trim(p_image_url), '') is not null, 'Added by editor'
  ) returning id into v_id;
  return v_id;
end $$;

-- ── Permanently delete a story the editor has already rejected ──────────
create function public.delete_story(p_story uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_editor() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  delete from public.stories where id = p_story and role = 'rejected';
  if not found then
    raise exception 'Only rejected stories can be deleted.';
  end if;
end $$;

revoke execute on function public.create_edition(date) from public, anon;
revoke execute on function public.add_story(uuid, public.story_role, public.story_category, text, text, text, text, timestamptz, text, text, text, text, boolean) from public, anon;
revoke execute on function public.delete_story(uuid) from public, anon;
revoke execute on function public.guard_published_stories() from public, anon, authenticated;
grant execute on function public.create_edition(date) to authenticated;
grant execute on function public.add_story(uuid, public.story_role, public.story_category, text, text, text, text, timestamptz, text, text, text, text, boolean) to authenticated;
grant execute on function public.delete_story(uuid) to authenticated;
