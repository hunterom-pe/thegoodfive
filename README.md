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

Two AI calls per run, at most 4 runs per date, one run at a time.

### Photography
Each drafted story gets an image decision, and **nothing reaches readers unapproved**:
- **The article's own image** (Open Graph, Twitter card, JSON-LD, or the feed's media field) is stored as a *candidate* with its origin. Finding it grants no right to publish it: it is never auto-approved (a database function enforces this), and shows as **NOT APPROVED** in the editor until you confirm you have permission.
- **A licensed photo from Unsplash** is chosen from a search the writer-AI proposes from the story's actual subject (never a person's name; for stories about a specific person it avoids people entirely). It is labelled *Illustrative photo* with credit to the photographer and Unsplash, and cleared because Unsplash's licence covers that photo.
- **Otherwise** the story keeps the geometric artwork.

Unsplash rules followed (checked November 2026): hotlinked URLs with `ixid` kept; photographer and Unsplash credited with `utm_source=thegoodfive&utm_medium=referral` links; the download endpoint is called when a photo is chosen (by the pipeline, and by `editor-image-download` when you pick another Unsplash photo in the editor). Their guidelines ask for a "non-automated" experience: every edition is reviewed and published by a person. Once the site is live, apply for production access in your Unsplash app (free) to lift the 50/hour demo limit.

Setup: run `supabase/migrations/20261114000000_image_provenance.sql`, then add `UNSPLASH_ACCESS_KEY` (see `.env.example`) locally and on Netlify.

**Entry points**
- **Generate Today's Five** button on the editor dashboard → `netlify/functions/editor-generate` (verifies your login and editor status on the server) → `generate-draft-background` (up to 15 min).
- **Daily schedule**: `netlify/functions/daily-draft`, cron `0 11 * * *` UTC = 4 a.m. in America/Phoenix (no daylight saving). Adjust if you change `EDITION_TIMEZONE`.
- **From your machine**: `npm run draft` (dry run, saves nothing) or `npm run draft -- --save`.

**Setup**
1. Run `supabase/migrations/20261113000200_generated_drafts.sql` in the SQL Editor (after the first two).
2. Add the server secrets from `.env.example` (`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `GENERATION_SECRET`) to Netlify and to `.env.local`.
3. Deploy. Functions only run on Netlify (or locally via `npx netlify dev`); the plain `npm run dev` server can't run them.

Check a run's outcome in the `discovery_runs` table (status, counts, error).

## Automatic publishing (Phase 5)

The site can publish itself. **It is off until you switch it on**, and your manual editor works exactly as before either way.

### The daily schedule (America/Phoenix; Arizona has no daylight saving, so these UTC times never change)
| Phoenix | UTC cron | What | Function |
|---|---|---|---|
| 4:00 AM | `0 11 * * *` | Find news, fact-check, write the draft | `daily-draft` |
| 5:00 AM | `0 12 * * *` | Retry, only if there is no draft (costs nothing otherwise) | `daily-draft-retry` |
| 7:00 AM | `0 14 * * *` | Verify and publish | `daily-publish` |
| 8:00 AM | `0 15 * * *` | Publish retry, harmless if 7:00 AM succeeded | `daily-publish-retry` |

### What must be true before anything publishes itself
Every story is re-checked at 7:00 AM from the source text stored with it (so a manual edit is verified, not trusted). An edition publishes only if **exactly five** stories pass all of this, otherwise **nothing** is published and the latest edition stays on the site with its real date:
- a real `https` link to a source on the trusted list (`server/pipeline/sources.ts` plus `EXTRA_TRUSTED_DOMAINS`), re-fetched to confirm the article is still reachable and has not redirected elsewhere;
- a source date within five days, and never an article that ran in the last 30 days of editions;
- at least 450 characters of retrieved source text;
- every figure, month, quotation and capitalised name in the headline and summary found in that source text, and at least 60% of the summary's wording traceable to it;
- early-stage science and health findings stated with qualification, and no "cure"/"breakthrough"/"miracle" headlines;
- positive, specific, general-audience wording, with no near-duplicate stories in the five.

Failed stories are replaced by backups; rejected ones are recorded with the reason and shown in the dashboard.

**What this proves, and what it does not.** These are deterministic checks against the publisher's own text: they prove the summary is *traceable to the cited article*, not that the article is true. An AI score is never treated as proof. A wrong claim made by a trusted publisher would pass. That is the trade-off of publishing without a human reading it.

### Safe by design
- Publishing goes through `auto_publish_edition()`, executable **only by the service role**: atomic, one edition per date, and a repeat or a simultaneous run returns `already_published`. It refuses a future date, an edition an editor marked **In review** (that is how you hold a day), an article repeated within the edition or the last 30 days, and any story failing the structural rules. Published editions stay locked.
- No public endpoint can publish. The Netlify functions that can run it are scheduled-only; the editor ones verify an editor's login on the server.
- Unsplash's API terms ask for non-automated use, so unattended runs **never search for or show an Unsplash photo**: a scheduled edition uses the geometric artwork. You choose photos yourself in the editor (a photo search per story). An Unsplash photo you did not personally approve is also withheld from automatically published editions. Publisher images (`og:image`) are only ever candidates for you to approve by hand.
- A published edition can still get a photo later, without changing a word, through the same editor panel (`set_story_image` changes only image fields).

### Turn it on
1. Run the new migration `supabase/migrations/20261115000000_auto_publish.sql` in the Supabase SQL Editor.
2. In Netlify, add `AUTO_PUBLISH_ENABLED` = `true`. Optionally `ALERT_WEBHOOK_URL` (for failure alerts) and `EXTRA_TRUSTED_DOMAINS`. Redeploy.
3. Check it first: in `/editor` the **Automation** panel shows the state, and **Check today's edition now** runs every check on today's draft and tells you the result without publishing anything.

To pause for a day, set the edition to **In review**. To stop entirely, set `AUTO_PUBLISH_ENABLED` to `false`.

### Watching it
The editor dashboard's **Automation** panel shows whether it is on, the last publication (automatic or by hand), the next scheduled runs, today's draft and publication results, accepted and rejected counts, every story turned away and why, and any error. The `publish_runs` and `discovery_runs` tables hold the full history.
