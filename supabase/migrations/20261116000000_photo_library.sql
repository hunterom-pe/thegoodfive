-- ── An editor-curated photo library ─────────────────────────────────────────
-- Why this exists: automatic editions need relevant, properly licensed photos, but Unsplash's
-- API guidelines ask for non-automated use (the term is not defined, and nothing in the
-- published terms says whether a scheduled job may search). So a PERSON searches and chooses
-- photos in the editor, once, and saves them here. Scheduled editions then choose from this
-- library by category and subject, without any search of Unsplash. Every photo keeps its
-- photographer credit, its Unsplash links and its original (hotlinked) URL.
create table public.photo_library (
  id uuid primary key default gen_random_uuid(),
  unsplash_id text not null unique,            -- the photo's id at Unsplash: one row per photo
  url text not null check (url ~ '^https://images\.unsplash\.com/'),
  alt text not null check (length(trim(alt)) > 0),
  credit text not null,                        -- photographer
  credit_url text not null check (credit_url ~ '^https://unsplash\.com/'),
  source_url text not null check (source_url ~ '^https://unsplash\.com/'),
  download_location text,                      -- Unsplash's event endpoint, kept to report each use
  categories public.story_category[] not null default '{}',
  keywords text[] not null default '{}',       -- subject words an editor chose; used to match stories
  generic boolean not null default false,      -- a good all-round picture for its categories
  shows_people boolean not null default false, -- never used for a story about a specific person
  active boolean not null default true,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  last_used_on date,
  use_count integer not null default 0
);

create index photo_library_active_idx on public.photo_library (active) where active;

alter table public.photo_library enable row level security;

create policy "editors read the photo library" on public.photo_library
  for select to authenticated using ((select public.is_editor()));
create policy "editors add to the photo library" on public.photo_library
  for insert to authenticated with check ((select public.is_editor()));
create policy "editors change the photo library" on public.photo_library
  for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()));
create policy "editors remove from the photo library" on public.photo_library
  for delete to authenticated using ((select public.is_editor()));

-- The public site never reads the library: only the stories it was copied onto.
revoke all on public.photo_library from anon;
grant select, insert, update, delete on public.photo_library to authenticated;
