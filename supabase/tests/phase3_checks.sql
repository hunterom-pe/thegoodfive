\set QUIET on
\pset tuples_only on
-- Expects shim + all three migrations on a fresh database.
insert into auth.users values ('00000000-0000-0000-0000-00000000000e','editor@x');
insert into public.editors (user_id) values ('00000000-0000-0000-0000-00000000000e');

create temp table payload as
select jsonb_agg(jsonb_build_object('role', case when n<=5 then 'primary' else 'backup' end, 'position', case when n<=5 then n else n-5 end,
  'category','science','headline','AI '||n,'summary','S','source_name','Src','source_url','https://example.org/ai/'||n,
  'source_published_at','2026-11-12T10:00:00Z','original_title','T','original_excerpt','E','discovered_via','RSS: Test',
  'ai_rationale','why','claims_to_check','["check me"]'::jsonb)) as j from generate_series(1,8) n;
grant select on payload to service_role, authenticated, anon;

\echo '--- 1. no edition yet: creates draft with 5 + 3 (expect t)'
set role service_role;
select public.create_draft_edition('2026-12-05', (select j from payload)) is not null;
reset role;
select status, (select count(*) from public.stories where role='primary') as primaries, (select count(*) from public.stories where role='backup') as backups from public.editions;
\echo '--- 2. retry is a no-op: nothing duplicated, nothing overwritten (expect t, 8)'
set role service_role;
select public.create_draft_edition('2026-12-05', (select j from payload)) is null;
reset role;
select count(*) from public.stories;
\echo '--- 3. editor edit survives a retry (expect Edited by hand)'
update public.stories set headline = 'Edited by hand' where headline = 'AI 1';
set role service_role;
select public.create_draft_edition('2026-12-05', (select j from payload)) is null;
reset role;
select headline from public.stories where position = 1 and role = 'primary';
\echo '--- 4. an empty draft the editor started CAN be filled (expect t, then 8)'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.create_edition('2026-12-06') is not null;
reset role;
set role service_role;
select public.create_draft_edition('2026-12-06', (select j from payload)) is not null;
reset role;
select count(*) from public.stories s join public.editions e on e.id = s.edition_id where e.edition_date = '2026-12-06';
\echo '--- 5. published edition is never touched (expect t)'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.set_edition_status(id,'published') from public.editions where edition_date = '2026-12-05';
reset role;
set role service_role;
select public.create_draft_edition('2026-12-05', (select j from payload)) is null;
reset role;
\echo '--- 6. published but empty edition cannot be filled either (expect t)'
insert into public.editions (edition_date, status, published_at) values ('2026-12-07','published', now());
set role service_role;
select public.create_draft_edition('2026-12-07', (select j from payload)) is null;
reset role;
\echo '--- 7. generated drafts are invisible to readers (expect 1 edition: the published one, 5 stories)'
set role anon;
select count(*) from public.public_editions;
select count(*) from public.public_stories;
reset role;
\echo '--- 8. not callable by anon or signed-in users (expect two errors)'
set role anon;
select public.create_draft_edition('2026-12-09', (select j from payload));
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.create_draft_edition('2026-12-09', (select j from payload));
reset role;
\echo '--- 9. only one running discovery per date'
insert into public.discovery_runs (edition_date, status) values ('2026-12-09','running');
insert into public.discovery_runs (edition_date, status) values ('2026-12-09','running');
