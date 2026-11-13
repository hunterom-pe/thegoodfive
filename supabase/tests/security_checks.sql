\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
insert into auth.users values ('00000000-0000-0000-0000-00000000000e','editor@x'),('00000000-0000-0000-0000-00000000000f','stranger@x');
insert into public.editors (user_id) values ('00000000-0000-0000-0000-00000000000e');

\echo '--- service role creates a draft (5 + 3)'
set role service_role;
select public.create_draft_edition('2026-11-13', (
  select jsonb_agg(jsonb_build_object('role', case when n<=5 then 'primary' else 'backup' end, 'position', case when n<=5 then n else n-5 end,
   'category','nature','headline','H'||n,'summary','S'||n,'source_name','Src','source_url','https://example.org/'||n,
   'ai_rationale','secret note','claims_to_check', '["a"]'::jsonb)) from generate_series(1,8) n)) is not null as created;
\echo '--- retry is a no-op (expect t = returned null)'
select public.create_draft_edition('2026-11-13', '[]'::jsonb) is null as skipped;
select count(*) as editions from public.editions;
reset role;

\echo '--- anon: tables denied, views empty while draft'
set role anon;
select count(*) from public.stories;
select count(*) from public.editions;
select count(*) as public_editions from public.public_editions;
select count(*) as public_stories from public.public_stories;
select public.set_edition_status((select id from public.public_editions limit 1), 'published');
select public.create_draft_edition('2026-11-14', '[]'::jsonb);
reset role;

\echo '--- signed-in non-editor: sees nothing, cannot publish or edit'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select count(*) as stories_visible from public.stories;
update public.stories set headline = 'hacked'; 
select count(*) from public.editions;
reset role;
select public.is_editor() as superuser_is_editor;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select public.set_edition_status('00000000-0000-0000-0000-000000000000', 'published');
select public.create_draft_edition('2026-11-14', '[]'::jsonb);
reset role;

\echo '--- editor: reads all, edits words, cannot touch role/status directly'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select count(*) as stories_visible from public.stories;
update public.stories set headline = 'Edited' where headline = 'H1' returning headline;
update public.stories set role = 'primary', position = 1 where headline = 'H6';
update public.editions set status = 'published', published_at = now();
\echo '--- editor: reorder (swap 1 and 2), swap in backup 6 for 3, reject 3 via omission'
select public.set_lineup(e.id,
  array(select id from public.stories where headline in ('H2') ) || array(select id from public.stories where headline = 'Edited') || array(select id from public.stories where headline = 'H6') || array(select id from public.stories where headline = 'H4') || array(select id from public.stories where headline = 'H5'),
  array(select id from public.stories where headline in ('H7','H8') order by headline),
  (select id from public.stories where headline = 'H3'), 'Misleading') from public.editions e;
select headline, role, position, rejected_reason from public.stories order by role, position;
\echo '--- editor: publishing with only four is refused'
select public.set_lineup(e.id, array(select id from public.stories where role='primary' and position < 5 order by position), '{}') from public.editions e;
select public.set_edition_status(id, 'published') from public.editions;
\echo '--- editor: six is refused; then restore five and publish'
select public.set_lineup(e.id, array(select id from public.stories order by headline limit 6), '{}') from public.editions e;
select public.set_lineup(e.id, array(select id from public.stories where headline in ('H2','Edited','H6','H4','H5') order by headline), '{}') from public.editions e;
select public.set_edition_status(id, 'review') from public.editions;
select status from public.editions;
select public.set_edition_status(id, 'published') from public.editions;
select status, published_at is not null as stamped from public.editions;
\echo '--- editor: lineup is locked once published'
select public.set_lineup(e.id, '{}', '{}') from public.editions e;
update public.stories set image_url = 'https://img/x.jpg', image_credit = 'Someone' where headline = 'H2';
reset role;

\echo '--- anon after publish: five stories, no image without rights, no editorial columns'
set role anon;
select count(*) as public_editions from public.public_editions;
select position, headline, image_url is null as image_hidden from public.public_stories order by position;
select ai_rationale from public.public_stories limit 1;
select count(*) from public.stories;
reset role;
\echo '--- unpublish hides it again'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.set_edition_status(id, 'draft') from public.editions;
reset role; set role anon;
select count(*) as public_stories from public.public_stories;
reset role;
\echo '--- discovery lock: second running row for a date is refused'
insert into public.discovery_runs (edition_date, status) values ('2026-11-14','running');
insert into public.discovery_runs (edition_date, status) values ('2026-11-14','running');
