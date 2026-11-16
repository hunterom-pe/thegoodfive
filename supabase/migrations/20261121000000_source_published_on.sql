-- The day a publisher prints on an article, kept beside the exact moment it was published.
--
-- source_published_at is an instant, shown in UTC it can fall on a different calendar day than the article
-- itself (a ScienceDaily item stamped 22:51 on 15 November, New York time, is 16 November in UTC).
-- source_published_on is that printed day, read from the publisher's own text. It is for display only:
-- freshness checks and content fingerprints keep using the instant. Rows without it (every existing story)
-- fall back to the UTC day, exactly as before.
--
-- Additive and safe to run before or after deploying the code: old code never sends the field (it is null),
-- and new code against the old schema simply has its extra field ignored by create_draft_edition.

alter table public.stories add column if not exists source_published_on date;

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
    source_name, source_url, source_published_at, source_published_on,
    original_title, original_excerpt, source_material, discovered_via, ai_rationale, claims_to_check, rejected_reason,
    image_url, image_alt, image_credit, image_credit_url, image_license,
    image_kind, image_source, image_source_url, image_candidates, image_rights_confirmed
  )
  select
    v_id, x.role, x.position, x.category, x.headline, x.summary,
    x.source_name, x.source_url, x.source_published_at, x.source_published_on,
    x.original_title, x.original_excerpt, left(x.source_material, 8000), x.discovered_via, x.ai_rationale, coalesce(x.claims_to_check, '[]'::jsonb),
    case when x.role = 'rejected' then left(x.rejected_reason, 1000) end,
    x.image_url, x.image_alt, x.image_credit, x.image_credit_url, x.image_license,
    x.image_kind, x.image_source, x.image_source_url, coalesce(x.image_candidates, '[]'::jsonb),
    (x.role <> 'rejected' and x.image_url is not null and x.image_source = 'unsplash' and x.image_kind = 'illustrative' and coalesce(x.image_rights_confirmed, false))
  from jsonb_to_recordset(p_stories) as x (
    role public.story_role, position smallint, category public.story_category,
    headline text, summary text, source_name text, source_url text, source_published_at timestamptz, source_published_on date,
    original_title text, original_excerpt text, source_material text, discovered_via text, ai_rationale text, claims_to_check jsonb, rejected_reason text,
    image_url text, image_alt text, image_credit text, image_credit_url text, image_license text,
    image_kind text, image_source text, image_source_url text, image_candidates jsonb, image_rights_confirmed boolean
  );

  return v_id;
end $$;
revoke execute on function public.create_draft_edition(date, jsonb) from public, anon, authenticated;
grant execute on function public.create_draft_edition(date, jsonb) to service_role;

-- Readers see the printed day beside the instant. The new column goes last: a view can only gain columns at its end.
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
    case when s.image_rights_confirmed then s.image_credit_url end as image_credit_url,
    s.source_published_on
  from public.stories s
  join public.editions e on e.id = s.edition_id
  where e.status = 'published' and s.role = 'primary'
    and e.edition_date <= (now() at time zone 'America/Phoenix')::date;
grant select on public.public_stories to anon, authenticated;
