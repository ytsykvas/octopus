# Nobody has checked whether SAML hides an organisation from `viewer.organizations`

## What happens

The repository picker now names an organisation the account belongs to that put
nothing in the list, and leaves the cause to the reader — either there is nothing
there they can push to, or the token needs SSO authorising for it. The names come
from `viewer.organizations`, a sibling of `login` on the same GraphQL `viewer`,
so they cost no second request (`src/core/github.ts`).

**What has never been verified is whether that field survives SAML.** A token
that holds `read:org` but has not been SSO-authorised for an organisation makes
GitHub filter that organisation's resources out of the token's view. Whether the
organisation itself still appears in `viewer.organizations` is the question, and
it decides whether the new line fires in the case it was written for.

## Why it matters

If GitHub still names the organisation, the line works exactly as intended: the
reader sees "you belong to Acme, and none of its repositories are listed" and
knows to authorise the token.

If GitHub withholds the organisation too, the line never appears for a
SAML-blocked org, and the picker is back to a short list that looks complete —
no worse than before this landed, and no better for the case that prompted it.

Nothing in between: the line is either right or absent. It cannot say something
false, which is why this shipped without the answer.

## What is already decided

- **The line does not guess at a cause.** Naming the organisation is true in both
  readings; a condition inferred from what is absent fired identically for
  somebody who belongs to no organisation at all. That is settled, and
  `docs/ui.md` records it.
- **`gh` gives no SAML signal of its own.** Verified: the binary contains no
  `saml`, `sso` or `X-GitHub-SSO` string, and octopus discards response headers,
  stderr and the GraphQL `errors` array on the listing path.
- **`viewer.organizations` was the cheapest thing available.** It is free, and
  the alternative — a separate call per organisation to test access — is a round
  trip per org on a dialog that opens on a click.

## How to settle it

Needs one account belonging to a SAML-protected organisation whose token has
`read:org` and has **not** been SSO-authorised for it:

```bash
gh api graphql -f query='query { viewer { login organizations(first: 100) { nodes { login } } } }'
```

The organisation appearing in that output is the answer. Record it here, then
either delete this file or replace it with a note about what to do instead.

Until then, the line is a bet placed at no cost, and this file is what stops the
next reader assuming it was verified.
