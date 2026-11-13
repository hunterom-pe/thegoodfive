# The Good Five

Five good things. Every day. React + Vite + TypeScript + Tailwind, with Supabase for data and sign-in, hosted on Netlify.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build
npm test         # unit tests
```

With no `.env.local`, the site runs in **demo mode**: sample stories (clearly labelled), and the editor works against local browser storage. Nothing there is real news.

## Connect Supabase (Phase 2)

1. Create a project at supabase.com.
2. **SQL Editor** → run, in order, the files in `supabase/migrations/`:
   `20261113000000_init.sql`, `20261113000100_editorial_controls.sql`, then `20261113000200_generated_drafts.sql`
   (or `supabase db push` with the Supabase CLI).
3. **Authentication → Users → Add user**: create your editor account (email + password). Turn off public sign-ups under Authentication → Sign In / Providers, since only you need an account.
4. **Authorise yourself as an editor.** Signing in alone grants nothing. In the SQL Editor:
   ```sql
   insert into public.editors (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
5. Copy `.env.example` to `.env.local` and fill in the Project URL and anon key. Restart `npm run dev`.
6. On Netlify, add the same variables, then deploy. `netlify.toml` handles routing and headers.

Open `/editor`, sign in, press **Create draft**, add five stories (and up to three backups), preview, then **Approve & publish**.

## How it's protected

- Readers use only two database views, `public_editions` and `public_stories`, which expose published editions and their five running stories, nothing else. The tables themselves are closed to anonymous users.
- Editors must be in the `editors` table. Every policy and function checks `is_editor()` in the database; hiding buttons is not the safeguard.
- Publishing (`set_edition_status`) is one transaction: it refuses unless there are exactly five complete primary stories with a valid source link, and it refuses to publish twice.
- A published edition is frozen by a database trigger. To correct it, unpublish, edit, and republish.
- The browser only ever holds the anon key. The service-role key is never used in this app.

Security checks are in `supabase/tests/` (run against a local Postgres with `local_shim.sql` standing in for Supabase's auth schema).

## AI drafts and the daily schedule (Phase 3)

Every morning (and on demand) the app prepares an **unpublished draft**: five stories plus three backups, which you review in `/editor` like any other edition. It never publishes.

How a run works (`server/pipeline/`):
1. **Discover**: 13 curated RSS feeds (`feeds.ts`) plus GDELT searches, last 72 hours.
2. **Narrow**: remove duplicates and anything used in the last 30 days, then take up to 60 candidates, sharing the pool across sources.
3. **Screen** (AI call 1): headline and excerpt only. Rejects promotional pieces, tragedy-as-good-news, clickbait and thin claims.
4. **Read**: fetch the top 14 articles (respecting `robots.txt`). A story without enough source text is dropped.
5. **Write** (AI call 2): choose five plus three and write headlines and summaries using only the retrieved text.
6. **Verify in code**: a quotation that isn't in the source drops the story; a figure that isn't in the source is flagged under "Claims to verify"; preliminary research is flagged.
7. **Save** through `create_draft_edition`, which fills an empty draft or creates one, and does nothing if the edition is published or already has stories.

Two AI calls per run, at most 4 runs per date, one run at a time. Images are never taken from publishers; stories use the square-composition fallback unless you add a photo you have rights to.

**Entry points**
- **Generate Today's Five** button on the editor dashboard → `netlify/functions/editor-generate` (verifies your login and editor status on the server) → `generate-draft-background` (up to 15 min).
- **Daily schedule**: `netlify/functions/daily-draft`, cron `0 11 * * *` UTC = 4 a.m. in America/Phoenix (no daylight saving). Adjust if you change `EDITION_TIMEZONE`.
- **From your machine**: `npm run draft` (dry run, saves nothing) or `npm run draft -- --save`.

**Setup**
1. Run `supabase/migrations/20261113000200_generated_drafts.sql` in the SQL Editor (after the first two).
2. Add the server secrets from `.env.example` (`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `GENERATION_SECRET`) to Netlify and to `.env.local`.
3. Deploy. Functions only run on Netlify (or locally via `npx netlify dev`); the plain `npm run dev` server can't run them.

Check a run's outcome in the `discovery_runs` table (status, counts, error).
