-- ── "What happened next?" ────────────────────────────────────────────────────
-- An editor connects a newer story to an earlier one it genuinely follows up, with a written reason and a
-- supporting source. Relationships live in their own table: published story text stays locked and untouched,
-- and each edition stays exactly five stories (a follow-up is a link, not an extra story).
--
-- Human-verified by construction:
--   * only a signed-in editor can create, approve, change or remove one (row-level security AND a trigger that
--     checks is_editor(), so the server's automated jobs, which run without a user, cannot create one);
--   * a new or changed relationship is always "pending"; it shows to readers only after an editor approves it;
--   * no story links to itself, a pair is linked at most once, and the "earlier" story must come from an earlier
--     edition than the "later" one;
--   * readers see a relationship only through public_followups: approved, and both stories published, primary
--     and not in the future (the same rules as the public story view). Unpublishing either story hides it at once.
-- Order: apply after 20261117000000 and 20261118000000. Deploy the code after this (the site tolerates the view
-- being absent, so the order is not critical). Rollback: supabase/rollbacks/20261119000000_story_followups_down.sql.

create table public.story_followups (
  id uuid primary key default gen_random_uuid(),
  earlier_story uuid not null references public.stories (id) on delete cascade,
  later_story uuid not null references public.stories (id) on delete cascade,
  explanation text not null check (length(trim(explanation)) between 20 and 600),
  source_url text not null check (source_url ~* '^https://[^/\s]+\.[^/\s]+'),
  status text not null default 'pending' check (status in ('pending', 'approved')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint story_followups_not_self check (earlier_story <> later_story),
  constraint story_followups_once unique (earlier_story, later_story)
);
create index story_followups_later_idx on public.story_followups (later_story);

create or replace function public.guard_story_followup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_earlier date;
  v_later date;
begin
  -- A person, and an editor. Automated jobs (service role, no signed-in user) are refused here.
  if not (select public.is_editor()) then
    raise exception 'Only a signed-in editor can connect stories.' using errcode = '42501';
  end if;

  select e.edition_date into v_earlier from public.stories s join public.editions e on e.id = s.edition_id where s.id = new.earlier_story;
  select e.edition_date into v_later from public.stories s join public.editions e on e.id = s.edition_id where s.id = new.later_story;
  if v_earlier is null or v_later is null then
    raise exception 'Both stories must exist.';
  end if;
  if v_earlier >= v_later then
    raise exception 'A follow-up must come from a later edition than the story it updates (% is not after %).', v_later, v_earlier;
  end if;

  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.status := 'pending';           -- approval is always a separate, deliberate step
    new.approved_by := null;
    new.approved_at := null;
    return new;
  end if;

  -- Changing what is linked, or why, withdraws any approval: the new version must be approved again.
  if (new.earlier_story, new.later_story, new.explanation, new.source_url) is distinct from (old.earlier_story, old.later_story, old.explanation, old.source_url) then
    new.status := 'pending';
    new.approved_by := null;
    new.approved_at := null;
  elsif new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := (select auth.uid());
    new.approved_at := now();
  elsif new.status = 'pending' then
    new.approved_by := null;
    new.approved_at := null;
  else
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end $$;

create trigger story_followups_guard before insert or update on public.story_followups
for each row execute function public.guard_story_followup();

alter table public.story_followups enable row level security;
revoke all on public.story_followups from anon, authenticated;
grant select, insert, delete on public.story_followups to authenticated;
grant update (earlier_story, later_story, explanation, source_url, status) on public.story_followups to authenticated;

create policy "editors read follow-ups" on public.story_followups
  for select to authenticated using ((select public.is_editor()));
create policy "editors add follow-ups" on public.story_followups
  for insert to authenticated with check ((select public.is_editor()));
create policy "editors change follow-ups" on public.story_followups
  for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()));
create policy "editors remove follow-ups" on public.story_followups
  for delete to authenticated using ((select public.is_editor()));

-- What readers can see: approved, and both ends visible to the public (published, primary, not in the future).
create view public.public_followups with (security_invoker = false) as
  select
    f.id, f.explanation, f.source_url,
    es.id as earlier_story_id, ee.edition_date as earlier_date, es.position as earlier_position, es.headline as earlier_headline,
    ls.id as later_story_id, le.edition_date as later_date, ls.position as later_position, ls.headline as later_headline
  from public.story_followups f
  join public.public_stories es on es.id = f.earlier_story
  join public.public_editions ee on ee.id = es.edition_id
  join public.public_stories ls on ls.id = f.later_story
  join public.public_editions le on le.id = ls.edition_id
  where f.status = 'approved';

grant select on public.public_followups to anon, authenticated;
