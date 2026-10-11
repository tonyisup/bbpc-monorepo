# BBPC show format

What anyone judging a BBPC episode needs to know about the show. Cowork reads
it before writing the movie and SEO files (`docs/cowork-handoff.md`); later
judgment outputs (T-shirt phrases, clip rubric) read it too. Keep show
knowledge here, not in prompts or hand-off instructions, so there is one copy.

Facts are taken from the public site (`apps/web`: About, Game rules, rating
icons) and from 2026 transcripts. Where they disagree, both are recorded.

## Hosts

- **Fonzo**, a.k.a. **Mike Lowry** (Lowrey in the film): opens every episode ("I am your host,
  Fonzo, a.k.a. Mike Lowry"). The site spells it **Fonso**.
- **Harley**, a.k.a. **Marcus Burnett**: Fonzo's friend since the 1990s.
  The alias is often garbled ("Marcus Brunette").
- **Tony**, a.k.a. **MCP**: joined after building the show's website. The
  alias is often transcribed **MCB** or **MZP**.

The aliases are the two detectives from *Bad Boys*, hence the show's name.
Speakers are not labelled in transcripts: infer them from context, the intro
roll call, and who is addressed by name.

In `hostRatings` and `pickedBy`, use `Fonzo`, `Harley` and `Tony`. Files
written before this reference used `MCB` for Tony.

## Episode structure

Roughly in this order, though tangents move things around:

1. Intro roll call and banter. Weekend and life stories often start here.
2. **Extras**: movies or shows one host watched on their own, each given a
   rating (`extra_review`).
3. **Games**: Mount Rushmore (each host names picks in a category, such as
   villains or vampires) and **Quotabunga** (listener quote bracket).
4. **Homework**: the assigned movie, reviewed by all three (`homework`).
5. Listener rating predictions for the homework are scored.
6. **Extra credit**: the second assigned movie (`extra_credit`), then its
   predictions are scored.
7. The **wheel** spins to pick next week's homework and extra credit from a
   host's or listener's **syllabus** (their list of movie picks). Sometimes
   two homework movies are assigned ("double homework").
8. Weekends, listener messages, outro.

## Rating scale

Best to worst. The site stores the value; hosts say the on-air name.

| Value | Site name | On air |
|---|---|---|
| 4 | Slater | "a Slater" |
| 3 | Dollar | "a dollar", "a high dollar" ("I'd buy that for a dollar", *RoboCop*) |
| 2 | Waste | "a waste of time", "a waste" |
| 1 | Goldblum (admin: "Goldbloom") | "a pile of shit", "the Goldblum" |

In `hostRatings`, keep using the on-air names Cowork already writes:
`Slater`, `Dollar`, `Waste of Time`, `Pile of Shit`.

## Listener game

Listeners play across a season. The season winner picks a movie and joins the
hosts to discuss it.

- **Rating predictions**: for each assigned movie, listeners predict every
  host's rating. On air, a correct host rating is called as 10 points;
  "pain train" means every guess was wrong. Use the scoring segment to
  confirm who gave what: it repeats each host's rating several times. The
  site shows the current point values (`correctHost`, `allCorrectBonus`,
  `allIncorrect`).
- **Quotabunga**: each listener submits one movie or TV quote a week. With
  four entries the hosts play two semifinals and a final; first, second and
  third place earn 40, 20 and 10 points.
- **Bonus points**: a committed accent or impersonation can earn a point at
  the Game Master's discretion.

## Not reviews

These mention movies but are not reviews. In the movie file, list them as
`rejected` candidates with a `note`:

- Quotabunga quote clips.
- Mount Rushmore picks.
- Next week's homework and extra credit from the wheel spin.
- Comparisons ("feels like Evil Dead"), director filmographies, sequels and
  originals mentioned during a review.
- TV series. Shows can be rated as extras, but they are not movies.
- Studio logos and theme music.

## Transcription garbles

Parakeet transcripts are unpunctuated speech with no speaker labels. Common
mishearings:

- Ratings: "a palace" or "the gold bloom" = Pile of Shit / Goldblum.
- Tony's alias: MCB, MZP = MCP.
- Harley's alias: Marcus Brunette = Marcus Burnett.
- Quotabunga: "quarter bunga", "quota bunga".
- Listener names vary between mentions (Raina, Reina, Reyna). Use the most
  common spelling in the episode.

## What gets published

Tony reviews the rendered clips and posts the ones he likes as YouTube Shorts
on `@badboyspodcast`. Shorts published from pipeline episodes so far:

| Episode | Short | Bit | Length |
|---|---|---|---|
| 771 | "Marcus Fritas!" | Intro roll call: Harley's alias riffed into "Papas Fritas" | 37 s |
| 772 | "Genteman" | One "polite gentleman" line during a review | 25 s |
| 772 | "Mopey" | "Mopey? Emo zombies?" zombie sub-genre riff | 23 s |
| 772 | "Bingo Card" | Not in the pipeline's candidates | 37 s |
| 773 | "Big Bulp" | "Big gulps, huh?" riff | 62 s |
| 785 | "Lots of Love" | Probably a laughter moment (unconfirmed) | 32 s |
| 793 | "Eggs Bit" | Tony ate five eggs a day | 47 s |
| 794 | "Por Diós!" | Tony watched *Mimic* dubbed in Spanish without noticing | 54 s |

Patterns so far (eight Shorts, too few to be rules):

- **One joke, named by its catchphrase.** Each Short is a single bit that
  can be named in one to three words. None is a review summary or a
  back-and-forth debate.
- **Host mishaps, confessions and wordplay** outnumber movie talk. When a
  movie is involved, the bit is about what happened to a host (*Mimic* in
  Spanish), not about the movie.
- **Short.** Published Shorts run 23–62 s; rendered clips that were not
  published ran 55–92 s. Within the 20–90 s range, prefer the shorter cut
  that keeps the setup and the payoff.
- **Debates weren't picked.** Rendered picks such as the *Young Guns II* /
  Viggo discussion or *The Thomas Crown Affair* title argument were not
  published.

Views on these Shorts (3–140) are too low to say which bits perform. Treat
the list as Tony's taste, not as performance data.

Tony titles published Shorts for organization (`Bad Boys Podcast - <ep#> -
<ep title> - <bit>`). Keep clip `headline`s descriptive, as Cowork writes
them now; don't rewrite them as catchphrases or for virality.
