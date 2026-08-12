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
- Iteration-one results were written to the session scratchpad and are gone; iteration two starts fresh

## Sketch

Re-run all three prompts with and without the skill, grade against the same
assertions, and compare. The eval prompt that matters most is the third one —
the request to add Codex and Cursor support. It should now produce a staged plan
that opens by naming §5 and §6, rather than a refusal.

Worth adding a fourth prompt at the same time: something Conductor's docs answer
plainly and our references cover, phrased as a feature about to be built. That
is the case where a skill most easily makes things worse, and nothing in the
current set tests it.
