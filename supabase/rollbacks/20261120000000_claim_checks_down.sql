-- Roll back 20261120000000_claim_checks.sql. Safe with either code version: without the column the publisher
-- checks every story at 7:00 AM (as before). Drops only stored check results; no story text changes.
alter table public.stories drop column if exists claim_check;
