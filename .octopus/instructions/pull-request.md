# Pull requests

How the agent titles and describes the work in a pull request for this
project. Used for the prompt the pull request pane sends, and when the form is
left empty and the agent writes both itself. In English, like everything else
in the repository.

## The title

- Conventional Commits, imperative, under 72 characters. A squash merge makes
  it the commit on `main`, so it is written as one.

## The description

- **`## Summary`** — under five sentences: the behaviour change, the modules
  and components touched, the tests added. It covers the whole branch
  (`git diff origin/main...HEAD`), not only this session's part. Strings are
  mentioned only when the locales gained or changed keys — never a
  "no strings changed" line.
- **`## Reason and result`** — plain language for someone who does not read
  code, with three labelled parts: **Problem**, **Before** and **After**, the
  last two as the person using the app sees it. The five-sentence limit is not
  this section's.
- Nothing that lives only on the maintainer's machine — `docs/tasks/`,
  `CLAUDE.local.md`, `settings.local.json`: the reader cannot follow it.
