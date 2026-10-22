# Stack gotchas — moved

**This file is deliberately a stub. Do not add content here.**

The traps of this stack — Expo, Metro, react-native-web, the Firebase JS SDK,
Cloud Functions, FCM, emulator behaviour, build and export mechanics — live in a
shared skill, because a sibling project runs the same stack and duplicated notes
drifted apart:

- **Source:** `faisal-shah/agent-skills` → `skills/expo-firebase-stack/SKILL.md`
- **Installed:** `~/.claude/skills/expo-firebase-stack/SKILL.md`
  (install with `./skills/expo-firebase-stack/install.sh --skills-dir ~/.claude/skills`
  — the installer's default targets other agents' directories, and a skill in the
  wrong directory installs "successfully" and never loads)

Start with its closing section, **"How this stack fools you"** — read it before a
debugging session, not during one.

## Where does a new lesson go?

One question: **would this be true for a different company building on the same
stack?**

- **Yes → the skill.** Contribute it in the same batch as the fix. The skill repo
  is **public**, so generalise first: no project ids, internal domains, email
  addresses, AVD names, secrets, or product decisions.
- **No → this repo.** Product invariants and process go in `CLAUDE.md`; our own
  scripts and their guards go in `docs/DEV-TOOLING.md`.

Borderline cases usually split cleanly: the *fact* ("the functions emulator
answers on its port before registering functions") is stack knowledge; *what we
built about it* (`sabeel-ci free-emulator-ports`, the readiness wait in the e2e)
is ours.

## Why a stub rather than a copy

The sibling project kept a full local copy. It drifted to 250 lines against the
skill's 640, because syncing was manual and entries written mid-debugging landed
in whichever file happened to be open. Convention alone did not hold. A stub
cannot drift.
