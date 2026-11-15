-- ── Fingerprint version 2 ───────────────────────────────────────────────────
-- Round 2's fingerprint left out the source's publication time (and the positive assessment), which the checks
-- also use: an edit that made a source too old after it was checked could still be published. Version 2 covers
-- every input the checks use. The application computes the same value (server/autopublish.ts, contentHash).
--
-- REQUIRED ORDER (the new code always sends version-2 fingerprints; the old database cannot check them):
--   1. Apply THIS migration.
--   2. Verify it (both must be true):
--        select to_regprocedure('public.story_content_hash_v2(public.stories)') is not null;
--        select pg_get_functiondef('public.auto_publish_edition(uuid,date,uuid[],jsonb,jsonb)'::regprocedure)
--               like '%story_content_hash_v2%';
--   3. Deploy the new code.
-- Code already deployed before this migration (round 2, commit 75fb325, version-1 fingerprints) keeps working
-- after step 1: this function still accepts version 1, so there is no gap between steps 1 and 3.
-- If the new code is deployed WITHOUT this migration, every automatic publication is refused as "edited after
-- it was checked" (the old function compares a version-1 value with a version-2 one): nothing publishes, an
-- alert is sent, and the latest edition stays up. That fails closed, but no edition goes out until step 1.
-- Once the new code is live, a later migration can drop the version-1 branch.
-- Rollback: supabase/rollbacks/20261118000000_fingerprint_v2_down.sql (redeploy version-1 code FIRST).

create or replace function public.story_content_hash_v2(s public.stories) returns text
language sql immutable set search_path = '' as $$
  select md5(concat_ws(E'\x1f',
    coalesce(s.headline, ''), coalesce(s.summary, ''), coalesce(s.category::text, ''),
    coalesce(s.source_name, ''), coalesce(s.source_url, ''), md5(coalesce(s.source_material, '')),
    -- whole seconds since 1970, '' when missing: the application normalises its timestamps the same way
    coalesce(floor(extract(epoch from s.source_published_at))::bigint::text, ''),
    md5(coalesce(s.ai_rationale, ''))))
$$;
revoke execute on function public.story_content_hash_v2(public.stories) from public, anon, authenticated;
grant execute on function public.story_content_hash_v2(public.stories) to service_role;

create or replace function public.auto_publish_edition(
  p_edition uuid,
  p_date date,
  p_primary uuid[],
  p_rejections jsonb,   -- [{ "id": uuid, "reason": text }]
  p_checked jsonb       -- [{ "id": uuid, "hash": text, "v": 2 }]: the content of each chosen story exactly as the checks read it
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_edition public.editions%rowtype;
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_bad int;
  v_changed int;
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

  -- The checks read these stories a moment ago. Lock them, so nobody can edit one between now and publication,
  -- and refuse if any has changed since it was checked. Nothing has been modified at this point.
  if jsonb_typeof(p_checked) is distinct from 'array' or jsonb_array_length(p_checked) <> 5 then
    raise exception 'The checked content of all five stories is required.';
  end if;
  perform 1 from public.stories where id = any (p_primary) order by id for update;
  select count(*) into v_changed from unnest(p_primary) as pid
  where not exists (
    select 1 from public.stories s
    join jsonb_array_elements(p_checked) c on (c->>'id')::uuid = s.id
    where s.id = pid
      -- Version 2 covers every input the checks use (incl. publication time). Version 1 is accepted only so code
      -- and database can be updated in either order; remove it once version-2 code is live (see the migration notes).
      and case coalesce(c->>'v', '1')
            when '2' then public.story_content_hash_v2(s)
            when '1' then public.story_content_hash(s)
          end = c->>'hash'
  );
  if v_changed > 0 then
    return 'changed';
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
revoke execute on function public.auto_publish_edition(uuid, date, uuid[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.auto_publish_edition(uuid, date, uuid[], jsonb, jsonb) to service_role;
