-- Roll back 20261119000000_story_followups.sql. Removes every follow-up relationship (they are not part of any
-- story's text, so no published story changes). Export them first if you may want them back:
--   copy (select * from public.story_followups) to stdout with csv header;   -- or use the Table Editor's export
-- The site keeps working without the view: follow-up links simply stop appearing.
drop view if exists public.public_followups;
drop trigger if exists story_followups_guard on public.story_followups;
drop table if exists public.story_followups;
drop function if exists public.guard_story_followup();
