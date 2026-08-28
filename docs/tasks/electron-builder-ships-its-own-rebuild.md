# electron-builder ships its own rebuild

## What happens

`npm run dist` prints, every time:

```
@electron/rebuild already used by electron-builder, please consider to remove
excess dependency from devDependencies
```

`@electron/rebuild` is a direct devDependency (`package.json`) driving
`postinstall: electron-rebuild -f -w node-pty`, and `electron-builder` carries
its own copy, which it runs during packaging — the build log shows it rebuilding
`node-pty` for arm64 on its own.

## Why it matters

Two rebuild paths for one native module, pinned independently. They agree today;
nothing makes them keep agreeing, and the failure mode is the confusing one —
a `NODE_MODULE_VERSION` mismatch that appears only in a packaged build, or only
after a plain `npm install`.

It is also a dependency and a postinstall step that may not need to exist.

## What is already decided

Nothing. `postinstall` is what makes `npm install` a single step for a
contributor (README), so whatever replaces it has to keep that true —
electron-builder's suggested `electron-builder install-app-deps` does, but it
has not been tried here.

## Evidence

Build log of `npm run dist`, and `postinstall` in `package.json`.
