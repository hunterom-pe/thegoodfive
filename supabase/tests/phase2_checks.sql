\set QUIET on
\pset tuples_only on
-- Expects the shim and both migrations applied to a fresh database.
insert into auth.users values ('00000000-0000-0000-0000-00000000000e','editor@x'),('00000000-0000-0000-0000-00000000000f','stranger@x');
insert into public.editors (user_id) values ('00000000-0000-0000-0000-00000000000e');

\echo '--- stranger (signed in, not an editor): cannot create or add'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select public.create_edition('2026-12-01');
select public.add_story('00000000-0000-0000-0000-000000000000','primary','nature','h','s','n','https://x.org');
select count(*) as editions_seen from public.editions;
reset role;
\echo '--- anon: cannot create or add'
set role anon;
select public.create_edition('2026-12-01');
reset role;

\echo '--- editor: create edition, duplicate date refused'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.create_edition('2026-12-01') is not null as created;
select public.create_edition('2026-12-01');

\echo '--- editor: add 5 primaries then 6th primary refused; add backup'
select public.add_story(e.id,'primary','nature','Headline '||n,'Summary '||n,'Paper','https://example.org/'||n) is not null from public.editions e, generate_series(1,5) n;
select public.add_story(id,'primary','nature','Sixth','S','Paper','https://example.org/6') from public.editions;
select public.add_story(id,'backup','health','Backup','S','Paper','https://example.org/b') is not null from public.editions;
\echo '--- bad input refused: non-http url, javascript url, blank headline, bad image'
select public.add_story(id,'backup','health','H','S','Paper','ftp://example.org') from public.editions;
select public.add_story(id,'backup','health','H','S','Paper','javascript:alert(1)') from public.editions;
select public.add_story(id,'backup','health','','S','Paper','https://x.org') from public.editions;
select public.add_story(id,'backup','health','H','S','Paper','https://x.org', null, 'data:text/html,x') from public.editions;
select role, position, headline from public.stories order by role, position;

\echo '--- publish succeeds once, never twice'
select public.set_edition_status(id,'published') from public.editions;
select status, published_at is not null as stamped from public.editions;
select published_at as first_stamp from public.editions \gset
select public.set_edition_status(id,'published') from public.editions;
select (published_at = :'first_stamp') as stamp_unchanged from public.editions;

\echo '--- published edition is frozen: edit, add, delete, lineup all refused'
update public.stories set headline = 'Rewritten' where headline = 'Headline 1';
select public.add_story(id,'backup','health','Late','S','Paper','https://x.org') from public.editions;
select public.set_lineup(id, '{}', '{}') from public.editions;
reset role;
\echo '--- even a superuser-level direct write is blocked by the trigger'
update public.stories set headline = 'Rewritten' where headline = 'Headline 1';
delete from public.stories where headline = 'Headline 1';
select headline from public.stories where position = 1 and role = 'primary';

\echo '--- controlled correction: unpublish, edit, republish'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.set_edition_status(id,'review') from public.editions;
update public.stories set headline = 'Corrected' where headline = 'Headline 1' returning headline;
select public.set_edition_status(id,'published') from public.editions;
select status from public.editions;
reset role;

\echo '--- anon sees only the published five, in order, with no editorial columns'
set role anon;
select position, headline from public.public_stories order by position;
select count(*) as backups_visible from public.public_stories where headline = 'Backup';
select count(*) from public.stories;
reset role;

\echo '--- incomplete edition cannot be published; reject then delete'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.create_edition('2026-12-02') as d2 \gset
select public.add_story(:'d2','primary','nature','Only one','S','Paper','https://x.org/1') is not null;
select public.set_edition_status(:'d2','published');
select public.delete_story(id) from public.stories where headline = 'Only one';
select public.set_lineup(:'d2', '{}', '{}', (select id from public.stories where headline = 'Only one'), 'test');
select public.delete_story(id) from public.stories where headline = 'Only one';
select count(*) as stories_left from public.stories where edition_id = :'d2';
reset role;

