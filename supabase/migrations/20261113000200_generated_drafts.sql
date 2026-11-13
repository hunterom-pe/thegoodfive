-- Phase 3: the pipeline fills a draft through the same tables the editor uses.
--
-- create_draft_edition now:
--   * creates the day's edition if it doesn't exist, or
--   * fills an existing UNPUBLISHED edition that has no stories yet
--     (e.g. an empty draft the editor started), and
--   * does nothing (returns null) if the edition is published or already has
--     any stories, so a retry can never overwrite editorial work.
-- Everything lands as a draft. Publishing remains a separate editor action.
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
      return null; -- lost a race with another writer
    end if;
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

revoke execute on function public.create_draft_edition(date, jsonb) from public, anon, authenticated;
grant execute on function public.create_draft_edition(date, jsonb) to service_role;
