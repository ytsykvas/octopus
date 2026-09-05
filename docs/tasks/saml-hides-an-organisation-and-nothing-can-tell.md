# SAML hides an organisation and nothing can tell

**Found:** 2026-09-05, narrowed from `a-short-repository-list-never-says-why.md`
when that one landed. The two causes it could detect now say so under the list;
this is the third and it is the one the parent deferred deliberately.

## What happens

Many work organisations require a token to be authorised for their single
sign-on separately from being granted `read:org`. Until it is, GitHub answers as
though the organisation were not there — the same silent, plausible, incomplete
list the parent finding was about, with none of the signals that closed it:

- the scope check passes, because `read:org` really is on the token;
- the walk does not hit its limit, because there is nothing extra to fetch.

So the picker shows a complete-looking list and says nothing, which is exactly
where this started.

## Why it is separate

**GitHub does not report it on the user endpoint.** `gh api user` and
`gh auth status` both answer happily; the authorisation is a property of the
token against one organisation, and finding out costs a query per organisation
the account belongs to — which is a list we would first have to be able to read,
and reading it is what the missing authorisation prevents.

That is the whole difficulty: the check for "is an organisation hidden from me"
needs the answer it is trying to obtain.

## Sketch

A single line naming it as a possibility may be the whole feature, since the fix
is a click on GitHub's own page rather than anything octopus can do.

But it cannot be a standing line under every list. The picker now carries two
footnotes that appear **only when they are true**, and that rule was worth
writing down (`docs/ui.md`); a permanent "an organisation may also need SSO
authorising" under a list nobody has trouble with would undo it.

So the open question is what condition it hangs from. One candidate that costs
nothing: the account belongs to an organisation, `read:org` is present, and no
repository in the list has an owner other than the account itself — a
combination that is either SAML or an organisation with no repositories.
Whether that is worth a sentence or is just a cleverer way to be wrong is the
decision this note is waiting on.
