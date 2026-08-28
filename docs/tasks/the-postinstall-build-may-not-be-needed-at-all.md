# The postinstall build may not be needed at all

## What happens

`postinstall` runs `electron-builder install-app-deps` to build `node-pty`,
and that is a real cost: it is the slowest part of `npm install`, and it is the
reason a contributor needs a working toolchain rather than just npm.

It may be buying nothing. `node-pty@1.1.0` is built through **Node-API**, not
against V8 — `nm` on the binary shows 38 `napi_*` symbols and no V8 symbols, and
`binding.gyp` pulls in `node-addon-api`. Node-API is ABI-stable, which is why
the same file loads under plain Node (`process.versions.modules` 137) and under
Electron 43 (148); both were checked.

The package also ships prebuilt binaries in `node_modules/node-pty/prebuilds/`,
including `darwin-arm64`. `loadNativeModule` in `node_modules/node-pty/lib/utils.js:19`
looks in `build/Release`, then `build/Debug`, then
`prebuilds/<platform>-<arch>` — so the prebuild is already the documented
fallback for exactly this case.

## Why it matters

If the prebuild is sufficient, `postinstall` can go entirely: `npm install`
gets faster, one moving part disappears, and the `electron-builder` dependency
stops being load-bearing at install time. If it is _not_ sufficient, that is
worth knowing explicitly rather than assumed — the current setup would then be
protecting against something nobody has written down.

## What is not yet known

Whether the prebuild alone actually works. Nobody has deleted
`build/Release/pty.node` and launched the app against `prebuilds/` — until that
is tried, in a packaged build as well as in development, this is a hypothesis
with good evidence rather than a finding.

Note that packaging rebuilds independently of `postinstall` (`npmRebuild`
defaults to true), so removing `postinstall` would change development only.

## What is already decided

`npm install` must stay a single step for anyone cloning the repository
(`README.md`). Any answer here has to keep that true.
