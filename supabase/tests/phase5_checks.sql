\set QUIET on
\pset tuples_only on
-- Expects shim + all migrations on a fresh database. Dates are relative to "now" so the checks never go stale.
insert into auth.users values ('00000000-0000-0000-0000-00000000000e','editor@x');
insert into public.editors (user_id) values ('00000000-0000-0000-0000-00000000000e');

-- helper: build an edition with N stories (6 primary-or-backup candidates), dated today in Phoenix
create function pg_temp.mk(p_date date, p_n int default 8, p_prefix text default 'a') returns uuid language plpgsql as $$
declare v_id uuid;
begin
  v_id := public.create_draft_edition(p_date, (
    select jsonb_agg(jsonb_build_object('role', case when n<=5 then 'primary' else 'backup' end, 'position', case when n<=5 then n else n-5 end,
      'category','science','headline','H '||p_prefix||n,'summary','S','source_name','Src','source_url','https://example.org/'||p_prefix||'/'||n,
      'source_published_at', (now() - interval '10 hours')::text, 'source_material','m', 'discovered_via','RSS','ai_rationale','r'))
    from generate_series(1,p_n) n));
  return v_id;
end $$;
create temp table ctx as select (now() at time zone 'America/Phoenix')::date as today;
grant select on ctx to service_role, authenticated, anon;
grant usage on schema pg_temp to service_role;

\echo '--- 1. service role publishes five valid stories (expect published, then status published with NULL published_by = automatic)'
set role service_role;
select pg_temp.mk((select today from ctx)) as ed \gset
select public.auto_publish_edition(:'ed', (select today from ctx), (select array_agg(id order by position) from public.stories where edition_id = :'ed' and role='primary'));
reset role;
select status, published_at is not null as stamped, published_by is null as automatic from public.editions where id = :'ed';

\echo '--- 2. repeat is a no-op (expect already_published, published_at unchanged = t)'
select published_at as first_stamp from public.editions where id = :'ed' \gset
set role service_role;
select public.auto_publish_edition(:'ed', (select today from ctx), (select array_agg(id order by position) from public.stories where edition_id = :'ed' and role='primary'));
reset role;
select (published_at = :'first_stamp') from public.editions where id = :'ed';

\echo '--- 3. readers see exactly the five, in order'
set role anon; select position||':'||headline from public.public_stories order by position; reset role;

\echo '--- 4. fewer than five chosen (expect error)'
set role service_role;
select pg_temp.mk((select today from ctx) - 1, 8, 'b') as ed2 \gset
select public.auto_publish_edition(:'ed2', (select today from ctx) - 1, (select array_agg(id) from (select id from public.stories where edition_id = :'ed2' limit 4) x));
reset role;
select status from public.editions where id = :'ed2';

\echo '--- 5. wrong date, future edition (expect two errors)'
set role service_role;
select public.auto_publish_edition(:'ed2', (select today from ctx), (select array_agg(id) from (select id from public.stories where edition_id = :'ed2' limit 5) x));
select pg_temp.mk((select today from ctx) + 3, 8, 'f') as edf \gset
select public.auto_publish_edition(:'edf', (select today from ctx) + 3, (select array_agg(id) from (select id from public.stories where edition_id = :'edf' limit 5) x));
reset role;

\echo '--- 6. stale source (older than 7 days) is refused; missing source date is refused; http link is refused'
update public.stories set source_published_at = now() - interval '9 days' where edition_id = :'ed2' and role='primary' and position = 1;
set role service_role;
select public.auto_publish_edition(:'ed2', (select today from ctx) - 1, (select array_agg(id order by position) from public.stories where edition_id = :'ed2' and role='primary'));
reset role;
update public.stories set source_published_at = now() - interval '5 hours' where edition_id = :'ed2' and position = 1 and role='primary';
update public.stories set source_url = 'http://example.org/insecure' where edition_id = :'ed2' and role='primary' and position = 2;
set role service_role;
select public.auto_publish_edition(:'ed2', (select today from ctx) - 1, (select array_agg(id order by position) from public.stories where edition_id = :'ed2' and role='primary'));
reset role;
update public.stories set source_url = 'https://example.org/b/2' where edition_id = :'ed2' and role='primary' and position = 2;
update public.stories set source_url = 'https://example.org/b/1' where edition_id = :'ed2' and role='primary' and position = 2;  -- now a duplicate of story 1
set role service_role;
select public.auto_publish_edition(:'ed2', (select today from ctx) - 1, (select array_agg(id order by position) from public.stories where edition_id = :'ed2' and role='primary'));
reset role;
update public.stories set source_url = 'https://example.org/b/2' where edition_id = :'ed2' and role='primary' and position = 2;

