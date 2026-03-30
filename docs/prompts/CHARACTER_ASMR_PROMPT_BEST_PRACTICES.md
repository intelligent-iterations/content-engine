# Character ASMR Prompt Best Practices

Use this guide for character-based ASMR videos, especially when the subject is a mascot, meme creature, plush-like figure, or other continuity-sensitive non-human character.

## Core Rule

Default to one clean 6-second payoff clip unless the user explicitly asks for a longer sequence.

Character ASMR usually gets worse when the runtime is spent on setup, extra narration, or too many unrelated actions. The strongest default is:

- one locked subject
- one locked tabletop environment
- one dominant hand-tool action
- one visible reveal payoff by the end

## Subject Handling

- Lock the character identity in the first frame: head shape, eyes, nose or snout geometry, accessories, silhouette, proportions, and material finish.
- Personify visually rather than verbally. Prefer widened eyes, hand tension, posture shifts, tiny flinches, or cap/hair wobble. If a vocal reaction is used, it should be brief enough that the viewer still experiences the clip mainly through cutting sound and tactile texture.
- Do not let the model redesign the character mid-cut. Repeat the identity anchors in every continuity section.

## Audio Direction

- Default to no narration.
- Minimal character reaction is allowed if it stays whisper-soft, sparse, and subordinate to the tactile sound bed.
- If a prompt schema requires dialogue, use either `Dialogue: ""` for no speech or a tiny ASMR-safe reaction such as a soft breath, a tiny gasp, or one short syllable.
- Push tactile sound intent instead: steel tap, bark crack, fibrous slice, board knock, crumbs, crisp scrape, soft split.
- The cut audio should be the main ASMR event, not background chatter.

## Action Design

- One shot, one action, one payoff.
- Start already framed for the cut whenever possible.
- The action should be simple enough to read instantly on mobile.
- End with a visible cross-section or texture reveal so the payoff is legible in the final second.

## Material Rules

- Favor toy-like, foam-like, dessert-like, kinetic-sand-like, clay-like, or otherwise tactile interiors.

## Camera And Environment

- Use a fixed macro or close macro frame with at most a slight push-in.
- Keep the board, counter, lighting direction, gloves, and knife style stable.
- Avoid busy props and wide scene changes.

## Prompt Structure

For image prompts, prioritize:

1. exact subject identity
2. material and texture
3. tabletop environment
4. framing and lighting
5. tool position

For video prompts, prioritize:

1. whether there is any speech at all, and if so how minimal it is
2. one dominant action
3. character reaction, if any
4. tactile sound intent
5. reveal state by the end of the shot

## Anti-Patterns

- long multi-beat setup before the cut
- spoken narration layered over the tactile audio
- full dialogue exchanges that turn the clip into performance instead of ASMR
- vague “make it asmr” language without concrete sound cues
- re-describing the character differently in each clip
- chaotic cutting motion
