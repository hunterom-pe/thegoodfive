\set QUIET on
\pset tuples_only on
-- Expects shim + all four migrations on a fresh database.
insert into auth.users values ('00000000-0000-0000-0000-00000000000e','editor@x');
insert into public.editors (user_id) values ('00000000-0000-0000-0000-00000000000e');

create temp table payload as
select jsonb_agg(
  jsonb_build_object('role','primary','position',n,'category','nature','headline','H'||n,'summary','S','source_name','Src',
    'source_url','https://example.org/'||n,'discovered_via','RSS: T','ai_rationale','r','claims_to_check','[]'::jsonb)
  || case n
    -- 1: licensed Unsplash photo, auto-cleared
    when 1 then jsonb_build_object('image_url','https://images.unsplash.com/photo-1?ixid=a','image_alt','reef','image_credit','Jane Doe','image_credit_url','https://unsplash.com/@jane?utm_source=thegoodfive&utm_medium=referral','image_license','Unsplash License','image_kind','illustrative','image_source','unsplash','image_source_url','https://unsplash.com/photos/1','image_rights_confirmed',true)
    -- 2: publisher image, pipeline CLAIMS it is cleared (must be stored unapproved)
    when 2 then jsonb_build_object('image_url','https://publisher.example/lead.jpg','image_kind','original','image_source','og:image','image_credit','Publisher','image_rights_confirmed',true)
    -- 3: Unsplash but not marked cleared
    when 3 then jsonb_build_object('image_url','https://images.unsplash.com/photo-3?ixid=c','image_kind','illustrative','image_source','unsplash','image_rights_confirmed',false)
    -- 4: candidates only
    when 4 then jsonb_build_object('image_candidates','[{"url":"https://publisher.example/x.jpg","kind":"original","source":"og:image"}]'::jsonb)
    else '{}'::jsonb end) as j
from generate_series(1,5) n;
grant select on payload to service_role, authenticated, anon;

\echo '--- 1. create the draft with images (expect t)'
set role service_role;
select public.create_draft_edition('2026-12-10', (select j from payload)) is not null;
reset role;
\echo '--- 2. approval state stored: licensed photo cleared, publisher image NOT (expect 1:t 2:f 3:f 4:f 5:f)'
select position||':'||image_rights_confirmed from public.stories order by position;
\echo '--- 3. candidates stored (expect 1)'
select jsonb_array_length(image_candidates) from public.stories where position = 4;
\echo '--- 4. nothing is public until published (expect 0)'
set role anon; select count(*) from public.public_stories; reset role;
\echo '--- 5. editor publishes; readers get ONLY the approved photo (expect 1 row with kind, then 4 with none)'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.set_edition_status(id,'published') from public.editions;
reset role;
set role anon;
select position, image_url is not null as has_image, image_kind, image_license, image_credit, image_credit_url is not null as has_credit_link from public.public_stories order by position;
\echo '--- 6. publisher image data never leaks through the view (expect 0 rows mentioning publisher.example)'
select count(*) from public.public_stories where image_url like '%publisher.example%' or image_source_url like '%publisher.example%';
reset role;
\echo '--- 7. unpublish, editor approves the publisher image explicitly, republish, readers see it'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.set_edition_status(id,'review') from public.editions;
update public.stories set image_rights_confirmed = true where position = 2 returning position;
select public.set_edition_status(id,'published') from public.editions;
reset role;
set role anon; select position, image_kind from public.public_stories where image_url is not null order by position; reset role;
\echo '--- 8. cannot approve a story that has no image (expect error)'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.set_edition_status(id,'review') from public.editions;
update public.stories set image_rights_confirmed = true where position = 5;
\echo '--- 9. editor can remove an image and edit credits (expect 1 row)'
update public.stories set image_url = null, image_rights_confirmed = false, image_kind = null where position = 2 returning position;
update public.stories set image_credit_url = 'javascript:alert(1)' where position = 1;
\echo '--- 10. anon cannot touch the new columns'
reset role; set role anon;
update public.stories set image_rights_confirmed = true;
reset role;
\echo '--- 11. a story with an image that is not approved stays hidden after republish'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.set_edition_status(id,'published') from public.editions;
reset role; set role anon; select count(*) from public.public_stories where image_url is not null; reset role;
