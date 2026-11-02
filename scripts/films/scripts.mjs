/**
 * THE FILMS' SCRIPTS: one per film `HELP_VIDEOS` lists, in its order. Each
 * step pairs a line of narration (`say`) with what happens on screen while it
 * is said (`do`); the step lasts as long as its line. `cut` keeps a step to the
 * phone or the computer film.
 *
 * Written as a friendly colleague talking someone through the screen:
 * contractions, "you", whole sentences, a short reason where it helps. Never a
 * label read out. Read each line aloud before rendering it; a reworded line is
 * rendered again (`sabeel-ci films tts`).
 *
 * `t` is ci-tools' film helpers (lib/films/record.mjs) and films.mjs's own:
 * `tabOf`, `moreRow`, `inSheet`, `entryRow`, `devSignIn`. The world is
 * world.mjs's: Sara is a member whose hours Omar approves; Amina is the admin.
 */
import { PEOPLE } from './world.mjs';

export const FILMS = [
  {
    id: 'clocking',
    as: PEOPLE.sara.email,
    start: '',
    steps: [
      {
        say: "This is Today, the screen the app opens on. The card at the top is your clock.",
        do: (t) => t.highlight(t.text('What are you working on?')),
      },
      {
        say: "First, pick what you're working on. Tap the box and choose an activity from the list.",
        do: async (t) => {
          await t.tap(t.text('Pick an activity'));
          await t.tap(t.inSheet('Tutoring'));
        },
      },
      {
        say: "Then tap Clock in, and your time is running.",
        do: (t) => t.tap(t.btn('Clock in')),
      },
      {
        say: "While you're clocked in, the card says what you're on and how long you've been at it.",
        do: (t) => t.highlight(t.text('CLOCKED IN')),
      },
      {
        say: "You can close the app or put your phone away. The clock keeps going without you.",
        do: (t) => t.wait(200),
      },
      {
        say: "When you're done, come back and tap Clock out.",
        do: (t) => t.tap(t.btn('Clock out')),
      },
      {
        say: "Your time is saved as an entry, and you'll see it add up under So far.",
        do: (t) => t.highlight(t.text('So far')),
      },
    ],
  },
];
