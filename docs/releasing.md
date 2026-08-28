# Building an app bundle

How `Octopus.app` is made, what is inside it, and what to check before trusting
one.

This is how everybody gets Octopus: there are no downloads, and the reason is
at the bottom of this document rather than the top, because it is a constraint
to understand rather than a step to perform.

## The command

```bash
npm run dist
```

It runs `npm run build` first, so the typecheck gates the build. Output lands in
`dist/`:

| File                              | For                                        |
| --------------------------------- | ------------------------------------------ |
| `mac-arm64/Octopus.app`           | **this is the one** — drag to Applications |
| `Octopus-<version>-arm64.dmg`     | the same app, wrapped for handing over     |
| `Octopus-<version>-arm64-mac.zip` | auto-update, if that ever exists           |
| `*.blockmap`                      | differential updates, likewise             |

Take the `.app` directly. The dmg exists because electron-builder makes one, and
it is useful for moving a build between your own machines — but a dmg that
travels over the internet acquires the quarantine flag, and then the signing
constraint below applies to it.

`npm run dist:signed` also exists, for the day somebody has an Apple certificate.
Nothing depends on it.

Apple Silicon only, by decision — an Intel build would need the `darwin-x64`
Claude Code binary fetched as well, since npm installs only the one matching
the machine doing the building.

The log shows `node-pty` being rebuilt on the way past. That is deliberate:
packaging targets the output architecture, which is not necessarily the one
`postinstall` built for. Both go through electron-builder — `postinstall` is
`electron-builder install-app-deps` — so the two cannot disagree about the ABI.

## What ships inside

Two things in the bundle are executables rather than JavaScript, and both are
listed in `asarUnpack` in `electron-builder.yml` because nothing can be run
from inside an asar archive:

- `node_modules/node-pty` — the terminal's native binding;
- `node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude` — the agent
  itself, which the SDK resolves out of `node_modules` at runtime. It is
  ~277 MB on its own and accounts for most of the bundle's size.

If either stops being unpacked, the app still starts and still looks fine. The
terminal fails to open, or chat fails on the first message. Neither shows up in
`npm run dev`, which is why the checklist below exists.

## Why nobody downloads this

A build you made yourself opens with no prompt of any kind — verified, and easy
to re-verify:

```bash
xattr -l dist/mac-arm64/Octopus.app     # no com.apple.quarantine
```

Nothing downloaded it, so nothing marked it. That is the entire reason building
from source is the distribution model rather than a fallback for developers.

Send the same file over the internet and it stops being true. This was checked
on a second machine, with the dmg carrying the quarantine flag a browser
download sets, and it is worse than the usual "unidentified developer"
friction:

> "Octopus" is damaged and can't be opened. You should move it to the Trash.

There is no "Open Anyway" for this. That button belongs to apps signed with a
real certificate but not notarised; ours is **ad-hoc** signed, which macOS
treats as a broken signature rather than an untrusted one. Nothing appears in
System Settings → Privacy & Security, and right-click → Open does not help
either. The only way through is a terminal command on the installed app:

```bash
xattr -dr com.apple.quarantine /Applications/Octopus.app
```

Ad-hoc is not a choice that can be reversed by shipping "properly unsigned"
instead: Apple Silicon refuses to execute a binary with no signature at all, so
every arm64 build carries at least an ad-hoc one.

So: **a distributed build can be given to people who will run a terminal command
and to nobody else.** "Damaged" reads as a failed download, not as a security
prompt, and most people will not get past it. That is why there are no Releases
here, and why adding some later would create more support than convenience.

### What signing would buy, if anyone wants it

Nothing below is needed to build or use Octopus. It is recorded so the decision
does not have to be researched again.

Signing removes the problem entirely. It needs an Apple Developer Program
membership ($99/year, unlimited apps — one membership covers everything you ever
ship), and then:

1. Set `notarize: true` under `mac:` in `electron-builder.yml`.
2. Export three variables — **never into the repository**:

   ```bash
   export APPLE_ID="you@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # appleid.apple.com
   export APPLE_TEAM_ID="XXXXXXXXXX"                          # developer.apple.com
   ```

3. `npm run dist:signed`.

The certificate to install is **Developer ID Application**, not the Mac App
Store one. The App Store is not a target and cannot be: its sandbox forbids
executing third-party binaries, and this app is mostly a thing that executes
third-party binaries (`PROJECT.md` §6).

Signatures carry a trusted timestamp, so builds already shipped keep working
after the certificate expires or the membership lapses. Only new builds need a
live membership.

Verify the result:

```bash
spctl -a -vvv dist/mac-arm64/Octopus.app   # must say: accepted, Notarized Developer ID
codesign -dv dist/mac-arm64/Octopus.app
```

On an unsigned build the same command reports an ad-hoc signature and a
rejection. That is the expected output, not a fault.

## Before trusting a build

`npm run check` is necessary and nowhere near sufficient — every failure below
passes it. Install the bundle and **launch it from Finder**, never from a
terminal: a terminal hands the app its own PATH and hides the one bug this
whole section exists for.

- [ ] the window opens and is not blank;
- [ ] a repository opens and its diff renders — `git` was found;
- [ ] Settings shows GitHub and Claude as connected — `gh` and `claude` were
      found, which is the PATH repair working;
- [ ] a terminal opens — `node-pty` survived the asar;
- [ ] a chat gets a reply — the bundled agent binary is reachable;
- [ ] the icon is right in Finder, the Dock and the menu bar, and the menu
      reads "Octopus".

The PATH item deserves the suspicion. A GUI launch inherits launchd's
environment, where PATH is roughly `/usr/bin:/bin:/usr/sbin:/sbin` — Homebrew
and `~/.local/bin` are both absent, so `gh` and `claude` disappear while the
app's own terminal keeps finding them, because that path goes through the login
shell on purpose. `core/loginShell.ts` repairs it at startup.

### On a second machine, and how it gets there

The build machine has `git`, `gh`, `claude` and a Claude login already, so it
cannot show what a stranger sees. A second Mac can — Apple Silicon, since there
is no Intel build.

**How the file travels decides whether the test is real.** macOS marks
downloads with a quarantine flag, and only some transfers set it:

| Transfer                              | Quarantine | Worth doing                                   |
| ------------------------------------- | ---------- | --------------------------------------------- |
| USB drive, `scp`, `rsync`             | no         | no — the app opens cleanly and proves nothing |
| AirDrop, browser download, cloud sync | yes        | yes                                           |

Copying the artefact by hand is the easy mistake: everything works, and the
conclusion drawn is the wrong one. Set the flag deliberately if unsure:

```bash
xattr -w com.apple.quarantine "0083;00000000;Safari;$(uuidgen)" Octopus-<version>-arm64.dmg
xattr -p com.apple.quarantine Octopus-<version>-arm64.dmg   # confirm it survived the trip
```

The account panel is the item to watch there: on a machine without `gh` and
`claude` it should read "not connected" and the app should carry on. That is the
first-run experience, and it cannot be observed anywhere else.

## Version

`package.json` is the only place the version lives; the dmg takes its name from
it. Bump it in the release commit, and tag the commit so a downloaded build can
be traced back to a tree.
