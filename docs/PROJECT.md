# octopus

> The main context document for the project. Describes what is being built and why, and records the requirements for stage 1.
> The stack is settled; the remaining sections grow through discussion.

---

## 1. What this is

**octopus** is a local macOS application for running Claude Code sessions in parallel: a dispatcher for agent tasks where each task executes in its own isolated copy of a repository.

Instead of waiting for the agent to finish one task, the developer starts several at once — each in a separate git worktree with its own branch, its own agent sessions and its own dev server. The tasks never see each other and never conflict.

**The goal** is a tool for daily personal work that imposes no foreign workflow and does not interfere with what the agent receives. Not a product for sale, not a service, not a team tool.

---

## 2. The problem

This way of working is already in use through [Conductor](https://www.conductor.build/), and the model itself has proven its worth. The implementation is what falls short:

| Problem                                         | Consequence                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Extra material injected into agent instructions | context receives things we never wrote; agent behaviour becomes opaque |
| Inflexible workflow                             | an imposed order of steps instead of one's own                         |

octopus once answered the first by loading nothing at all — no `CLAUDE.md`, no
settings, no commands, no skills. That was the wrong lesson, and it is worth
recording rather than quietly deleting: the objection was to material **we add**
that nobody wrote, not to material the user wrote for their own agent. Refusing
to read the project's own instructions did not make the agent more transparent;
it made it less capable than the same model in a terminal.

The rule now is narrower and holds: octopus adds nothing of its own to the
context, and withholds nothing the user has put there **except what they asked
it to withhold**. The exception is the skills panel, and it is a real one: a
conversation can be told to leave a skill out of the agent's listing. What
makes it consistent rather than a hole is who is asking — the user, in a panel
they opened, about one conversation. The app still withholds nothing on its
own initiative.

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
- **up to three agent conversations** — each with its own `session_id`,
  surviving application restarts. The id is stored on the conversation rather
  than on the workspace, which is what made the third one a record rather than a
  migration (§12.3); they share the worktree and run without locking (§10.8);
- **a dev server** — on its own port, so several copies of the app run at once;
- **a diff** — changes relative to the base branch.

### Task lifecycle

```
task → workspace → agent works → diff → PR → merge → archive
       (worktree    (isolated,    (review) (gh)        (worktree removed,
        + branch     own session)                       history kept)
        + .env)
```

---

## 4. Guiding principles

**We add nothing of our own, and we withhold only what we were told to.** octopus puts no text of its own into the agent's context — no additions to the system prompt, **no skill of ours**, and the prose it does send goes as a visible user message the reader wrote and can edit. It equally does not stand between the agent and what the user has written for it: `CLAUDE.md`, settings, commands, skills and subagents all load, exactly as they do in a terminal. An agent that knows less here than there is a defect, not a feature.

The skills feature is the one place both halves need a sentence, because it looks like a breach of each and is neither. What reaches a session from octopus's two stores is **the user's own skills**, written or imported in this app — ours in storage, never in authorship. And a skill switched off in a conversation is withheld because somebody switched it off there, which is the user deciding what their agent reads rather than the app deciding for them. Nothing is ever withheld that was not named in a panel or a settings list.

**A thin layer.** The application manages worktrees, processes and the UI. It does not try to outsmart the agent, rewrite prompts or decide on the user's behalf.

**The core knows nothing about the UI.** All logic is headless and tested without Electron.

**Your own workflow.** No step is mandatory: a workspace can be created and abandoned, work can happen without a PR, scripts can be run by hand.

---

## 5. Non-goals

**Never:**

- Not a multi-agent platform — **Claude Code only**, no Codex/Cursor/Gemini.
- Not an IDE replacement, not a terminal replacement.
- Not for the App Store.

- Not sold. Monetisation was designed in detail — tiers, a licence token, trial accounting — and then dropped, along with the section describing it. Two things killed it. A client-side licence check in an Electron app is bypassed by patching one file, so it can only ever be a convenience for honest people rather than protection; and Conductor, the direct comparison, gives its local application away and charges for cloud work this project does not do. Selling a local wrapper against a free one was a hard position for a benefit that was never real. The app is MIT-licensed and built from source.

**Not now:**

- Cloud execution of workspaces — everything is local, no backend.
- Accounts and authentication.
- Team work and synchronisation.

---

## 6. Settled decisions

| Decision                                      | Rationale                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent — Claude Code only                      | direct integration through the Agent SDK instead of an abstraction over several agents                                                                                                                                                                                          |
| Distribution outside the App Store            | the sandbox (Guideline 2.4.5) forbids executing third-party binaries and writing outside the container (2.5.2); child processes do not inherit security-scoped access. Built from source and unsigned — a self-built app carries no quarantine flag, so it needs no certificate |
| Layout — a project tab strip plus three panes | Conductor's UI is proven by daily use; the structure of the space is copied, the visual style is our own. Projects moved to a strip because one tree for projects and workspaces outgrows the window (§10.8)                                                                    |
| Stack — Electron + TS + React                 | see sections 7–9                                                                                                                                                                                                                                                                |
| Repository language — English                 | code, comments, tests, documentation; user-facing strings are localised, English being the default (§10.9)                                                                                                                                                                      |

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
| node-pty             | 1.1.0         | pseudo-terminals (native)      |
| @xterm/xterm         | 6.0.0         | terminal rendering             |
| @xterm/addon-fit     | 0.11.0        | terminal sizing                |
| shadcn/ui            | not yet added | added as components require it |

**Shared state is a hook, not a store.** `zustand` sat in this table naming
itself as what holds UI state, and nothing ever imported it: every value two
panes share — the workspaces, the projects, the review notes, the composer
drafts — is a hook whose value `App` holds and passes down. A dependency that is
a claim rather than a tool is worse than none, because the next person to reach
for shared state reads the line, adds a store, and the application has two ways
of doing one thing. If the prop threading ever stops being shallow, that is the
moment to reconsider — not before.

**Native modules.** Stage 1 started without them to avoid a build step, and that held until the embedded terminal arrived: `node-pty` is native. A `postinstall` script runs `electron-builder install-app-deps` — the same tool that packages the app, so the two cannot disagree — and `npm install` remains a single step. The binding is built through Node-API rather than against V8 directly, so it is not tied to Electron's ABI: the same binary loads under plain Node and under Electron.

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
┌────┬──────────────┬──────────────────────────┬─────────────────────┐
│    │  truthnode   │        AGENT CHAT        │  CHANGES / TERMINAL │
│ TR │  origin/main │                          │                     │
│    ├──────────────┤  agent: reading auth.rb  │  ▸ app/user.rb      │
│ RT │  ● anna      │  ✓ Edit user.rb          │  + def call         │
│    │  ○ maria     │  ✓ Bash rspec            │  -   old_impl       │
│ ES │  ○ sofia     │                          │  +   new_impl       │
│    │              │                          │                     │
│ +  │              │  > prompt…               │  [changes][terminal]│
└────┴──────────────┴──────────────────────────┴─────────────────────┘
```

**Tab strip — projects.** A colour each, and either two initials or an icon chosen in the project's settings. The colour is stored on the project rather than derived from its name: a hash would repaint the project the moment it was renamed, and constancy is what makes it recognisable. Fifteen colours, each measured for contrast in both themes. The initials are the fallback rather than the goal — two letters collide as soon as two repositories start alike, and 36px hold a picture or a pair of letters, not both.

**Title bar — where you are.** The project's name, its directory, and the branch of the selected workspace. The branch used to sit in the chat's own header, which spent a whole row on one short string while answering a question about the window rather than about any conversation in it — the row it left belongs to the tab strip now.

**Second pane — workspaces of the active project.** Carries a gradient wash of that project's colour, strongest at the project name and fading down the list, so "where am I" reads peripherally rather than by reading names. A workspace is recognised primarily **by its branch name**; the directory name is the secondary identifier.

**Centre — agent chat.** The main working area: the session event stream and the input field.

A workspace holds up to **three conversations at once**, switched by a strip of underlined tabs across the pane's header row. Each is called after the agent that runs it and its place in the strip — `Claude 1`, `Claude 2` — which is a name that needs no inventing and stops being a guess the moment there is a second kind of agent. A conversation can be given a name of its own by double-clicking its tab, and clearing that name gives the automatic one back. Each tab carries the same status dot the workspace list uses, so which agent is working, which is waiting on an answer and which has stopped is readable without opening any of them. A conversation is created empty; a tab's menu also offers to continue an existing one in a new tab, which forks the agent's session so the two diverge from a shared past.

They run in the same worktree with no locking between them, deliberately (§16). Every tab stays mounted while its workspace is open, so a conversation keeps its place in the log and the answer being streamed into it while another is on screen — but only the one showing may raise a dialog, since a modal about work the reader cannot see is the worst kind of interruption.

**Right pane — changes, terminal, scripts, the pull request and notes** in tabs. Shows what the agent did and gives manual access to the workspace. Draggable, and both its width and which tab is showing persist. Whether it is folded away does not — that is a mood about the current window. Its active tab carries the open project's colour, falling back to the accent while no project is open.

#### Shortcuts

| Combination | Action              |
| ----------- | ------------------- |
| `⌘⇧N`       | new workspace       |
| `⌘1`–`⌘9`   | switch project      |
| `⌃1`–`⌃9`   | jump to a workspace |
| `⌥1`–`⌥3`   | switch conversation |
| `⌘T`        | new conversation    |
| `⌘⇧D`       | changes             |
| `⌘⇧P`       | pull request        |

`⌘⇧P` opens the pull request tab, which is what it was waiting for. Listing a shortcut that does nothing is worse than listing none: it is read once, tried once, and the rest of the table quietly distrusted along with it — which is what `⌘⇧D` did here for a fortnight, and what `⌘⇧P` did until there was a tab to name.

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
- Every substantial change reaches `main` through a branch and a pull request, which CI gates. While the repository is private and one person is developing in it, `main` also accepts direct pushes and **the remote enforces nothing** — branch protection is unavailable for a private repository on this plan. Protection goes back on when the repository goes public, administrators included; `CLAUDE.md` holds the reasoning and the story that produced it.

---

## 12. Stage 1 functional requirements

### 12.1 Workspaces

- Create a workspace: `git worktree add -b <prefix>/<name> <path> <base>`, and **the base is fetched first**. Until it was, `<base>` meant this checkout's copy of the base branch as of whenever somebody last fetched by hand — measured on a real project, a fortnight behind, with the cost landing at review as conflicts or as work already merged being done again. A base stored as a local name resolves to its remote counterpart, because a fetch does not move a local branch; `origin/develop` is used as it stands. A remote that refuses or cannot be reached **stops the creation**, since a workspace quietly cut from a stale base is the failure being prevented. A repository with **no remote** — a project added from a local folder that was never pushed — has nothing to fetch and nothing that could be stale, and is created exactly as before.
- Everything that measures against the base follows it to the same ref: the diff's merge base, the count of commits ahead, the merged check before a removal. `main` and `origin/main` are the same point only until somebody else pushes, and measuring against the local one reports their commits as this workspace's work.
- The branch prefix is configurable (a sensible default is the GitHub username).
- List workspaces with status, reconciled between `git worktree list --porcelain` and our own state.
- Removal with a check for uncommitted changes.
- Diff: `git diff <merge-base>` against the working tree, plus
  `git ls-files --others --exclude-standard` for what nobody has added yet. The
  three-dot form compares two commits and so cannot see the working tree, which
  is most of what there is to review; resolving the merge base explicitly gives
  the same left-hand side and takes committed, staged and unstaged work at once.
- **Revert, per file, from the pane's header.** It puts that file back to the state the workspace branched from — the pane's own scope, so the row leaves it. Committed work is not erased: the commits stand and what is written is a change in the working tree that undoes them. Uncommitted work is, and nothing in git holds a copy of it, which is what the confirmation says rather than warning in general. Which command runs is decided by asking git whether the base commit had the path and whether it is tracked now, rather than by branching on the status the diff reported — rename detection is a heuristic, and a wrong guess would send a file down the wrong arm.

### 12.2 Scripts

- **A project can be pointed at another checkout**, but only while it has no workspaces. Each one is a git worktree registered in the **current** repository's `.git/worktrees`; repoint and git in the new one knows nothing about them — every workspace reads as missing, the interface closes their terminals, and `git worktree remove` then fails, so they cannot even be cleaned up through the app. A warning would arrive after that is already true, so the control is disabled with the reason underneath instead. What the project keeps stays: scripts, variables and instructions are filed under its **id**, not under its path.

- `setup.sh` — prepares a workspace: installing dependencies, building what a fresh checkout needs. Runs on a button, not on workspace creation — no step is mandatory (§4).
- `run.sh` — the dev server; receives `$OCTOPUS_PORT`.
- `archive.sh` — runs when a workspace is removed, in its directory, while it still exists. It takes back what setup gave out — a database or a container named after the workspace. Nothing it does can stop the removal: a workspace that cannot be deleted because a cleanup script is broken is the worse problem of the two.
- One **Run** on the Scripts tab does both in order: build, then serve when the build succeeds. A failed build stops there; a missing build script is skipped rather than waited on. Once a server is up, Run gives way to a link to its port, **Restart** and **Stop**. Running is decided on that header and never in the halves, which is why there is one Run rather than a button in each.
- Beside it, and unchanging as all of that turns over, **the way to the scripts themselves** — it opens the project's Scripts section. The offer to write one appears where a script is missing and therefore disappears the moment it exists, which left the tab that runs `setup.sh` with no way to open it.
- **Ports come from a pool, ten at a time.** A workspace owns `$OCTOPUS_PORT` and the nine after it, named `$OCTOPUS_PORT_1`…`_9`: one port is not enough for a stack that is more than one process. Twenty blocks live at 3100–3299 — small enough to reason about and firewall, and far past what anybody runs at once. 3000 is deliberately outside it, being what an unconfigured framework binds.
- A block is free when no workspace holds it **and nothing answers on it**. The old scheme checked only our own records, so a port another application held was handed out anyway and the server failed as it bound, blaming itself.
- Before a run, and only while nothing of that workspace is alive, the port is checked again — with nothing of ours running, anything answering belongs to somebody else. A taken port moves to a free block silently: the pane shows the number and the open link follows it.
- A project also holds a **list of files to carry**: one path per line, relative to the checkout. A worktree holds what git tracks and nothing else, so gitignored files — an `.env`, a `config/master.key` — have to be brought. Copied at creation and again before a run, never over a file the worktree already has — except one holding nothing but octopus's own env block, which is discarded first, or it would refuse the real file for ever. This is why fetching them is no longer the first line of every setup script.
- A line may name **where its file comes from** (`.env = ~/work/planner/.env`), for the checkout that has not got it: a project cloned from GitHub has no gitignored file at all, while the real one sits in another copy of the same repository on the same disk. The source is a fact about the machine, so it is stripped out of the copy the repository carries.
- `$OCTOPUS_PORT` may be named **inside the env overrides**, where it becomes that workspace's own port — the block is one text for the project, and the port is the thing that differs. Only the `OCTOPUS_*` names are substituted: a password containing a `$` has to survive untouched. A run settles the port before writing the block, not after.
- The block is **checked as it is typed** for the four mistakes that fail silently — no assignment, an impossible key, a key set twice, a mistyped `$OCTOPUS_…`. Warnings, not a refusal: someone else's parser reads the file.
- The Build header's `Env` menu reaches all three: the variables, the carried files, and this workspace's env file as it stands — read-only, since the block is rewritten on every run. octopus also checks that git ignores that file, because it writes credentials into a directory the agent commits from freely.
- A project also holds **env overrides**, in **named sets**: `KEY=value` lines typed in its settings and appended to every workspace's env file — `.env` unless the project names another, because Vite and Next read `.env.local` — between markers so a change replaces rather than piles up. Last wins, which is the point twice over — it overrides a checkout left pointing at production, and it is the whole file for a project cloned from GitHub, where a fresh clone has no gitignored `.env` to carry in the first place. They are appended only: nothing exports them into the shell, so the terminal sees them just through whatever reads `.env`.
- **Which set is a choice, not a comment.** A project keeps several — a dev one and a production one, say — one of them is its default, and any workspace may sit on another; `null` on a workspace means it follows the project, which is a third state rather than a copy taken at creation. This exists because the alternative was watched failing: a checkout whose `.env` carries both and switches by commenting a block out, copied into the settings while it happened to be on production, pointed every workspace at production — past a setup script written to prevent exactly that, because the block is written last and always wins. A set whose file has gone resolves to **nothing**, never to the default: a workspace pinned to production must not silently receive dev credentials, and an empty block fails loudly on a variable nobody wrote.
- The sets are files under `envs/`, mode `0600` in a directory that is `0700` — at `0755` the _names_ are world-readable, and "prod" is information. A name is therefore a boundary rather than a label: lowercase letters, digits and dashes, enforced because macOS is case-insensitive by default and `Prod` and `prod` would be one file under two names.
- All three scripts are given `$OCTOPUS_ROOT_PATH` (the checkout), `$OCTOPUS_WORKSPACE_NAME` and `$OCTOPUS_WORKSPACE_SLUG`; only the server also gets `$OCTOPUS_PORT`.
- **The slug is the name in a form an identifier can hold** — lowercased, every other character an underscore, truncated to 30 so a prefix still fits inside Postgres' 63. The name is the label as typed and renaming only trims it, so `myapp_development_$OCTOPUS_WORKSPACE_NAME` writes `myapp_development_Fix login bug` the moment somebody renames a workspace to a sentence; dotenv reads to the first space and nothing says so. A script could slugify what it is given, but the env block is static text with no shell around it — and a per-workspace database is the main thing the block exists for. The rule is the one the shell pipelines in Conductor's own setup scripts use, so a slug built here and one built there are the same string, and the script that creates a database and the script that drops it cannot disagree.
- **The scripts may come from the repository, and they win.** The chain for each of the three, in order: `.octopus/scripts/` in the worktree, then `.conductor/settings.toml`, then the project's own settings. A clone therefore works with nothing configured, which is the point — a second developer, or the same one on a second machine, does not write the same three scripts again. It is per script rather than per repository: a checkout naming only a server script leaves the other two to the project. `.conductor` is read because a repository already set up for the tool octopus is modelled on should work here unchanged; its scripts are **command lines** rather than files, so they go to a shell as written, and a script resolved from there is also given `CONDUCTOR_ROOT_PATH`, `CONDUCTOR_WORKSPACE_NAME`, `CONDUCTOR_DEFAULT_BRANCH` and — for the server — `CONDUCTOR_PORT`. The workspace name it receives is the **slug**, so the repository's own slugify is a no-op and the database its build script creates is the one its cleanup script drops.
- **A repository's script does not run until somebody has read it.** Its text is shown in full on the Scripts tab — every byte, because an approval over a summary is an approval of the summary — and Run stays disabled until it is allowed. Approval is a digest, so a `git pull` that rewrites the script asks again, and it is kept in `approvedScripts`, a list of its own: what the agent may load and what the Run button may execute are different questions, and one list would mean reading a hook file quietly approved a build script. A script the user wrote in Project settings is never gated — asking somebody to approve their own text is a dialog they learn to click through. **Cleanup is the one exception**: nothing may stop a workspace being removed, so an unapproved script there is skipped rather than refused, which leaves a database behind and is the lesser of the two.
- **The environment never comes from the repository.** Variables are credentials and stay on this machine. That is the line the whole arrangement rests on: the repository decides _what runs_, the machine decides _what it runs against_. A pull can change the build script; it cannot point a workspace at production.
- **A repository may also carry a copy of the settings themselves.** Everything above lives under `~/.octopus`, which is one directory on one machine; a project's repository can hold the same scripts, carry list, instructions and fields in `.octopus/`, so a wiped installation is rebuilt from the repository rather than from memory.
- **Import and Export are still how that copy moves** — Import shows every byte of a file before writing it, Export writes the directory from what the app holds. Which side is newer is deliberately never guessed: contents are all there is to go on after a clone, so the panel says the two differ and offers both directions. Nothing is written into `.conductor/`, ever; it is read and nothing else.
- The env overrides are the one thing that never travels: they are credentials, and a secret pushed to a public remote has been published whatever the next commit does. Exporting is also the only write octopus makes inside a checkout, which is why `SECURITY.md` names the directory and a test walks the path constants. [repo-config.md](repo-config.md) is the whole of it.

### 12.3 The agent — the key requirement

```ts
const q = query({
  prompt: userInputStream, // async generator — follow-ups without a restart
  options: {
    cwd: workspace.path,
    resume: chat.sessionId, // continues after an application restart
    settingSources: ['user', 'project', 'local'], // ← as the CLI loads them
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    canUseTool: async (req) => {
      /* our own permission dialog */
    }
  }
})
```

**octopus is a harness around Claude Code, not a filter on it.** Every settings source is loaded, so the agent arrives knowing what the project and the user have written for it: `CLAUDE.md`, `.claude/settings.json` at all three levels, file-based subagents, `.claude/commands/`, skills, hooks, MCP servers. `Must include 'project' to load CLAUDE.md files` is the SDK's own wording, and it is why the old default made the agent worse than the terminal.

The config keeps the switch — nothing / `project` / `user + project + local` — for anyone who wants isolation; it is simply no longer what everybody gets. Version 2 of the config raises an install that was still on `nothing`.

**A repository is asked about before it is believed.** Loading every source means
a clone can pre-approve tools through `permissions.allow`, run shell commands
around every tool call through `hooks`, and start servers through `.mcp.json`.
Those files — and every file under `.claude/hooks/`, since settings only name
the script and not what it holds — are digested and approved once per project, a
set so two branches do not ask in turn. The directory is read whole rather than
by resolving the names: a hook `command` is a shell line, so there is not always
a path in it to resolve. A link leading out of the worktree is shown and
digested by where it points, never read. Until then a session starts with the user's own layer alone: the agent runs
but reads nothing of the repository's, `CLAUDE.md` included, and the chat says
so. Prose is deliberately outside the digest — it changes constantly, and a
dialog that fires on every edit is one people learn to click through.

What octopus does **not** do is add: no text is appended to the system prompt, and no skill it wrote is bundled — the two stores it hands over hold what the user put in them. The prose the app sends is seven instruction files — describing a change for a pull request, writing a commit message, fixing failing checks, answering a review, reviewing one, reviewing it with several subagents, resolving a conflict — and each goes as a visible user message in the log. They are files rather than strings in the app precisely because of this section: a prompt nobody can read is a prompt nobody can correct, so each ships with a written template, is edited in Settings, and is overridden per project. Emptying one is how a project says it adds nothing.

**A repository may supply that prose too**, through the same chain the scripts use: `.octopus/instructions/` in the worktree, then the four `[prompts]` in `.conductor/settings.toml` that have a counterpart here, then the project's, the installation's, and the written template. Unlike a script it is **not** gated — this text goes into the log as a visible user message, where it is read before it does anything, and a dialog in front of every one would be friction for no gain. `general` is deliberately not among the four: octopus adds nothing to the system prompt, and importing a general prompt would make it start doing so without saying it had.

The project settings dialog lists what the agent picked up on its own, so "what is it working from" is a question the app can answer.

**Skills are the one source with a switch on it.** Two stores of the user's own
— one for every project, one per project — reach a session as **extra
working-directory roots**, each a directory with a `.claude/skills` inside it,
and the composer's panel turns any of them off for one conversation along with
whatever the checkout's `.claude/skills` carries.

**Both roots go over at session start whether or not either holds anything**,
and both directories are created on the way. An empty store used to be left
unmentioned, on the reasoning that a root widens what a session may reach and
buys nothing when there is nothing in it. It buys the ability to fill it: the
roots are handed over once, and the reload a write triggers re-scans only the
directories the session already knows about — so a store that was empty when a
conversation started stayed invisible to it for good, every skill written into
it and not merely the first. That is the state of every fresh install, and the
panel listed the new skill as available throughout, because it re-reads disk on
every call. The one case where omitting a root is still right is a
`settingSources` with no project layer, where the SDK reads no `.claude/skills`
under any root.

**A local plugin was the obvious answer and is the wrong one.** It was built
that way first and measured against a live session: a plugin's skills load and
appear in the listing, and `skillOverrides` does not touch them — not under the
qualified name, not under the bare one, not from the flag layer and not from a
settings file — while the same override hides a skill discovered the ordinary
way. The allow-list (`Options.skills`) does work on a plugin, and would have
hidden Claude Code's own bundled skills along with it, since octopus cannot
enumerate those to put them back. So the store became a root, and its skills
are now exactly as switchable as the checkout's own. `probe`-style scripts
under `docs/` are not kept, but the readings are: 19 skills in the session, 18
of them untouched, the one named in the override gone.

Three details follow from that. It is a **deny-list**: only what is off is
named, so the bundled skills are never hidden by accident. It is a **context
filter and not a sandbox** — the SDK's own words — so a skill switched off is
out of the listing and still on a disk the agent can read, which the panel says
in as many words. And because a root's skills are discovered exactly as the
checkout's are, they **follow `settingSources`**: under "load nothing" the
panel is empty and the agent has none of them, which is the honest reading of
that setting.

**One slash command is answered here rather than by the CLI.** A harness does not filter what reaches the agent, and this is not that: `/usage` asks the local process to print figures it already holds structured, and the CLI prints them as prose. `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` is documented as "the structured data behind the `/usage` command", so the service recognises the command, reads the report and draws a card of bars — plan windows and when they reset, what the session spent, and the local scan of what has been eating the limit. Everything else, `/clear` included, goes to the agent as ordinary message text. The card is the only surface in the app that shows a session's cost in dollars, for the reason given in §16.

Session control: `interrupt()`, `setModel()`, `setPermissionMode()`, `streamInput()`, `close()`.
The `sessionId` from `SDKSystemMessage` is persisted — that is what enables resuming after a restart. It is stored on the **chat**, not the workspace: one session per workspace would make a second agent in the same worktree a migration, while one per chat makes it another record. That is exactly how it played out — three conversations per workspace shipped as a widened interface over the shape that was already there (§10.8).

Forking a conversation goes through the SDK's own `forkSession(sessionId, { dir })`, never by copying the id: a plain `resume` continues a session **in place and keeps its id**, so two records holding one would be two agent processes appending to a single session file, each reading the other's turns as part of its own. The SDK's fork returns a new id, and copies what the model remembers; our own transcript is copied beside it, because that is what the screen draws.

### 12.4 The pull request

The tab is the whole of a branch's life after the work is done, and everything
it does goes through `gh` — which already holds the account in the keychain, so
the app never sees a token (§10.9).

- **Opening one.** Title, description, a draft flag, and — while the workspace
  is dirty — a commit message. Left empty, the uncommitted work stays behind;
  filled in, everything here is committed first, because a workspace whose only
  work is uncommitted is zero commits ahead of its base until that lands. The
  field warns when git does not ignore the env file octopus writes this
  workspace's variables into: `add -A` would otherwise commit credentials and
  the push would publish them.
- **The checks.** Read from `statusCheckRollup`, which is a union of GitHub
  Actions runs and the older Commit Status API — external services still report
  through the second, so a repository commonly has both. Re-read every 15 s
  while a check is running **or** while GitHub has not worked out whether the
  branch is mergeable, since it computes that asynchronously and a repository
  with no CI has no pending check to wait on.
- **The review.** Issue comments, review submissions and inline notes in one
  reading order. The inline ones come from a GraphQL query by the request's node
  id, for the one field REST does not carry: whether the thread is resolved.
  **Add to chat** puts a remark into the composer beside the diff's own notes,
  so a question can be typed under it rather than the app asking one.
- **The four prepared messages** — answer the review, review it, review it with
  several subagents, resolve the conflicts — each the project's own instruction
  plus a line naming the request, sent as one visible user message (§4).
- **Merging**, with the three methods, and never `--delete-branch`: a worktree
  is checked out on that branch. A zero exit is not proof of a merge — `gh`
  enables auto-merge instead when a required check has not passed — so the pane
  reads the request again afterwards, which is also what turns a refusal it
  cannot name into a visible reason.
- **Committing and pushing** an answer to a review, without which the loop ends
  in the terminal.

**Every branch of a project is read in one call**, not one per workspace: the
workspace list marks each row with what has become of its branch, and a read
per row would be a network call per row on every refresh.

### 12.5 On-disk layout

Everything under one directory (Conductor spreads across `~/conductor` and `~/.conductor`):

```
~/.octopus/
  config.json                global settings
  state.json                 workspaces, session ids, statuses
  projects/<slug>/
    carry                    which of the checkout's files travel into a workspace
    envs/                    named sets of variables, one appended to every workspace's .env
      default
    scripts/setup.sh
    scripts/run.sh
    scripts/archive.sh
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
octopus/
  src/
    core/          all logic, headless — no Electron, no React
    main/          the window and the IPC bridge; no logic of its own
    preload/       contextBridge, the typed API the window is handed
    renderer/
      src/
        assets/      the mascot, and an octopus per effort level
        components/  UI components
        hooks/       React hooks
        i18n/        localisation, en is the source of truth
        styles.css   design tokens
```

**The modules inside `src/core/` are not listed here.** There are dozens and a
new one arrives with most features, so a copy in this section is a copy that
falls behind. [`docs/core.md`](core.md) carries them, a row each, and is
maintained alongside the code.

That is not tidying: the tree here used to name thirteen of them and describe
`types.ts` as holding "Workspace, Project, WorkspaceStatus" long after the
application's records had become the zod inferences in `store.ts`. A reader who
followed it landed on hand-written interfaces eight fields out of date, one of
which documented the dev-server port as a hash of the workspace id — the exact
behaviour `docs/data.md` records as a bug that was fixed by allocating ports
instead.

The layer boundaries are §11.1. What each core module does is
[`docs/core.md`](core.md); how the window is put together is
[`docs/ui.md`](ui.md); what is written to disk is [`docs/data.md`](data.md).

---

## 15. Out of scope for stage 1

Monaco diff, notifications, workspace archiving, Linux builds, and signing and notarisation.

The whole of the pull request came in ahead of this list, and it is worth saying why rather than quietly deleting the line: §3 calls a branch and a pull request the unit of integration, and a workspace whose branch had no way out of the app was only half of that. Opening one arrived first; the checks, the review threads and merging followed, because a request the app can open and then cannot read is a loop that still ends in a browser.

Replying to a review thread was on this list and is not any more, and the reason it moved is the same one: a request the app can read and cannot answer ends in a browser exactly where reading it stopped. Answering one, and settling or reopening the thread, are `gh api graphql` writes beside the other commands. What is still not here and not planned is anything about a request other people's branches have.

The terminal moved into scope early: account sign-in needs an interactive session, and sending the user to Terminal.app for it broke the sense that this window is where the work happens. The same component will fill the right pane's Terminal tab.

---

## 16. Open questions

- **Workspace naming** — given names drawn at random from a pool of 256, task-derived names, or generated from the prompt text.
- **Tool permissions** — settled for now: the read-only tools are automatic, everything else prompts in the chat, and an answer of "always" is stored per tool in the config where it can be taken back. The mode a new chat starts in is a global setting, so the question is not asked again on each new branch. Open: whether per-project profiles are needed, and whether "always" should narrow to an argument (`Bash(npm test:*)`) rather than a whole tool.
- **Cross-platform** — whether Linux stays in the plans (affects CI only, not architecture).
- **Task sources** — creating a workspace from a GitHub issue or a Linear ticket, as Conductor does.
- **Code review** — answered twice over. A note against a line rides out inside
  the next message, as readable text rather than as anything hidden (§4); and
  GitHub's review threads now appear on the same surface, with **Add to chat**
  putting a remark into the same composer strip the diff's own notes use. Still
  open is the other direction: a thread can be read here and not replied to, so
  the answer goes back as a commit or in a browser.
- **Several agents per workspace** — half answered. The interface offers it: up to three conversations per workspace, no locking between them (§10.8). Still open is what two agents editing the same files at once actually does — the changes pane shows one diff for the workspace, with no way to tell whose work is whose, and a review note against a line may be about a line another conversation has since moved. Conductor allows it and warns about exactly that. `agent` is still an enum with one member, so a second _kind_ of agent remains a widened enum rather than a migration.
- **What the list shows** — agent status, change count, CI state. Not session cost: the SDK's `total_cost_usd` is what the same tokens would have cost through the API, which a subscription never pays, and its own documentation calls it "an estimate, not a billing statement". Shown beside a workspace name it is a made-up number in a currency, and the second half of this stands — usage belongs on the list as tokens or as distance to a rate limit, if at all.

  Narrowed once, and the boundary is worth stating: the figure appears in exactly one place, the card `/usage` draws (§12.3). There it is not a number volunteered beside something else but the answer to the question that was asked — the command's own subject is what the session cost, and a card answering everything except that would be hiding it rather than declining to guess. Nowhere else: not the list, not the turn footer, not the composer's strip.
