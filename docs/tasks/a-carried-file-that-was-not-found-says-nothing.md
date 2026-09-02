# A carried file that was not found says nothing

`carryInto` copies each path in the list and swallows every failure
(`src/core/carry.ts:208-219`):

```ts
} catch {
  // Already there, or the checkout does not have it. Both are ordinary.
}
```

Both really are ordinary, and neither should stop a workspace being prepared.
But the two are not the same thing, and one of them is how a workspace ends up
unable to run.

This is what happened when planner was re-added by cloning it from GitHub. The
checkout had no `.env` and no `config/master.key` — gitignored, so GitHub never
had them — so nothing was carried, nothing was said, and the workspace came up
empty. The first sign was the setup script stopping on a variable it could not
read, which reads as a script problem and is not one.

Naming a source per line (`.env = ~/work/planner/.env`) has since shipped
(`src/core/carry.ts:100-119`, `:166-185`), and it fixes the case where the file
exists somewhere. It does not fix the silence: a source that is wrong, or a file
since moved, fails exactly as quietly.

`carryInto` already answers with the paths it wrote, and `prepare` already
returns them to the caller (`src/core/service.ts:1743-1757`) — so what is
missing is the difference between that list and `carriedFiles`, and somewhere to
show it. The two are no longer the same shape: `carriedFiles` answers with
`CarriedFile[]` (`src/core/carry.ts:88-98`, `:131-138`), so the comparison is
against `.map((file) => file.path)`, the way `src/core/service.ts:2370` already
does it. The Build header would be the place: it is where a run starts and where
the reason a run failed belongs.

Worth doing with the honest distinction kept — "already in the worktree" is not
a problem and must not be reported as one, which means the `catch` has to tell
`EEXIST` from `ENOENT` rather than treating both as ordinary.

Deliberately left out of the change that added per-file sources: it is a
separate mechanism in a separate place, and that change was asked to stay small.
That change has landed, so nothing stands in the way of this one.
