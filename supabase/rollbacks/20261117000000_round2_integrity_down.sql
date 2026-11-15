-- Roll back 20261117000000_round2_integrity.sql. Restores the round-1 behaviour exactly.
-- Run this only if you also redeploy the round-1 code (which calls the 4-argument function).
drop function if exists public.auto_publish_edition(uuid, date, uuid[], jsonb, jsonb);
drop function if exists public.story_content_hash(public.stories);

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

create or replace view public.public_editions with (security_invoker = false) as
  select id, edition_date, published_at
  from public.editions
  where status = 'published';

create or replace view public.public_stories with (security_invoker = false) as
  select
    s.id, s.edition_id, s.position, s.category, s.headline, s.summary,
    s.source_name, s.source_url, s.source_published_at,
    case when s.image_rights_confirmed then s.image_url end as image_url,
    case when s.image_rights_confirmed then s.image_alt end as image_alt,
    case when s.image_rights_confirmed then s.image_credit end as image_credit,
    case when s.image_rights_confirmed then s.image_kind end as image_kind,
    case when s.image_rights_confirmed then s.image_license end as image_license,
    case when s.image_rights_confirmed then s.image_source_url end as image_source_url,
    case when s.image_rights_confirmed then s.image_credit_url end as image_credit_url
  from public.stories s
  join public.editions e on e.id = s.edition_id
  where e.status = 'published' and s.role = 'primary';


grant select on public.public_editions, public.public_stories to anon, authenticated;
