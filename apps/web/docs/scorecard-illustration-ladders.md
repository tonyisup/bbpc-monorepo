# Scorecard illustration ladders

One image per score, 1–10, for each of the nine scorecard metrics. Each line is the
scene; the generation prompt adds the art style for that score from the shared spine.
The shipped images in `apps/web/public/scorecard/<criterion>/NN.webp` were generated
from these lines with the local MOSS image model (672x496, WebP). The captions the page
shows live in `apps/web/src/lib/scorecard-illustrations.ts`. Editing a line here changes
no image: regenerate that image and update its caption too.

## Shared spine

The art itself gets better as the score rises, so every metric reads the same way at a
glance:

| Score | Art style |
| --- | --- |
| 1–3 | Crude black stick figures on white paper. 3 may add a little crayon color. |
| 4–6 | Simple flat-color cartoon. |
| 7–8 | Detailed storybook illustration. |
| 9 | Lush painterly scene with cinematic lighting. |
| 10 | Epic cinematic, movie-poster grandeur, golden light. |

**The Duo.** Most ladders star the same two friends so the set feels like one world.
At 1–3 they're plain stick figures. From 4 up: a tall bearded man in a yellow beanie, and
a short woman with a brown ponytail, red hoodie and round glasses. Name both in every
prompt and say "exactly two people", or MOSS tends to duplicate one of them.

**Text.** As little as possible. Where a word helps, it's in quotes in the line below.

## Story: the journey to the mountain

1. The Duo stand side by side doing nothing.
2. Walking and talking, a squiggle in a speech bubble.
3. Walking toward a doodled mountain in the background.
4. Same scene, now cartoon, backpacks on, dirt path toward the mountain.
5. A fork in the path; one studies a map while the other points the wrong way.
6. Crossing a wobbly rope bridge over a ravine.
7. Storm clouds rolling in on steep switchbacks; one hauls the other up a ledge.
8. Night camp just below the summit: campfire, stars, a map with an X.
9. The final ridge scramble at sunrise, summit within reach.
10. Planting a flag on the summit above a sea of clouds.

## Performance: the stage

1. The Duo on a bare stage, reading flatly from paper scripts.
2. One points stiffly; the other has a hand on their heart. Wooden.
3. Paper-bag masks with big drawn-on expressions.
4. A school play: cardboard castle; one has forgotten their line and a prompter waves from the wings.
5. Community theater: decent costumes, a small and polite audience.
6. A dramatic confrontation under a spotlight; the audience leans in.
7. One kneels for a monologue, a single tear; the audience is frozen silent.
8. The painted backdrop has turned real behind them: the audience forgot it was a stage.
9. A close-up of an intense face, eyes glistening, cinematic light.
10. A standing ovation, roses landing on stage, a golden trophy statuette held high.

## Emotion: the couch

1. A stick figure on a couch, flat-line mouth, no reaction.
2. A tiny shrug.
3. One small heart floating overhead.
4. Cartoon: the Duo on the couch, slight smiles, popcorn in hand.
5. Clutching pillows, wide-eyed.
6. One tear rolling down; the tissue box is out.
7. Both openly crying and laughing at once; a tissue mountain grows.
8. The couch floats on a river of happy tears.
9. A flooded living room, the Duo hugging, glowing hearts drifting up.
10. A whole theater audience weeping and cheering as a giant glowing heart rises from the screen.

## Visual: the view

The same valley vista, framed like a film still, rising in craft.

1. A gray rectangle with one lollipop tree.
2. A lollipop tree plus a corner sun with ray lines.
3. A crayon house, hills and sun, colored outside the lines.
4. Cartoon valley: hills, trees, a river.
5. Cartoon valley with depth: lake reflections, distant mountains.
6. Golden-hour cartoon valley, long shadows, birds.
7. Storybook valley with a waterfall, mist and wildflowers.
8. Storybook valley at dusk with a lit village and lanterns.
9. A painterly valley under an aurora, mirror lake, volumetric light.
10. Jaw-dropping cinematic vista: floating islands, waterfalls pouring into clouds, aurora and sunset at once.

## Audio: the band

1. One stick figure humming a single wobbly note.
2. A kazoo with squiggly notes.
3. Kazoo plus a pots-and-pans drum kit.
4. Cartoon garage band: acoustic guitar, bucket drum, tiny amp.
5. A bar band on a small stage with real instruments.
6. A jazz quartet in a smoky club, saxophone notes swirling.
7. A string ensemble in a wood-paneled concert hall.
8. A full orchestra and choir.
9. An orchestra on a clifftop at sunset, sound waves visible as golden ribbons.
10. A stadium orchestra, a giant pipe organ, speaker stacks to the sky, notes bursting like fireworks.

## Importance: the ripple

1. A stick figure reads a sticky note, shrugs and drops it.
2. A pebble dropped in a puddle: one tiny ripple.
3. One stick figure tells another, who nods.
4. Cartoon: the Duo telling friends about it at a café table.
5. A town-square crowd talking it over.
6. A film-school class studying it, notes on a chalkboard.
7. A city mural painted in its honor.
8. A museum exhibit: the film reel under glass, people queueing.
9. The film reel sealed into a time capsule at a ceremony.
10. A golden film reel aboard a space probe, Earth glowing behind it.

## Engagement: the viewer

1. A stick figure asleep on the couch, "Zzz", TV on.
2. Scrolling a phone, back to the TV.
3. Glancing up from the phone.
4. Cartoon: phone face-down on the cushion, half-watching while snacking.
5. Sitting up and watching, popcorn in hand.
6. Leaning forward, elbows on knees, popcorn frozen mid-air.
7. Edge of the seat; the phone buzzes on the floor ignored and the cat is ignored too.
8. Nose nearly touching the screen, popcorn spilling everywhere.
9. The living room fading away, the viewer half pulled into the screen's glow.
10. The viewer tumbling into the movie's world as their phone floats away into the void.

## Fun: the party

1. One stick figure on a folding chair beside one deflated balloon.
2. A party hat and one balloon.
3. The Duo playing catch.
4. Cartoon: the Duo on a playground swing set.
5. A backyard water-balloon fight.
6. Bumper cars at a county fair.
7. A carnival at dusk: Ferris wheel, cotton candy, string lights.
8. A roller-coaster loop, everyone screaming happily, hands up.
9. A theme park on fireworks night, the Duo on the top of the Ferris wheel.
10. A rocket-powered roller coaster looping through outer space, confetti and fireworks.

## Replay: the tape

1. A stick figure tossing a movie disc into a trash can.
2. The disc on a dusty shelf, a cobweb, a stick figure walking past.
3. A stick figure holding the disc, shrugging: "maybe someday".
4. Cartoon: one of the Duo lending the disc away and not minding.
5. The disc back on the coffee table for a lazy Sunday.
6. A wall calendar with one date circled each year for a rewatch.
7. A VHS tape held together with duct tape, label worn from use.
8. Tally marks covering a whole wall, counting rewatches.
9. The tape on a little shrine with candles; the remote's rewind button worn smooth.
10. Generations on one big couch, grandparents to toddlers, watching it together as a tradition.
