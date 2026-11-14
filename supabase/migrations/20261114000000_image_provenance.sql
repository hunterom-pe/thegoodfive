-- Photography: provenance, review state, and public attribution.
--
-- A story has ONE selected image (the image_* columns) and a list of
-- candidates to choose from. An image reaches readers only when
-- image_rights_confirmed is true, which means either:
--   * the editor confirmed the right to reuse it, or
--   * it came from a licensed provider (Unsplash) whose terms cover that specific photo.
-- A publisher's own image (og:image etc.) is only ever a candidate until an
-- editor confirms it: the pipeline cannot clear it (enforced below).

alter table public.stories
  add column image_kind text check (image_kind in ('original', 'illustrative')),
  add column image_source text,         -- og:image | twitter:image | json-ld | rss | unsplash | manual
  add column image_source_url text,     -- where the image lives (photo page, or the article)
  add column image_credit_url text,     -- photographer / publisher link, for attribution
  add column image_candidates jsonb not null default '[]'::jsonb;

-- Approval requires an image to approve.
alter table public.stories
  add constraint rights_need_an_image check (not image_rights_confirmed or image_url is not null),
  add constraint credit_url_is_http check (image_credit_url is null or image_credit_url ~* '^https?://'),
  add constraint image_source_url_is_http check (image_source_url is null or image_source_url ~* '^https?://');

-- Editors may change the new image fields directly (the lineup columns stay function-only).
grant update (image_kind, image_source, image_source_url, image_credit_url, image_candidates) on public.stories to authenticated;

-- What readers see. Image details are exposed ONLY when approved.
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

grant select on public.public_stories to anon, authenticated;

-- The pipeline's entry point, now carrying image information. Same fill rules
-- as before (see 20261113000200). Auto-clearing is limited to photos from a
-- licensed provider: a publisher's image is stored as unapproved no matter what is sent.
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
    original_title, original_excerpt, discovered_via, ai_rationale, claims_to_check,
    image_url, image_alt, image_credit, image_credit_url, image_license,
    image_kind, image_source, image_source_url, image_candidates, image_rights_confirmed
  )
  select
    v_id, x.role, x.position, x.category, x.headline, x.summary,
    x.source_name, x.source_url, x.source_published_at,
    x.original_title, x.original_excerpt, x.discovered_via, x.ai_rationale, coalesce(x.claims_to_check, '[]'::jsonb),
    x.image_url, x.image_alt, x.image_credit, x.image_credit_url, x.image_license,
    x.image_kind, x.image_source, x.image_source_url, coalesce(x.image_candidates, '[]'::jsonb),
    (x.image_url is not null and x.image_source = 'unsplash' and x.image_kind = 'illustrative' and coalesce(x.image_rights_confirmed, false))
  from jsonb_to_recordset(p_stories) as x (
    role public.story_role, position smallint, category public.story_category,
    headline text, summary text, source_name text, source_url text, source_published_at timestamptz,
    original_title text, original_excerpt text, discovered_via text, ai_rationale text, claims_to_check jsonb,
    image_url text, image_alt text, image_credit text, image_credit_url text, image_license text,
    image_kind text, image_source text, image_source_url text, image_candidates jsonb, image_rights_confirmed boolean
  );

  return v_id;
end $$;

revoke execute on function public.create_draft_edition(date, jsonb) from public, anon, authenticated;
grant execute on function public.create_draft_edition(date, jsonb) to service_role;
