# `setup.sh` gets no environment at all

**Found:** 2026-08-12, while checking whether the setup script runs on workspace
creation. **Narrowed:** 2026-08-18, when the project env file landed.

## What happens

`ScriptRunner` passes `{}` to the setup script. `run.sh` gets `OCTOPUS_PORT`;
`setup.sh` gets nothing — including any pointer back to the repository the
workspace was cut from.

## What has since been fixed

The reason this was first written is gone. The env file no longer has to be
fetched by hand: a project keeps one in octopus and it is written into every
workspace that lacks a `.env`, at creation and before either script runs. The
template's wrong `cp ../../.env .env` hint is gone with it, and §12.2 no longer
claims `setup.sh` runs on workspace creation.

What remains is the general case. A setup script that needs anything else from
the original checkout — a certificate, a fixture directory, a local config the
env cannot express — still has no way to name where it is, and hard-coding an
absolute path breaks for every other machine, since the script is per-project
but the path is not.

## Evidence

- `src/renderer/src/components/ScriptRunner.tsx` — `env={kind === 'run' ? { OCTOPUS_PORT: String(port) } : {}}`
- `src/core/scripts.ts:35` — `PORT_VARIABLE`, the only variable there is

## What is already decided

Running is manual, by button. Conductor runs setup automatically on workspace
creation and blocks the workspace if it fails; we deliberately do not.

## Sketch

Give the setup script an environment too. At minimum the repository root, which
`store.ts` knows and the renderer already has on the project. Conductor's
equivalent is `CONDUCTOR_ROOT_PATH`; ours would be `OCTOPUS_ROOT_PATH`, defined
next to `PORT_VARIABLE` in `scripts.ts` so the two names stay together.

```sh
cp "$OCTOPUS_ROOT_PATH/certs/dev.pem" certs/
```

Worth deciding at the same time: whether the server script should have it as
well. It probably should — one environment for both halves is easier to
describe than two, and the only reason `run.sh` has one today is the port.
