import type { ScorecardCriterion } from "./scorecard";

/**
 * One caption per score, 1-10, for each criterion's illustration ladder. The
 * images live at /scorecard/<criterion>/<NN>.webp; see
 * docs/scorecard-illustration-ladders.md for how they were made.
 */
export const SCORECARD_ILLUSTRATION_CAPTIONS: Record<
  ScorecardCriterion,
  readonly string[]
> = {
  story: [
    "Two stick figures, standing there.",
    "At least they're walking and talking.",
    "There's a mountain. They're headed for it.",
    "Real people now, backpacks on.",
    "A fork in the path, and he's pointing the wrong way.",
    "A wobbly rope bridge over a ravine.",
    "A storm on the switchbacks; he hauls her up.",
    "Night camp below the summit. X marks the spot.",
    "The final ridge at sunrise.",
    "Flag on the summit, above the clouds.",
  ],
  performance: [
    "Reading flatly off the page.",
    "Wooden. Very wooden.",
    "Paper-bag masks doing the acting.",
    "School play. Someone forgot their line.",
    "Community theater: polite applause.",
    "A spotlight showdown. The audience leans in.",
    "A monologue that silences the room.",
    "The backdrop turned real. Nobody noticed.",
    "That face. Those eyes.",
    "Standing ovation, roses, trophy.",
  ],
  emotion: [
    "Flat line. Nothing.",
    "A shrug.",
    "One small heart.",
    "A couple of smiles on the couch.",
    "Clutching the pillows.",
    "One tear. Tissues out.",
    "Laugh-crying into a tissue mountain.",
    "Floating on a river of happy tears.",
    "The living room is flooded. Group hug.",
    "The whole theater, undone.",
  ],
  visual: [
    "A lollipop tree. That's it.",
    "A tree and a corner sun.",
    "Crayon, outside the lines.",
    "A pleasant cartoon valley.",
    "Now with depth and reflections.",
    "Golden hour.",
    "Waterfall, mist, wildflowers.",
    "Lanterns over the river at dusk.",
    "Aurora over a mirror lake.",
    "Floating islands. Jaw on the floor.",
  ],
  audio: [
    "One hummed note.",
    "A kazoo.",
    "A kazoo and a pots-and-pans drum kit.",
    "The garage band.",
    "The bar band.",
    "A jazz club.",
    "A string ensemble.",
    "A full orchestra and choir.",
    "An orchestra on a clifftop at sunset.",
    "A stadium, a pipe organ, fireworks.",
  ],
  importance: [
    "Read it, shrugged, dropped it.",
    "One tiny ripple.",
    "Told one friend.",
    "Telling everyone at the café.",
    "The whole town's talking.",
    "Film school is studying it.",
    "There's a mural.",
    "It's in a museum.",
    "Sealed in a time capsule.",
    "Launched into space for the aliens.",
  ],
  engagement: [
    "Asleep.",
    "On the phone, back to the TV.",
    "Glancing up now and then.",
    "Half-watching, snacking.",
    "Actually watching.",
    "Popcorn frozen halfway.",
    "Edge of the seat; the cat is ignored.",
    "Nose to the screen.",
    "Getting pulled in.",
    "Gone. Fell into the movie.",
  ],
  fun: [
    "One chair, one sad balloon.",
    "A party hat. Technically a party.",
    "A game of catch.",
    "The swings.",
    "Water-balloon fight.",
    "Bumper cars.",
    "Carnival at dusk.",
    "Roller coaster, hands up.",
    "Top of the Ferris wheel, fireworks.",
    "A rocket coaster through space.",
  ],
  replay: [
    "Straight into the trash.",
    "Gathering dust.",
    "Someday? Maybe.",
    "Lent it out. Didn't mind.",
    "A lazy-Sunday rewatch.",
    "Once a year, circled on the calendar.",
    "The tape is held together with duct tape.",
    "A wall of tally marks.",
    "A shrine. Rewind button worn smooth.",
    "A family tradition, every generation.",
  ],
};

export function scorecardIllustrationSrc(
  criterion: ScorecardCriterion,
  score: number
): string {
  return `/scorecard/${criterion}/${String(score).padStart(2, "0")}.webp`;
}

export function scorecardIllustrationCaption(
  criterion: ScorecardCriterion,
  score: number
): string {
  return SCORECARD_ILLUSTRATION_CAPTIONS[criterion][score - 1] ?? "";
}
