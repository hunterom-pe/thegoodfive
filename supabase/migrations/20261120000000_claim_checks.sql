-- ── Claim checks stored with each draft story ───────────────────────────────
-- The claim check used to run only at 7:00 AM, inside a scheduled function with about 30 seconds in total. On
-- 16 November the AI provider answered part of a burst with "503 overloaded", the check ran out of time and the
-- edition was held. Now the 4:00 AM draft run (a background function, minutes to spare) checks every story and
-- stores the result here, with the fingerprint of the text it read. At 7:00 AM the publisher reuses a stored
-- result only while that fingerprint still matches the story; anything edited since is checked again.
--
-- Written only by the server (service role). Editors cannot set it: no grant, so it cannot be used to mark a
-- story "verified" by hand. Readers never see it (the public views list their columns explicitly).
-- Order: apply this, then deploy the code. (Code deployed first still publishes: it falls back to checking at
-- 7:00 AM, with the new deadline handling.) Rollback: supabase/rollbacks/20261120000000_claim_checks_down.sql.
alter table public.stories add column if not exists claim_check jsonb;
comment on column public.stories.claim_check is
  'Claim check run at draft time: {verdict, issues, unavailable?, hash, checkedAt}. Valid only while hash = the story''s content fingerprint (version 2).';