\echo '--- 7. an article that ran in a recent published edition is refused'
update public.stories set source_url = 'https://example.org/a/1?utm_source=x' where edition_id = :'ed2' and role='primary' and position = 3;
set role service_role;
select public.auto_publish_edition(:'ed2', (select today from ctx) - 1, (select array_agg(id order by position) from public.stories where edition_id = :'ed2' and role='primary'));
reset role;
update public.stories set source_url = 'https://example.org/b/3' where edition_id = :'ed2' and role='primary' and position = 3;

\echo '--- 8. an edition an editor marked In review is HELD, not published (expect held)'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.set_edition_status(:'ed2','review');
reset role;
set role service_role;
select public.auto_publish_edition(:'ed2', (select today from ctx) - 1, (select array_agg(id order by position) from public.stories where edition_id = :'ed2' and role='primary'));
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.set_edition_status(:'ed2','draft');
reset role;

\echo '--- 9. replacement: a backup stands in for a rejected primary; rejection recorded (expect published; lineup 1..5; rejected has reason)'
select id as rej from public.stories where edition_id = :'ed2' and role='primary' and position = 2 \gset
select id as bk from public.stories where edition_id = :'ed2' and role='backup' and position = 1 \gset
set role service_role;
select public.auto_publish_edition(:'ed2', (select today from ctx) - 1,
  (select array_agg(id order by ord) from (select id, case when id = :'rej' then 99 else position end as ord from public.stories where edition_id = :'ed2' and role='primary' and id <> :'rej' union all select :'bk'::uuid, 2) q),
  jsonb_build_array(jsonb_build_object('id', :'rej', 'reason', 'numbers not found in source: 42')));
reset role;
select role, position, rejected_reason from public.stories where id = :'rej';
select count(*) as primaries from public.stories where edition_id = :'ed2' and role = 'primary';
select string_agg(position::text, ',' order by position) as slots from public.stories where edition_id = :'ed2' and role = 'primary';

\echo '--- 10. Unsplash photo with no editor approval is withheld by the robot; editor-approved is kept; publisher image never public'
select pg_temp.mk((select today from ctx) - 2, 8, 'c') as ed3 \gset
update public.stories set image_url='https://images.unsplash.com/p1', image_source='unsplash', image_kind='illustrative', image_rights_confirmed=true, image_editor_approved=false where edition_id=:'ed3' and role='primary' and position=1;
update public.stories set image_url='https://images.unsplash.com/p2', image_source='unsplash', image_kind='illustrative', image_rights_confirmed=true, image_editor_approved=true where edition_id=:'ed3' and role='primary' and position=2;
update public.stories set image_url='https://pub.example/x.jpg', image_source='og:image', image_kind='original', image_rights_confirmed=false where edition_id=:'ed3' and role='primary' and position=3;
set role service_role;
select public.auto_publish_edition(:'ed3', (select today from ctx) - 2, (select array_agg(id order by position) from public.stories where edition_id = :'ed3' and role='primary'));
reset role;
set role anon; select position||':'||(image_url is not null) from public.public_stories where headline like 'H c%' order by position limit 3; reset role;

\echo '--- 11. the robot and anonymous / signed-in users cannot publish through the other doors (expect 3 errors)'
set role anon; select public.auto_publish_edition(:'ed3', (select today from ctx), '{}'); reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e'; select public.auto_publish_edition(:'ed3', (select today from ctx), '{}');
update public.editions set status='published' where id = :'ed2'; reset role;

\echo '--- 12. image backfill: an editor can change ONLY image fields on a published edition; text stays locked'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select id as sid from public.stories where edition_id = :'ed3' and role='primary' and position = 4 \gset
select public.set_story_image(:'sid', '{"image_url":"https://images.unsplash.com/p9","image_credit":"Jo","image_kind":"illustrative","image_source":"unsplash","image_rights_confirmed":true,"image_editor_approved":true}'::jsonb);
update public.stories set headline = 'Rewritten' where id = :'sid';
reset role;
select image_url, image_editor_approved, headline from public.stories where id = :'sid';
\echo '--- 13. a non-editor cannot use the image backfill (expect error)'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select public.set_story_image(:'sid', '{"image_url":"https://x.org/a.jpg"}'::jsonb);
reset role;
\echo '--- 14. publish_runs: editors can read, anon cannot'
insert into public.publish_runs (edition_date, status) values ((select today from ctx), 'skipped');
set role anon; select count(*) from public.publish_runs; reset role;
