# Proposed correction: 13 November 2026, story 1 (infant seizures)

**Status: proposed only. The live edition has not been changed.**

## What is wrong

The published summary says the infant had "roughly **120** seizures a day". The cited article does not say 120.

| Where | What it says |
|---|---|
| Source headline (Good News Network, Andy Corbley, 13 Nov 2026) | "Infant Goes from **110** Seizures a Day to Seizure-Free with Experimental Treatment" |
| Source body | "From the first day of his life, little infant Adnan has suffered a seizure roughly **every 13 minutes**." (about 110 a day) |
| Our summary | "...who suffered roughly **120** seizures a day from birth..." |

The body never states 110 itself; the headline does, and 1,440 minutes ÷ 13 ≈ 111. So the safest wording is the body's own: one seizure roughly every 13 minutes. "120" appears nowhere in the article. Source: <https://www.goodnewsnetwork.org/infant-goes-from-110-seizures-a-day-to-seizure-free-after-rare-treatment/>. That article credits the Khaleej Times (<https://www.khaleejtimes.com/uae/baby-treatment-seizure-free-kings-college-hospital-london-dubai-abs-1230>), which has not been checked for this note; worth a look before publishing the correction.

Everything else in the summary was checked against the article and is consistent: Dubai; the experimental oral drug ABS-1230; the compassionate-use pathway granted by the Dubai Health Authority; treatment on 14 September; seizure-free and discharged a week later; no clinical seizures at the 11 October follow-up; "more research is needed". One nuance for the editor: the article names the hospital (King's College Hospital London in Dubai) and says the DHA granted the application; the summary's wording ("Granted through a compassionate use pathway by the Dubai Health Authority") is acceptable.

## Proposed replacement (first sentence only; the rest unchanged)

> An infant in Dubai who suffered a seizure roughly every 13 minutes from the first day of his life became seizure-free following the administration of an experimental oral medication called ABS-1230.

(Headline, other sentences, source and links stay as they are. The headline "Experimental drug stops daily seizures in infant" is accurate.)

If you would rather keep a per-day figure, use the source headline's number: "roughly 110 seizures a day".

## Proposed correction note

> **Correction, 15 November 2026:** An earlier version of this summary said the infant had roughly 120 seizures a day. The source article reports about one every 13 minutes (its headline says 110 a day). The summary has been corrected.

## How to apply it (needs your approval)

The database locks published text on purpose, and the site has no correction-note field yet. With what exists today:

1. In the editor, **Unpublish** the 13 November edition (it leaves the site until it is republished).
2. Edit story 1's summary to the replacement above, and save.
3. **Approve & publish** again.
4. There is nowhere to show the note, so put it in the repository's changelog or the About page until a field exists.

That window is short but real. A better fix, if you want one, is a small follow-up: a `correction_note` and `corrected_at` on stories, an editor-only function that changes a published story's text and note atomically without unpublishing, and a line under the story on the site. I have not built it. Say if you want it next.

## Why it got through

This edition predates the claim-level checks. The number gate only asked whether the digits appeared somewhere in the source; it neither knew what the figure counted nor that 120 was absent from the article's text. The new checks flag a figure given with a different unit or rate, and the claim verifier would have to cite a source sentence for "120 seizures a day" and could not. Neither is a guarantee (see About).
