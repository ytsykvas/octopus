# A short repository list never says why it is short

**Found:** 2026-08-18, while making the picker show organisation repositories.

## What happens

The picker asks GitHub for everything the account can push to and draws whatever
comes back. If an organisation's repositories are missing from that answer, the
list simply does not have them — and looks complete.

Two ordinary causes, neither of which produces an error:

1. **No `read:org` on the token.** `gh auth login` does not always grant it, and
   without it an organisation's repositories are not in the reply at all.
2. **SAML single sign-on.** Many work organisations require a token to be
   authorised for them separately. Until it is, GitHub answers as though the
   organisation were not there.

In both cases `listRepositories` succeeds, the schema validates, and the user
sees a plausible list with their work missing from it. The only way to find out
is to run `gh auth status` by hand and know what to look for.

## Why it matters

This is the same failure the change that found it was fixing, one layer down. A
list that is wrong and says nothing costs more than one that refuses: the reader
concludes the feature does not support organisations and stops looking.

It is also the first thing that will happen to somebody setting octopus up at
work, which is exactly the audience for organisation support.

## Evidence

- `src/core/github.ts` — `listRepositories` reads scopes nowhere; a reply with
  no organisation repositories in it is indistinguishable from an account that
  belongs to no organisation.
- `gh auth status` prints `Token scopes: 'gist', 'read:org', 'repo', 'workflow'`
  — the information exists and nothing reads it.
- `src/core/accounts.ts:134` — `checkGitHubAccount` runs `gh api user` and keeps
  only `login` and `name`.

## Sketch

Read the scopes where the account is already checked, and say something where
the list is already drawn.

`checkGitHubAccount` could take the scopes from the `X-OAuth-Scopes` response
header (`gh api user -i`) or from `gh auth status`, and carry them on
`GitHubAccount` beside `login`. The picker then has grounds for one line under a
short list: the token cannot see organisations, and here is the command that
fixes it — `gh auth refresh -s read:org`.

SAML is harder and worth a separate decision: GitHub does not report it on the
user endpoint, and finding out costs a query per organisation. A single line
naming it as a possibility may be the whole feature, since the fix is a click on
GitHub's own page rather than anything octopus can do.

Do not gate the list on either check. A missing scope should annotate what is
shown, never replace it — the personal repositories in that list are real, and
somebody adding one has no use for a dialog that refuses.
