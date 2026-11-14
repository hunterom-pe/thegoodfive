-- Phase 5: unattended daily publishing, with the editor's safeguards intact.
--
-- The existing set_edition_status() stays the ONLY path for a human editor. This
-- adds a second, separate, service-role-only path for the scheduled publisher,
-- which re-checks the structural rules in the database itself. The text-level
-- checks (numbers, names, quotes, hedging...) run in the server code, and the
-- database refuses anything the server should not have sent.

-- ── Evidence kept with each story, and who approved its image ───────────────
alter table public.stories
  add column source_material text,                                  -- retrieved text the summary was checked against (editor-only)
  add column image_editor_approved boolean not null default false;  -- an editor personally approved/chose this image

grant update (image_editor_approved) on public.stories to authenticated;

-- ── What the scheduled publisher did, and why ───────────────────────────────
create table public.publish_runs (
  id uuid primary key default gen_random_uuid(),
  edition_date date not null,
  status text not null check (status in ('published', 'skipped', 'failed', 'disabled', 'dry_run')),
  trigger text not null default 'schedule',
  reason text,
  details jsonb not null default '{}'::jsonb,   -- accepted/rejected stories and why
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index publish_runs_date_idx on public.publish_runs (edition_date, started_at desc);
alter table public.publish_runs enable row level security;
revoke all on public.publish_runs from anon, authenticated;
grant select on public.publish_runs to authenticated;
create policy "editors read publish runs" on public.publish_runs for select to authenticated using ((select public.is_editor()));

-- ── create_draft_edition: now carries source material and rejected stories ──
create or replace function public.create_draft_edition(p_date date, p_stories jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_status public.edition_status;
begin
  select id, status into v_id, v_status from public.editions where edition_date = p_date for update;
  if found then
    if v_status = 'published' or exists (select 1 from public.stories where edition_id = v_id) then
      return null;
    end if;
  else
    insert into public.editions (edition_date, status) values (p_date, 'draft')
    on conflict (edition_date) do nothing
    returning id into v_id;
    if v_id is null then
      return null;
    end if;
  end if;

  insert into public.stories (
    edition_id, role, position, category, headline, summary,
    source_name, source_url, source_published_at,
    original_title, original_excerpt, source_material, discovered_via, ai_rationale, claims_to_check, rejected_reason,
    image_url, image_alt, image_credit, image_credit_url, image_license,
    image_kind, image_source, image_source_url, image_candidates, image_rights_confirmed
  )
  select
    v_id, x.role, x.position, x.category, x.headline, x.summary,
    x.source_name, x.source_url, x.source_published_at,
    x.original_title, x.original_excerpt, left(x.source_material, 8000), x.discovered_via, x.ai_rationale, coalesce(x.claims_to_check, '[]'::jsonb),
    case when x.role = 'rejected' then left(x.rejected_reason, 1000) end,
    x.image_url, x.image_alt, x.image_credit, x.image_credit_url, x.image_license,
    x.image_kind, x.image_source, x.image_source_url, coalesce(x.image_candidates, '[]'::jsonb),
    (x.role <> 'rejected' and x.image_url is not null and x.image_source = 'unsplash' and x.image_kind = 'illustrative' and coalesce(x.image_rights_confirmed, false))
  from jsonb_to_recordset(p_stories) as x (
    role public.story_role, position smallint, category public.story_category,
    headline text, summary text, source_name text, source_url text, source_published_at timestamptz,
    original_title text, original_excerpt text, source_material text, discovered_via text, ai_rationale text, claims_to_check jsonb, rejected_reason text,
    image_url text, image_alt text, image_credit text, image_credit_url text, image_license text,
    image_kind text, image_source text, image_source_url text, image_candidates jsonb, image_rights_confirmed boolean
  );

  return v_id;
end $$;
revoke execute on function public.create_draft_edition(date, jsonb) from public, anon, authenticated;
grant execute on function public.create_draft_edition(date, jsonb) to service_role;

-- ── The unattended publisher ────────────────────────────────────────────────
-- Service role only. Idempotent, atomic, and refuses to touch anything a human
-- has taken hold of. Returns the outcome; raises only for requests that are wrong.
create or replace function public.auto_publish_edition(
  p_edition uuid,
  p_date date,
  p_primary uuid[],
  p_rejections jsonb default '[]'::jsonb  -- [{ "id": uuid, "reason": text }]
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_edition public.editions%rowtype;
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_bad int;
begin
  select * into v_edition from public.editions where id = p_edition for update;  -- serialises concurrent attempts
  if not found then
    raise exception 'Edition not found';
  end if;

  -- Repeats are harmless: a published edition is left exactly as it is.
  if v_edition.status = 'published' then
    return 'already_published';
  end if;
  -- "In review" means a person is holding this edition. The robot never overrides that.
  if v_edition.status <> 'draft' then
    return 'held';
  end if;

  if v_edition.edition_date <> p_date then
    raise exception 'Edition date does not match the requested date.';
  end if;
  if p_date > v_today then
    raise exception 'Refusing to publish a future edition.';
  end if;
  if coalesce(array_length(p_primary, 1), 0) <> 5 or (select count(distinct x) from unnest(p_primary) x) <> 5 then
    raise exception 'Exactly five distinct stories are required.';
  end if;
  if exists (select 1 from unnest(p_primary) x where x not in (select id from public.stories where edition_id = p_edition and role in ('primary', 'backup'))) then
    raise exception 'The chosen stories are not all candidates of this edition.';
  end if;

  -- Structural rules, enforced here regardless of what the caller checked.
  select count(*) into v_bad from public.stories
  where id = any (p_primary) and not (
    length(trim(headline)) > 0 and length(trim(summary)) > 0 and length(trim(source_name)) > 0
    and source_url ~* '^https://[^/]+\.[^/]+'
    and source_published_at is not null
    and source_published_at >= now() - interval '7 days'
    and source_published_at <= now() + interval '1 hour'
  );
  if v_bad > 0 then
    raise exception '% of the chosen stories fail the structural checks (link, source, date).', v_bad;
  end if;

  -- No repeated articles within the edition...
  if (select count(distinct lower(regexp_replace(source_url, '[?#].*$', ''))) from public.stories where id = any (p_primary)) <> 5 then
    raise exception 'Two chosen stories link to the same article.';
  end if;
  -- ...or in the last 30 days of published editions.
  if exists (
    select 1 from public.stories s
    join public.stories o on lower(regexp_replace(o.source_url, '[?#].*$', '')) = lower(regexp_replace(s.source_url, '[?#].*$', ''))
    join public.editions e on e.id = o.edition_id
    where s.id = any (p_primary) and e.status = 'published' and e.edition_date >= p_date - 30 and e.id <> p_edition
  ) then
    raise exception 'A chosen article already ran in a recent edition.';
  end if;

  -- Lineup, in three steps (the slot uniqueness constraint is deferred, so order within the transaction is free):
  -- 1. stories the checks rejected are recorded as rejected, with the reason
  update public.stories s set
    role = 'rejected', position = null,
    rejected_reason = left(r.reason, 1000)
  from (select (x->>'id')::uuid as id, x->>'reason' as reason from jsonb_array_elements(p_rejections) x) r
  where s.id = r.id and s.edition_id = p_edition and not (s.id = any (p_primary));
  -- 2. everything else that is not in the five waits as a backup, keeping its relative order
  update public.stories s set role = 'backup', position = q.rn::smallint
  from (
    select id, row_number() over (order by position nulls last, created_at) as rn
    from public.stories where edition_id = p_edition and role <> 'rejected' and not (id = any (p_primary))
  ) q
  where s.id = q.id;
  -- 3. the five, in the order chosen
  update public.stories set role = 'primary', position = array_position(p_primary, id), rejected_reason = null
  where edition_id = p_edition and id = any (p_primary);

  -- Unattended runs never show an Unsplash photo that no editor has approved
  -- (Unsplash's API terms ask for non-automated use). Publisher images are never public unless an editor cleared them.
  update public.stories set image_rights_confirmed = false
  where edition_id = p_edition and image_rights_confirmed and image_source = 'unsplash' and not image_editor_approved;

  update public.editions set status = 'published', published_at = now(), published_by = null where id = p_edition;
  return 'published';
end $$;
revoke execute on function public.auto_publish_edition(uuid, date, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.auto_publish_edition(uuid, date, uuid[], jsonb) to service_role;

-- ── Photos on any edition, without touching its words ───────────────────────
-- The published-edition lock stays: text, lineup and sources cannot change. This
-- lets an editor (not the robot) add or replace only the image fields.
create or replace function public.guard_published_stories() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_edition uuid := case when tg_op = 'DELETE' then old.edition_id else new.edition_id end;
  v_image_cols text[] := array['image_url','image_alt','image_credit','image_credit_url','image_license','image_kind','image_source','image_source_url','image_candidates','image_rights_confirmed','image_editor_approved','updated_at'];
begin
  if exists (select 1 from public.editions where id = v_edition and status = 'published') then
    if tg_op = 'UPDATE' and current_setting('app.image_only', true) = 'on'
       and (to_jsonb(new) - v_image_cols) = (to_jsonb(old) - v_image_cols) then
      return new;  -- an image-only change made through set_story_image()
    end if;
    raise exception 'This edition is published and locked. Unpublish it to make changes.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create function public.set_story_image(p_story uuid, p_image jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_editor() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform set_config('app.image_only', 'on', true);  -- this transaction only
  update public.stories set
    image_url = nullif(trim(p_image->>'image_url'), ''),
    image_alt = nullif(trim(p_image->>'image_alt'), ''),
    image_credit = nullif(trim(p_image->>'image_credit'), ''),
    image_credit_url = nullif(trim(p_image->>'image_credit_url'), ''),
    image_license = nullif(trim(p_image->>'image_license'), ''),
    image_kind = nullif(p_image->>'image_kind', ''),
    image_source = nullif(p_image->>'image_source', ''),
    image_source_url = nullif(trim(p_image->>'image_source_url'), ''),
    image_candidates = coalesce(p_image->'image_candidates', image_candidates),
    image_rights_confirmed = coalesce((p_image->>'image_rights_confirmed')::boolean, false) and nullif(trim(p_image->>'image_url'), '') is not null,
    image_editor_approved = coalesce((p_image->>'image_editor_approved')::boolean, false) and nullif(trim(p_image->>'image_url'), '') is not null
  where id = p_story;
  if not found then
    raise exception 'Story not found';
  end if;
end $$;
revoke execute on function public.set_story_image(uuid, jsonb) from public, anon;
grant execute on function public.set_story_image(uuid, jsonb) to authenticated;
