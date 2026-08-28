# Releasing

How a downloadable build is made, and what has to be true before it is handed
to anyone.

## The two commands

```bash
npm run dist          # unsigned — what you get without an Apple account
npm run dist:signed   # signed and notarised — needs the credentials below
```

Both run `npm run build` first, so the typecheck gates the release. Output
lands in `dist/`:

| File                              | For                            |
| --------------------------------- | ------------------------------ |
| `Octopus-<version>-arm64.dmg`     | the download link              |
| `Octopus-<version>-arm64-mac.zip` | auto-update, when that exists  |
| `*.blockmap`                      | differential updates, likewise |

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
  ~277 MB on its own and accounts for most of the download.

If either stops being unpacked, the app still starts and still looks fine. The
terminal fails to open, or chat fails on the first message. Neither shows up in
`npm run dev`, which is why the checklist below exists.

## Enabling the signature

An **unsigned build is refused by macOS, not merely questioned.** Since macOS
15 the old right-click → Open bypass is gone; the user has to go to System
Settings → Privacy & Security and press "Open Anyway" after the first refusal.
Plan on saying so wherever the download lives.

Signing removes that entirely. It needs an Apple Developer Program membership
($99/year, unlimited apps — one membership covers everything you ever ship),
and then:

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

Verify the result before publishing:

```bash
spctl -a -vvv dist/mac-arm64/Octopus.app   # must say: accepted, Notarized Developer ID
codesign -dv dist/mac-arm64/Octopus.app
```

On an unsigned build the same command reports an ad-hoc signature and a
rejection. That is the expected output, not a fault.

## Before publishing

`npm run check` is necessary and nowhere near sufficient — every failure below
passes it. Install the artefact and **launch it from Finder**, never from a
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

## Version

`package.json` is the only place the version lives; the dmg takes its name from
it. Bump it in the release commit, and tag the commit so a downloaded build can
be traced back to a tree.
