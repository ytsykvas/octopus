# Two places now record "always allow"

`config.alwaysAllowedTools` exists because of a constraint that has gone. The
commit that added it said so plainly:

> An answer of "always" is stored in the config, where it can be taken back,
> because with `settingSources: none` the SDK has nowhere to write one.

Settings sources are loaded now, so the SDK has somewhere: `.claude/settings.local.json`,
which is where the plain CLI keeps exactly this answer. So a user who says
"always" in octopus writes it to one place, and the same user saying it in a
terminal writes it to another — and neither sees the other's.

Three ways out:

- **Write to `.claude/settings.local.json`**, as the CLI does. One home, shared
  with the terminal. Costs octopus the ability to show and revoke the list in
  its own Settings screen unless it also reads and edits that file.
- **Keep the config and read theirs too** — `askPermission` consults both. No
  migration, no surprise, but "where do I take this back" now has two answers.
- **Leave it.** Defensible only while the two lists rarely disagree, which is a
  guess rather than a design.

Worth deciding when permissions are next touched, alongside
`the-permission-card-cannot-say-why-it-is-asking.md`, which already names
`alwaysAllowedTools` as staying put "because `settingSources` may be `none`" — a
reason that no longer holds.
