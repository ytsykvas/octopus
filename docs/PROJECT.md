# octopus

> The main context document for the project. Describes what is being built and why, and records the requirements for stage 1.
> The stack is settled; the remaining sections grow through discussion.

---

## 1. What this is

**octopus** is a local macOS application for running Claude Code sessions in parallel: a dispatcher for agent tasks where each task executes in its own isolated copy of a repository.

Instead of waiting for the agent to finish one task, the developer starts several at once — each in a separate git worktree with its own branch, its own agent session and its own dev server. The tasks never see each other and never conflict.

**The goal** is a tool for daily personal work that imposes no foreign workflow and does not interfere with what the agent receives. Not a product for sale, not a service, not a team tool.

---

## 2. The problem

This way of working is already in use through [Conductor](https://www.conductor.build/), and the model itself has proven its worth. The implementation is what falls short:

| Problem                                         | Consequence                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Extra material injected into agent instructions | context receives things we never wrote; agent behaviour becomes opaque |
| Inflexible workflow                             | an imposed order of steps instead of one's own                         |

The first matters more: hidden prompt injection directly affects the quality of the agent's work and the ability to understand why it behaved as it did.

**Conductor's UI draws no complaints** — its layout is considered good and is taken as the model (§10.8).

---

## 3. The core concept

**The unit of work is an isolated workspace. The unit of integration is a branch and a pull request.**

A workspace is a git worktree: a full working copy of the repository in a separate directory that shares history with the main repo but carries its own branch and working state.

```
                    ┌── worktree + branch + agent + port ──┐
   repository ──────┼── worktree + branch + agent + port ──┼──→ PR ──→ merge
                    └── worktree + branch + agent + port ──┘
```

Each workspace owns:

- **a branch** — created automatically with the workspace;
- **an agent session** — its own `session_id`, surviving application restarts;
- **a dev server** — on its own port, so several copies of the app run at once;
- **a diff** — changes relative to the base branch.

### Task lifecycle

```
task → workspace → agent works → diff → PR → merge → archive
       (worktree    (isolated,    (review) (gh)        (worktree removed,
        + branch     own session)                       history kept)
        + setup.sh)
```

---

## 4. Guiding principles

**Transparency over convenience.** The agent receives exactly what we deliberately gave it. No hidden additions to the system prompt, no implicit loading of settings. If something enters the context, it is visible in the config.

**A thin layer.** The application manages worktrees, processes and the UI. It does not try to outsmart the agent, rewrite prompts or decide on the user's behalf.

**The core knows nothing about the UI.** All logic is headless and tested without Electron.

**Your own workflow.** No step is mandatory: a workspace can be created and abandoned, work can happen without a PR, scripts can be run by hand.

---

## 5. Non-goals

**Never:**

- Not a multi-agent platform — **Claude Code only**, no Codex/Cursor/Gemini.
- Not an IDE replacement, not a terminal replacement.
- Not for the App Store.

**Not now, but room is reserved (see §15):**

- Cloud execution of workspaces — everything is local, no backend.
- Accounts, authentication, licensing.
- Team work and synchronisation.

---

## 6. Settled decisions

| Decision                              | Rationale                                                                                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent — Claude Code only              | direct integration through the Agent SDK instead of an abstraction over several agents                                                                                                   |
| Distribution outside the App Store    | the sandbox (Guideline 2.4.5) forbids executing third-party binaries and writing outside the container (2.5.2); child processes do not inherit security-scoped access. Unsigned at first |
| Layout — three panes, as in Conductor | its UI is proven by daily use and draws no complaints; the structure of the space is copied, the visual style is our own (§10.8)                                                         |
| Stack — Electron + TS + React         | see sections 7–9                                                                                                                                                                         |
| Repository language — English         | code, comments, tests, documentation; user-facing strings are localised, English being the default (§10.9)                                                                               |

---

## 7. Stack selection criteria

| #   | Criterion                                    |
| --- | -------------------------------------------- |
| 1   | Works well on modern macOS                   |
| 2   | Claude Code understands the stack very well  |
| 3   | Modern, actively maintained                  |
| 4   | Broad UI capability with a contemporary look |

---

## 8. Candidate assessment

|                    | Electron + TS + React                                  | Tauri v2 + React                     | SwiftUI                        |
| ------------------ | ------------------------------------------------------ | ------------------------------------ | ------------------------------ |
| **1. macOS**       | good; not native, higher memory, but hiddenInset helps | good; lighter bundle (WKWebView)     | best; fully native             |
| **2. Claude Code** | **best**                                               | middling                             | good, but with risks           |
| **3. Maintenance** | Electron 43, VS Code / Figma / Slack                   | active                               | Apple; not cross-platform      |
| **4. UI**          | **widest**                                             | same, but WebKit instead of Chromium | narrower for custom interfaces |

### Why criterion 2 decided it

This is the deciding criterion because Claude Code writes all the code. The TypeScript/React advantage here is not marginal:

- TS/React is the most represented stack in the model's knowledge; fewer hallucinated APIs.
- **The Agent SDK is written in TypeScript** — types are available directly, with no bridge and no manual JSONL parsing.
- **shadcn/ui copies component source into the repository** rather than hiding it in `node_modules`. Claude can read and edit every component in full — qualitatively different from a black-box library.
- Tailwind keeps styles in the markup — the model does not have to keep JSX and a separate CSS file in sync.

**SwiftUI risks:** the API shifts noticeably between macOS releases and a model easily mixes idioms from different years; most examples in training data are iOS rather than complex desktop apps; custom multi-pane layouts are painful.

**Tauri v2 risks:** breaking changes between v1 and v2 (notably the plugin model) invite mixing two generations of API; iteration is slower because Rust compiles; Linux renders through WebKitGTK while macOS uses WKWebView — two engines with different bugs.

### Decision

**Electron + TypeScript + React** — wins criteria 2 and 4, acceptable on 1, excellent on 3.

It also preserves cross-platform reach (a Linux desktop) at no cost, though that is not among the current criteria.

---

## 9. Stack with versions

Versions below are **actually installed and verified** (`npm run check` and `electron-vite build` pass).

**Core**

| Package                        | Version      | Role                    |
| ------------------------------ | ------------ | ----------------------- |
| electron                       | 43.3.0       | shell                   |
| typescript                     | 5.9.3        | language                |
| electron-vite                  | 6.0.0-beta.1 | build                   |
| vite                           | 8.2.1        | bundler (Rolldown)      |
| @anthropic-ai/claude-agent-sdk | 0.3.224      | agent integration       |
| zod                            | 4.4.3        | on-disk data validation |
| vitest                         | 4.1.10       | core tests              |
| eslint                         | 10.8.0       | linting                 |
| typescript-eslint              | 8.66.0       | typed rules             |
| prettier                       | 3.9.6        | formatting              |

**UI**

| Package              | Version       | Role                           |
| -------------------- | ------------- | ------------------------------ |
| react                | 19.2.8        | rendering                      |
| tailwindcss          | 4.3.3         | styles (CSS-first config)      |
| @vitejs/plugin-react | 6.0.5         | React in Vite                  |
| i18next              | 26.3.6        | localisation                   |
| react-i18next        | 17.0.11       | React bindings                 |
| motion               | 13.0.0        | animation                      |
| lucide-react         | 1.30.0        | icons                          |
| zustand              | 5.0.14        | UI state                       |
| node-pty             | 1.1.0         | pseudo-terminals (native)      |
| @xterm/xterm         | 6.0.0         | terminal rendering             |
| @xterm/addon-fit     | 0.11.0        | terminal sizing                |
| shadcn/ui            | not yet added | added as components require it |

**Native modules.** Stage 1 started without them to avoid `electron-rebuild`, and that held until the embedded terminal arrived: `node-pty` is native and has to be rebuilt against Electron's ABI. A `postinstall` script does it automatically, so `npm install` remains a single step.

State is JSON; `node:sqlite` is available (verified on Node 26) and will be added when chat history needs searching.

#### One forced change from the original intent

**TypeScript 5.9.3 instead of 7.0.2.** `typescript-eslint` supports `>=4.8.4 <6.1.0`, canary builds included. This is not a conservative range but a consequence of TS 7 (`tsgo`) being rewritten in Go with a different internal API that typed linting cannot yet read. The choice is between TS 7 and the `strictTypeChecked` rules; the rules matter more (§11.3).

We return to it once `typescript-eslint` catches up. No architectural consequences.

#### Vite 8 came via a beta builder

`electron-vite@5` accepts only `^5 || ^6 || ^7`, putting Vite 8 out of reach. `electron-vite@6.0.0-beta.1` accepts `^6 || ^7 || ^8`, and with it the whole chain lines up: Vite 8.2.1 + `plugin-react` 6.0.5 + vitest 4 + `@tailwindcss/vite`.

The gain is measurable: the renderer bundle is **490 kB instead of 557**, and a build takes 47 ms instead of 263 — Vite 8 runs on Rolldown.

The cost is a builder in beta (released 2026-04-12). Verified in practice: `npm run check`, `electron-vite build` and an actual `npm run dev` all pass. Should the beta cause trouble, reverting to `electron-vite@5` plus Vite 7 is a one-line change.

#### Install trap

The `electron` package's `postinstall` can quietly fail to download the binary (~100 MB). Symptom: `npm run dev` fails with `Error: Electron uninstall` while the build succeeds. Check and cure:

```bash
ls node_modules/electron/dist   # must exist
node node_modules/electron/install.js
```

---

## 10. Design system

A calm desktop interface in the spirit of modern development tools (Linear, Raycast, VS Code): neutral base, thin separators, restrained accents.

**Why not neo-brutalism.** The style from [ytsykvas/family-shopping](https://github.com/ytsykvas/family-shopping) was the original basis — 3px black borders, hard `6px 6px 0` shadows, pervasive uppercase. In the running application it proved far too loud: this interface carries chat, diffs and logs, dense text read for hours, and aggressive styling fights it. The risk was noted in advance but only confirmed on screen.

A side benefit: shadcn/ui looks like this by default, so its components no longer need restyling.

### 10.1 Palette

| Token       | Light     | Dark      | Role                      |
| ----------- | --------- | --------- | ------------------------- |
| `canvas`    | `#ffffff` | `#0f1115` | page ground               |
| `surface`   | `#f7f8fa` | `#161920` | panes (sidebar, right)    |
| `muted`     | `#eef0f4` | `#1d212a` | fills, hover              |
| `line`      | `#e2e5ea` | `#282d38` | separators, 1px           |
| `ink`       | `#16181d` | `#e7eaee` | primary text              |
| `ink-soft`  | `#666e7d` | `#99a1af` | secondary text            |
| `ink-faint` | `#98a1b0` | `#6b7385` | captions, muted           |
| `accent`    | `#2563eb` | `#3b82f6` | primary action, selection |
| `success`   | `#16a34a` | `#22c55e` | status                    |
| `danger`    | `#dc2626` | `#ef4444` | status                    |
| `warning`   | `#d97706` | `#f59e0b` | status                    |
| `info`      | `#0891b2` | `#06b6d4` | status                    |

Every status has a paired `*-bg` background for badges and notices.

### 10.2 Shape and space

- Radii: `--radius-control` 6px for buttons and rows, `--radius-panel` 10px for panes.
- 1px borders in `line`. Panes are separated by borders, **not** shadows.
- Shadows only for things floating above content: `--shadow-pop`, `--shadow-modal`.
- Control heights: 24px (`sm`), 28px (`md`). The interface is dense because there is a lot of data.

### 10.3 Typography

- System font; base size **13px**, line height 1.55.
- No `uppercase`, no weight 900. Section headings use `.section-label`: 11px, weight 600, muted.
- Branches, paths and code are monospace (`font-mono`), 11px.
- Hierarchy rests on colour (`ink` → `ink-soft` → `ink-faint`) and weight, not size.

### 10.4 Ready-made classes

`styles.css` provides the base patterns — check them before writing new styles:

- `.panel` — surface with border and radius;
- `.row` / `.row-selected` — list row with hover and selection;
- `.section-label` — section heading;
- `.focus-ring` — visible keyboard focus;
- `.titlebar-drag` — window drag region.

### 10.5 macOS integration

- `titleBarStyle: 'hiddenInset'` with a managed `trafficLightPosition`;
- system font;
- native menu and the full set of system shortcuts;
- `vibrancy` is not used: translucency makes dense text harder to read.

### 10.6 Themes

Tokens are declared twice — at the base and under `.dark`; the renderer sets the class from a main-process event. Three modes are offered (light / dark / system) with a subscription to `nativeTheme.updated`.

Colours always go through tokens, never raw hex, otherwise the dark theme breaks.

### 10.7 Rules that are easy to break

- Text on an accent uses the `on-accent` token, not `text-white`.
- Statuses (`success`, `danger`, …) colour text or icons; only the paired `*-bg` is used as a background. Solid colour blocks make a list look like confetti.
- Empty states and hints use `ink-soft` so they do not compete with the content.

### 10.8 Screen layout

Conductor's layout is the model — proven by daily use and free of complaints. What is copied is the **structure of the space**, not the styling.

```
┌────────────────┬──────────────────────────┬─────────────────────┐
│   WORKSPACES   │        AGENT CHAT        │  CHANGES / TERMINAL │
│                │                          │                     │
│  planner       │  agent: reading auth.rb  │  ▸ app/user.rb      │
│   ● kyiv       │  ✓ Edit user.rb          │  + def call         │
│   ○ berlin     │  ✓ Bash rspec            │  -   old_impl       │
│                │                          │  +   new_impl       │
│  esl           │                          │                     │
│   ○ dili       │  > prompt…               │  [changes][terminal]│
└────────────────┴──────────────────────────┴─────────────────────┘
```

**Left pane — workspaces.** Grouped by project. Each row shows agent status. A workspace is recognised primarily **by its branch name**; the directory name (a city) is the secondary identifier.

**Centre — agent chat.** The main working area: the session event stream and the input field.

**Right pane — changes and terminal** in tabs. Shows what the agent did and gives manual access to the workspace.

#### Shortcuts

| Combination | Action              |
| ----------- | ------------------- |
| `⌘⇧N`       | new workspace       |
| `⌘⇧D`       | changes             |
| `⌘⇧P`       | pull request        |
| `⌘1`–`⌘9`   | jump to a workspace |

The right pane collapses — three columns do not fit on a narrow screen.

### 10.9 Language and localisation

**The entire repository is written in English**: code, comments, test names, error messages, documentation, commit messages.

User-facing strings never appear inline. They live in `src/renderer/src/i18n/locales/`, where `en.ts` is the source of truth and the default language. Other locales are typed against it, so a missing or renamed key is a compile error rather than a raw key rendered on screen.

Ukrainian ships alongside English.

Core throws errors carrying a machine-readable `code` and parameters; the renderer maps those onto localised messages. The English text on the error stays as a fallback for logs.

---

## 11. Architecture and code standards

### 11.1 The core/UI split

**The core knows nothing about the UI.** All logic sits in `src/core/`, plain TypeScript modules with no Electron imports whatsoever.

```
core/      all logic, headless, tested through vitest without Electron
   ↑ typed methods and events
main/      thin IPC bridge, no logic
   ↑ contextBridge
renderer/  UI, fully replaceable
```

The core can be lifted into a CLI or a daemon without rework.

### 11.2 Technical rules

- SDK events are mapped onto the flat `AgentEvent` type — SDK changes do not leak into the UI.
- External processes go through `execFile`, never `exec` (branch names come from the user).
- All paths via `path.join()`; no hardcoded `~/Library` or `/Users/...`.
- Shortcuts through `CmdOrCtrl`.
- State writes are atomic (temp file + rename).

---

### 11.3 Code quality standards

The codebase follows **the best practices of its stack**. This is a condition, not a wish: the project is meant to live a long time and almost all of its code is written by an agent, so the rules must be machine-checkable rather than verbal.

#### Cleanliness

- One unit of code, one responsibility. A function doing two things gets split.
- Functions stay short; nesting stays shallow (early `return` over `else` ladders).
- Names are explicit and domain-shaped: `createWorkspace`, not `doStuff`; `staleSessionIds`, not `arr2`.
- No magic values — named constants (`PORT_RANGE_START = 3000`).
- Dead code and commented-out blocks do not stay in the repository: git holds the history.
- Comments explain **why**, not **what**. Code that needs a "what" comment gets rewritten.

#### Reuse

- DRY within reason: the third repetition is the cue to abstract (twice is still fine).
- Shared utilities live in `core/` rather than being duplicated between `main/` and `renderer/`.
- Composition over inheritance; small pure functions over stateful classes where no state is needed.
- The UI is assembled from reusable design-system components, not one-off markup per pane.

#### Typing

- `strict: true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`.
- `any` is forbidden. For genuinely unknown data, `unknown` narrowed afterwards.
- Data arriving from outside (files on disk, git output, SDK events) is validated with zod at the boundary; past that point it is typed.
- Types derive from zod schemas (`z.infer`) so schema and type cannot drift.

#### Testing

The coverage target is differentiated, and that is a deliberate decision rather than a relaxation:

| Layer               | Target        | Why                                                                                          |
| ------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `core/`             | **100%**      | pure headless logic without Electron; trivially testable, and this is where costly bugs live |
| `main/`, `preload/` | IPC contracts | a thin proxy layer; the point is that channels carry what they promise                       |
| `renderer/`         | behaviour     | tests on user actions rather than markup snapshots                                           |

The 100% figure for `core/` is a threshold in `vitest.config.ts` and fails the build when it drops.

We deliberately do **not** chase 100% on UI and IPC: there, chasing the number breeds hollow tests that catch nothing yet break on every refactor. Coverage is a tool, not a metric for a report.

Further rules:

- tests are written with the code, not "later";
- one test covers one behaviour; the name describes the scenario, not the method;
- external boundaries (git, filesystem, SDK) are faked at their own module level, no deeper;
- prefer driving real git in a temporary repository over mocking it — parsing its output is where assumptions fail;
- a bug that reached runtime is reproduced by a test first and fixed second.

#### Automated checks

- **ESLint** (flat config) with `@typescript-eslint` in the strict preset, plus React hook rules.
- **Prettier** — formatting is neither discussed nor reviewed by hand.
- **Type checking** as a separate step (`tsc --noEmit`), because the bundler does not do it.
- One aggregate script `npm run check` = lint + types + tests + coverage. It is also the pre-commit gate.

#### Commits

- Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`) — a readable history and a basis for changelog automation later.
- Atomic commits: one logical change each.
- Work goes straight to `main` while this is a single-author project: with no review, a branch per change is friction without benefit. Revisit once octopus opens pull requests itself.

---

## 12. Stage 1 functional requirements

### 12.1 Workspaces

- Create a workspace: `git worktree add -b <prefix>/<name> <path> <base>`.
- The branch prefix is configurable (a sensible default is the GitHub username).
- List workspaces with status, reconciled between `git worktree list --porcelain` and our own state.
- Removal with a check for uncommitted changes.
- Diff: `git diff <base>...HEAD` plus `git status --porcelain`.

### 12.2 Scripts

- `setup.sh` — runs after the worktree is created (copying `.env`, installing dependencies).
- `run.sh` — the dev server; receives `$OCTOPUS_PORT`.
- The port is derived deterministically from the workspace id, range 3000–9000, checked for availability.

### 12.3 The agent — the key requirement

```ts
const q = query({
  prompt: userInputStream, // async generator — follow-ups without a restart
  options: {
    cwd: workspace.path,
    resume: workspace.sessionId, // continues after an application restart
    settingSources: [], // ← nothing is loaded implicitly
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    canUseTool: async (req) => {
      /* our own permission dialog */
    }
  }
})
```

**`settingSources: []` is the technical answer to the main complaint about Conductor.** The SDK loads no settings and no `CLAUDE.md` implicitly; everything entering the context is added by us, deliberately. The config exposes a switch: nothing / `project` / `user + project + local`.

Session control: `interrupt()`, `setModel()`, `setPermissionMode()`, `streamInput()`, `close()`.
The `sessionId` from `SDKSystemMessage` is persisted — that is what enables resuming after a restart.

### 12.4 On-disk layout

Everything under one directory (Conductor spreads across `~/conductor` and `~/.conductor`):

```
~/.octopus/
  config.json                global settings
  state.json                 workspaces, session ids, statuses
  projects/<slug>/
    scripts/setup.sh
    scripts/run.sh
  workspaces/<slug>/<name>/  ← git worktree
```

---

## 13. Non-functional requirements

- Cold start to interactive: under 2 s.
- State survives a crash: atomic writes, zod validation on read, a clear error instead of a silent reset.
- Errors from git and scripts surface with full stderr rather than being swallowed.
- The core is covered by vitest without launching Electron.
- No secrets in `state.json`; authentication remains Claude Code's business.

---

## 14. Project layout

```
/Users/tsykvas/projects/octopus/
  src/
    core/
      paths.ts       every path
      persist.ts     atomic JSON with zod validation
      config.ts      settings, setting-source switch, licensing hooks
      store.ts       projects and workspaces, port assignment
      types.ts       Workspace, Project, AgentEvent, WorkspaceStatus
      git.ts         git operations
      projects.ts    repository validation, project records
      service.ts     core facade for the IPC layer
      worktree.ts    (next) worktree operations
      agent.ts       (next) Agent SDK, event mapping
    main/index.ts    window + IPC
    preload/index.ts contextBridge, typed API
    renderer/
      src/
        components/  UI components
        hooks/       React hooks
        i18n/        localisation, en is the source of truth
        styles.css   design tokens
```

---

## 15. Hooks for authentication and monetisation

> **Priority: distant future.** The tool is built purely for personal use. This section affects nothing in stage 1 and blocks nothing.
>
> Only **§15.3** is actually implemented right now — three fields in the config and one stub. The rest is written down so the architecture does not need rework if it ever comes to selling.

### 15.1 Anticipated model

A separate auth service (written later) plus licensing in the client:

| Tier         | Terms            |
| ------------ | ---------------- |
| Trial        | first month free |
| Subscription | $5 / month       |
| Full access  | $20 one-off      |

### 15.2 Authentication scheme

Authentication through our own service at launch. The service checks the account status and decides whether to let the user in — but issues a **signed token** rather than a one-off yes/no.

```
first launch
  └─→ sign in via the service ──→ token (Ed25519, TTL ~14 days) ──→ cached locally

later launches
  └─→ signature verified locally, no network
        ├─ token valid          → straight in
        ├─ expired, online      → silent background refresh
        └─ expired, offline     → grace period, then blocked
```

Why not an online check on every start:

- **Offline.** This is a developer tool whose work is entirely local. An app that refuses to open on a train or bad Wi-Fi is more irritating than any surplus UI element — precisely the problem we are escaping.
- **Single point of failure.** If the service is down, everyone is locked out. At a $20 price point the required uptime does not pay for itself.
- **It adds no protection** (see §15.4), so the cost is paid for nothing.

A short-lived token keeps control: a cancelled subscription or a refund revokes access within the token's lifetime at worst. This is the standard scheme (JetBrains, Sublime, Tailscale).

### 15.3 What is reserved now (zero cost)

- **`src/core/entitlements.ts`** — a single point answering "is this allowed". In stage 1 it is a stub always returning `{ status: 'unlimited' }`. What matters is that every future feature gate goes **through it from day one** rather than being scattered through the code later.
- **`deviceId`** in `config.json` — a stable UUID generated on first run. Unused today; later the anchor for licence binding and trial accounting.
- **`installedAt`** — first-run timestamp, needed to count the trial.
- **Room for `ownerId`** in the state types — no structure hardcodes the assumption of exactly one user.
- **The core/UI split (§11) is the main hook.** It is what would later allow lifting the core into a headless daemon, the foundation for cloud execution if that ever becomes relevant.

There is no networking layer at all right now — it arrives with the auth service.

### 15.4 Honest note on protection

An Electron application is JavaScript in an `asar` archive that unpacks with one command. **Any client-side licence check is bypassed by patching one file**; obfuscation buys hours, not more.

The practical conclusion: a check makes sense as a barrier for honest people and as a convenient way to pay — not as protection. At $5–20 that works out fine: the time to break it costs more than the licence. Real protection comes only from a server component the product is incomplete without.

A consequence for the trial: a local first-run date resets when `~/.octopus` is deleted. If that matters, the trial has to be registered server-side against `deviceId`, which means the network is required on first start. Once issued, the licence should be cached signed (Ed25519 / JWT) with a grace period so the app works offline.

### 15.5 Note on pricing

$5/month against $20 one-off is four months to break even. At that ratio essentially nobody picks the subscription, so in practice there would be a single $20 tier. If the subscription is meant to be a real option, the usual ratio for a lifetime licence is 20–30 monthly payments (here $100–150), or at least two years.

### 15.6 A risk worth keeping in mind

Conductor gives its local application away **free** and monetises only the cloud ($50/month), multiplayer and team features. Selling a local wrapper while a direct competitor gives one away is a hard position.

Additional pressure from the platform: Claude Code already works with git worktrees on its own (`EnterWorktree` / `ExitWorktree` are built into the agent). The niche for standalone worktree wrappers narrows as the platform absorbs these functions.

This is not an argument against the hooks — they are free. It is an argument against spending time on the auth service now.

---

## 16. Out of scope for stage 1

Monaco diff, GitHub PRs and checks through `gh`, notifications, workspace archiving, Linux builds, signing and notarisation, the auth service and licensing (§15).

The terminal moved into scope early: account sign-in needs an interactive session, and sending the user to Terminal.app for it broke the sense that this window is where the work happens. The same component will fill the right pane's Terminal tab.

---

## 17. Open questions

- **Workspace naming** — cities as in Conductor, task-derived names, or generated from the prompt text.
- **Tool permissions** — which are automatic, which prompt, whether per-project profiles are needed.
- **Cross-platform** — whether Linux stays in the plans (affects CI only, not architecture).
- **Task sources** — creating a workspace from a GitHub issue or a Linear ticket, as Conductor does.
- **Code review** — inline comments on a diff that become attachments to the prompt.
- **Several agents per workspace** — whether parallel runs in one directory are needed.
- **What the list shows** — agent status, change count, CI state, session cost.
- **Monetisation model** — whether $20 stays as full access (see the note in §15.5), and whether a separate auth service is warranted at all given the risks in §15.6.
