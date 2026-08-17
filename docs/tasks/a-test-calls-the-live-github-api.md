# A test calls the live GitHub API

## What happens

`service.test.ts` › "falls back to the real gh when no executor is supplied"
builds a service with no `commandExec` and calls `listRemoteRepositories()`,
which runs the machine's actual `gh repo list --limit 200` against
`api.github.com`.

It fails whenever that request does. Observed on 2026-08-17: three runs in four
failed with `GitHubError: notConnected`, and the same command run by hand
returned

```
HTTP 503: No server is currently available to service your request.
(https://api.github.com/graphql)
```

two times out of three. Nothing in the repository had changed between a passing
and a failing run.

## Why it matters

It is the only test in the suite that needs the network, an account and a
third-party service to be up, and `npm run check` is what every commit goes
through. A red gate that nobody's change caused is worse than a missing test:
the next session spends its time bisecting a diff that was never the problem —
which is exactly what happened here.

It also fails for anyone who has `gh` installed but is not signed in, and for
anyone offline.

## What the test is actually for

Its own comment says it: "No commandExec: the service must still expose the
capability rather than crashing." That is a claim about **wiring** — that
`createService` defaults the executor rather than leaving it undefined — and it
is being checked by making a real API call.

## A sketch

Assert the wiring without the network. `defaultExec` is injectable one level
down, so the service could be built with an exec that records what it was asked
for and answers `[]`, and the assertion becomes "it asked `gh` for the
repository list" rather than "GitHub answered". The default's own identity is
already covered wherever `defaultExec` is tested.

Failing that, the honest alternative is to mark it as needing the network and
keep it out of the gate — but a unit test that is skipped by default tends to
stop being true.
