# Proposed correction: 13 November 2026, story 1 (infant seizures)

**Status: prepared only. The production edition has not been changed.** Re-verified 16 November 2026 against the live source.

## What is wrong

The published summary (read from the public site today) says the infant "suffered roughly **120** seizures a day from birth". The cited article does not say 120.

| Where | What it says |
|---|---|
| Source headline (Good News Network, Andy Corbley, 13 Nov 2026) | "Infant Goes from **110** Seizures a Day to Seizure-Free with Experimental Treatment" |
| Source body, first sentence | "From the first day of his life, little infant Adnan has suffered a seizure roughly **every 13 minutes**." (1,440 ÷ 13 ≈ 111 a day) |
| Our summary | "...who suffered roughly **120** seizures a day from birth..." |

Source: <https://www.goodnewsnetwork.org/infant-goes-from-110-seizures-a-day-to-seizure-free-after-rare-treatment/>

**Original reporting not checked.** The article says the story comes via the Khaleej Times (<https://www.khaleejtimes.com/uae/baby-treatment-seizure-free-kings-college-hospital-london-dubai-abs-1230>). That site answers automated requests with HTTP 403, so its figure could not be read here. Someone should open it in a browser before the correction goes live; if it gives a different rate, use that and say so in the note.

Every other claim in the summary matches the article: Dubai; the experimental oral drug ABS-1230; the compassionate-use pathway granted by the Dubai Health Authority (to King's College Hospital London in Dubai's application); treatment on 14 September; no seizure recorded and discharged a week later; no clinical seizures at the 11 October follow-up and seizure-free as of 2 November; "more research" needed. Wording nuance for the editor: the article says the drug "targets abnormal activity in an ion channel", and the summary's "targets an abnormal ion channel" is a slight simplification, left as is.

## Exact corrected summary (story 1; headline, source and links unchanged)

Replace the whole summary with the text below, followed by the visible correction note as a final paragraph. Total length 927 characters (the editor allows 1,800).

```
An infant in Dubai who suffered a seizure roughly every 13 minutes from the first day of his life (the source’s headline puts it at 110 a day) became seizure-free following the administration of an experimental oral medication called ABS-1230. Granted through a compassionate use pathway by the Dubai Health Authority, the treatment targets an abnormal ion channel associated with the patient's rare genetic epilepsy. Following treatment on September 14th, the infant recorded no seizures and was discharged a week later. Medical staff confirmed he remained seizure-free in subsequent follow-ups, though researchers emphasize that more research is needed to determine long-term safety and efficacy.

Correction, 16 November 2026: this summary originally said the infant had roughly 120 seizures a day. The source article reports a seizure about every 13 minutes, and its headline says 110 a day. The summary has been corrected.
```

The first sentence now gives the article's own rate (one every 13 minutes) and points to the headline's 110 a day, instead of a figure the article never states. If you prefer the shorter form, "who suffered roughly 110 seizures a day from birth" is also supported by the headline, but the body's wording is the more direct quote of the rate.

## Visible correction note

The site has no correction-note field and this batch adds no features, so the note is the final paragraph of the summary itself. It then shows with the story on `/edition/2026-11-13#story-1`, in the archive and in share cards, and stays with the story if it is edited again. Change the date to the day you apply it.

```
Correction, 16 November 2026: this summary originally said the infant had roughly 120 seizures a day. The source article reports a seizure about every 13 minutes, and its headline says 110 a day. The summary has been corrected.
```

## Editor steps (needs your login; not done)

1. Check the Khaleej Times article in a browser (see above).
2. In `/editor`, open the 13 November edition and choose **Unpublish**. A published edition's text is locked by a database trigger, and it is not the front-page edition today, so readers of the front page are unaffected. The dated address shows "no edition" until step 4.
3. Open story 1, paste the corrected summary and note from above, save.
4. **Publish** again (manual publish, not the automatic path), then reload `/edition/2026-11-13#story-1` and confirm the text and the note.

The window between steps 2 and 4 is a few minutes. A permanent fix (a `correction_note` column and an editor-only function that corrects published text without unpublishing) is feature work and not part of this batch.

## Why it got through

This edition predates the claim-level checks. The old number gate only asked whether digits appeared somewhere in the source. The newer checks flag a figure given with a different unit or rate, and the claim verifier has to cite a source sentence for each claim. Neither is a guarantee (see About).
