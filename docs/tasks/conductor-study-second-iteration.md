# Re-run the `conductor-study` evals against the fixed skill

**Found:** 2026-08-12, on finishing the first iteration of the skill.

## What happens

The skill was tested on three prompts, each run twice — once with the skill and
once without — and three defects came out of the comparison. All three were
fixed, and none of the fixes were re-tested.

The defects, and what changed:

| Defect                                                                                                | Fix                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Refused to plan work the user had explicitly asked for, because it was a declared non-goal            | The guard now separates "do not volunteer a non-goal" from "the user asked, so deliver it and state the cost" |
| Wrote the compiled binary off as opaque, which the baseline run then read successfully with `strings` | The source map now points at it, with the caveat that a symbol name is observed and its behaviour is inferred |
| The references read as a ceiling, so investigation stopped at them                                    | New section: check our own SDK before copying Conductor, and verify git plumbing in a throwaway repo          |

## Why it matters

Iteration one scored 93% with the skill against 86% without — a thin margin, and
the one eval the skill _lost_ was the one it was most specifically written to
handle. Whether the rewrite actually fixed that, or moved the failure somewhere
else, is currently unknown.

The second defect is the one worth watching: a reference file that answers the
question well enough to stop the reader investigating can make a capable agent
perform worse than no skill at all. That is not visible without a baseline to
compare against.

## Evidence

- `.claude/skills/conductor-study/evals/evals.json` — the three prompts and their assertions
- `.claude/skills/conductor-study/SKILL.md:62` — the references were written against Conductor 0.80.0, docs fetched 2026-08-12; the installed Conductor is 0.83.1
- Iteration-one results were written to the session scratchpad and are gone; iteration two starts fresh

## Sketch

Re-run all three prompts with and without the skill, grade against the same
assertions, and compare. The eval prompt that matters most is the third one —
the request to add Codex and Cursor support. It should now produce a staged plan
that opens by naming the recorded non-goal, rather than a refusal. Which section
it names does not decide the grade: the skill's guard points at §5 and §12.3
(`.claude/skills/conductor-study/SKILL.md:159`), the eval's `expected_output`
says §5 and §6, §6 is where "Claude Code only" is actually settled, and the
assertion asks only that `docs/PROJECT.md` be cited.

Refresh the references before the run, or at least write down which version they
were graded against. They describe Conductor 0.80.0 and the installed app is
0.83.1, so an eval lost on a fact three releases old would say nothing about the
skill's text.

Worth adding a fourth prompt at the same time: something Conductor's docs answer
plainly and our references cover, phrased as a feature about to be built. That
is the case where a skill most easily makes things worse, and nothing in the
current set tests it.
