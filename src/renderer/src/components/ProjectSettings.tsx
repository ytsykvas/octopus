import {
  BookText,
  FolderGit2,
  GitBranch,
  Info,
  KeyRound,
  Terminal,
  TriangleAlert,
  Variable
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { shortBranchName } from '@core/branches.js'
import { PROJECT_COLORS } from '@core/colors.js'
import { PROJECT_ICONS } from '@core/icons.js'
import { checkEnvBody } from '@core/envBlock.js'
import type { InstructionSource } from '@core/instructionSources.js'
import { initials } from '@core/initials.js'
import type { ScriptsInWorkspace } from '@core/repoSource.js'
import type { ScriptKind } from '@core/scripts.js'
import type { Project, ProjectPatch } from '@core/store.js'

import { useErrorMessage } from '../hooks/useErrorMessage.js'
import { Button } from './Button.js'
import { Combobox } from './Combobox.js'
import { Field } from './Field.js'
import { Modal } from './Modal.js'
import { ProjectGlyph } from './ProjectGlyph.js'
import { SectionRail } from './SectionRail.js'
import { FileEditor } from './FileEditor.js'
import { InstructionEditors } from './InstructionEditors.js'
import { RepoConfig } from './RepoConfig.js'

interface ProjectSettingsProps {
  readonly project: Project
  /** Applies a change; omitted keys are left alone. */
  readonly onUpdate: (patch: ProjectPatch) => Promise<boolean>
  readonly onRemove: () => void
  /**
   * Something was imported from the repository.
   *
   * The project's own fields are among what can arrive, and this dialog holds
   * a copy of the project — so a name or a base branch taken in has to reach
   * the list, or the form goes on showing what was there before.
   */
  readonly onImported: () => void
  readonly onClose: () => void
  /**
   * Which section to open on, for a caller that already knows what it is about.
   *
   * Read once, on mount, which is correct only because `App` renders this
   * dialog conditionally — the same arrangement `Settings` relies on.
   */
  readonly initialSection?: SectionId
  /**
   * The workspace the answer is about.
   *
   * Whether a source is read depends on the worktree a session would run in —
   * that is where the trust gate looks. With none open the checkout is the best
   * answer available.
   */
  readonly workspaceId?: string | null
  /**
   * Whether this project has any workspaces.
   *
   * Only the checkout question needs it, and the answer is already on screen
   * beside this dialog — reading it again here would be a second source for one
   * fact.
   */
  readonly hasWorkspaces?: boolean
}

/**
 * What each kind of problem in an env block is called to the reader.
 *
 * Spelled out rather than built from the reason, so the locale files can be
 * typed: a key assembled at runtime is a key TypeScript cannot check.
 */
const ENV_PROBLEMS = {
  noAssignment: 'project.envNoAssignment',
  badName: 'project.envBadName',
  duplicate: 'project.envDuplicate',
  unknownVariable: 'project.envUnknownVariable',
  marker: 'project.envMarker'
} as const

/**
 * The three scripts, in the order they run, and what each is called.
 *
 * A list rather than three written-out editors: each now carries a source line
 * as well as a label and a hint, and three copies of that is three places for
 * one of them to be forgotten.
 */
const SCRIPT_ORDER = ['setup', 'archive', 'run'] as const satisfies readonly ScriptKind[]

const SCRIPT_FIELDS = {
  setup: { label: 'project.setupScript', hint: 'project.setupScriptHint' },
  archive: { label: 'project.archiveScript', hint: 'project.archiveScriptHint' },
  run: { label: 'project.runScript', hint: 'project.runScriptHint' }
} as const

/** What each source is called to the reader. */
const SOURCE_LABELS = {
  projectMemory: 'project.sourceProjectMemory',
  projectSettings: 'project.sourceProjectSettings',
  localSettings: 'project.sourceLocalSettings',
  mcp: 'project.sourceMcp',
  userSettings: 'project.sourceUserSettings',
  userMemory: 'project.sourceUserMemory',
  commands: 'project.sourceCommands',
  agents: 'project.sourceAgents',
  skills: 'project.sourceSkills',
  userCommands: 'project.sourceUserCommands',
  userAgents: 'project.sourceUserAgents'
} as const

export type SectionId =
  'general' | 'git' | 'scripts' | 'files' | 'env' | 'instructions' | 'repository' | 'danger'

const SECTIONS: readonly {
  readonly id: SectionId
  readonly labelKey:
    | 'project.sectionGeneral'
    | 'project.sectionGit'
    | 'project.sectionScripts'
    | 'project.sectionFiles'
    | 'project.sectionEnv'
    | 'project.sectionInstructions'
    | 'project.sectionRepository'
    | 'project.sectionDanger'
  readonly Icon: typeof Info
  readonly destructive?: boolean
}[] = [
  { id: 'general', labelKey: 'project.sectionGeneral', Icon: Info },
  { id: 'git', labelKey: 'project.sectionGit', Icon: GitBranch },
  { id: 'scripts', labelKey: 'project.sectionScripts', Icon: Terminal },
  // Next to the scripts: these are what they need present, and before this
  // fetching them was the first thing every build script had to do.
  { id: 'files', labelKey: 'project.sectionFiles', Icon: KeyRound },
  // Beside the files rather than inside them: one says which of the checkout's
  // files travel, the other says what to write once they have.
  { id: 'env', labelKey: 'project.sectionEnv', Icon: Variable },
  { id: 'instructions', labelKey: 'project.sectionInstructions', Icon: BookText },
  // Last before the danger zone, and after everything it moves: the section is
  // about the six above rather than a setting of its own.
  { id: 'repository', labelKey: 'project.sectionRepository', Icon: FolderGit2 },
  { id: 'danger', labelKey: 'project.sectionDanger', Icon: TriangleAlert, destructive: true }
]

/**
 * Everything about one project in one place.
 *
 * Changes save as they are made, like the settings window: nothing here is a
 * multi-step edit, and a Save button would invite closing the dialog with work
 * still pending.
 */
export function ProjectSettings({
  project,
  onUpdate,
  onRemove,
  onImported,
  onClose,
  initialSection,
  workspaceId = null,
  hasWorkspaces = false
}: ProjectSettingsProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const [section, setSection] = useState<SectionId>(initialSection ?? 'general')
  const [name, setName] = useState(project.name)
  const [envFile, setEnvFile] = useState(project.envFile)
  /**
   * Whether git would keep the env file out of a commit.
   *
   * `true` until answered, so the warning cannot flash on a file that turns
   * out to be ignored after all — an alarm that appears and withdraws is worse
   * than one that arrives a moment late.
   */
  const [envIgnored, setEnvIgnored] = useState(true)
  const [sources, setSources] = useState<readonly InstructionSource[]>([])
  /**
   * Where each script would actually come from, once the checkout is consulted.
   *
   * Resolved against the project's own repository rather than a worktree: this
   * dialog is about the project, and it opens with no workspace as often as
   * with one.
   */
  const [resolved, setResolved] = useState<ScriptsInWorkspace | null>(null)
  /** The named sets this project holds, and which of them is being edited. */
  const [profiles, setProfiles] = useState<readonly string[]>([project.envProfile])
  const [profile, setProfile] = useState(project.envProfile)
  const [branches, setBranches] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const result = await window.octopus.projects.branches(project.id)
      if (controller.signal.aborted) return

      if (result.ok) {
        setBranches(result.value)
      } else {
        setError(describeFailure(result))
      }
    })()

    return () => {
      controller.abort()
    }
  }, [project.id, describeFailure])

  const commitName = (): void => {
    const trimmed = name.trim()
    // An empty field is a slip, not an instruction to erase the name.
    if (trimmed === '' || trimmed === project.name) {
      setName(project.name)
      return
    }

    void onUpdate({ name: trimmed })
  }

  useEffect(() => {
    if (section !== 'env') return
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.projects.isEnvIgnored(project.id)
      // A git that could not answer is not evidence of exposure, so it says
      // nothing rather than warning about a question nobody got to ask.
      if (!controller.signal.aborted) setEnvIgnored(!answer.ok || answer.value)
    })()

    return () => {
      controller.abort()
    }
  }, [section, project.id, project.envFile])

  useEffect(() => {
    if (section !== 'scripts') return
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.projects.scripts(project.id)
      // A checkout that cannot be read leaves the editors as they were: a
      // settings file with conflict markers in it is not a reason to tell
      // somebody their own script does not run.
      if (!controller.signal.aborted && answer.ok) setResolved(answer.value)
    })()

    return () => {
      controller.abort()
    }
  }, [section, project.id])

  useEffect(() => {
    if (section !== 'instructions') return
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.projects.instructionSources(project.id, workspaceId)
      if (!controller.signal.aborted && answer.ok) setSources(answer.value)
    })()

    return () => {
      controller.abort()
    }
  }, [section, project.id, workspaceId])

  /**
   * Bumped to read the list again, rather than a second copy of the read.
   *
   * Adding or deleting a set changes the answer without changing anything the
   * effect already depends on, and a `loadProfiles` beside the effect would be
   * the same eight lines in two places.
   */
  const [profilesRead, setProfilesRead] = useState(0)

  useEffect(() => {
    if (section !== 'env') return
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.projects.envProfiles(project.id)
      if (controller.signal.aborted || !answer.ok) return

      setProfiles(answer.value.profiles)
      // Keep what is open unless it has gone, in which case fall to the
      // project's own.
      setProfile((current) =>
        answer.value.profiles.includes(current) ? current : answer.value.projectDefault
      )
    })()

    return () => {
      controller.abort()
    }
  }, [section, project.id, profilesRead])

  /**
   * Adds a set, empty or copied from the one on screen.
   *
   * The name is asked for with `prompt`, which is the one dialog this app does
   * not draw itself — a modal inside a modal for a single word is more
   * machinery than the question deserves.
   */
  const addProfile = async (from: string | null): Promise<void> => {
    const name = window.prompt(t('project.envProfileName'))?.trim()
    if (name === undefined || name === '') return

    const done = await window.octopus.projects.createEnv(project.id, name, from)
    if (!done.ok) {
      setError(describeFailure(done))
      return
    }

    // Opened on the one just made, which is what somebody who named it wants.
    setProfile(name)
    setProfilesRead((current) => current + 1)
  }

  const dropProfile = async (): Promise<void> => {
    const done = await window.octopus.projects.removeEnv(project.id, profile)
    if (done.ok) setProfilesRead((current) => current + 1)
    else setError(describeFailure(done))
  }

  const commitEnvFile = (): void => {
    const trimmed = envFile.trim()
    // An empty field is a slip, not an instruction to write the block nowhere.
    if (trimmed === '' || trimmed === project.envFile) {
      setEnvFile(project.envFile)
      return
    }

    void (async () => {
      // A path climbing out of the worktree is refused by the core, and the
      // field has to go back to what is actually stored rather than keep
      // showing something that was not saved.
      if (!(await onUpdate({ envFile: trimmed }))) setEnvFile(project.envFile)
    })()
  }

  const changeBranch = (baseBranch: string): void => {
    void (async () => {
      // A branch can be deleted between this list being read and this click,
      // so a refusal has to be visible rather than assumed away.
      if (!(await onUpdate({ baseBranch }))) setError(t('project.branchFailed'))
    })()
  }

  return (
    <Modal
      size="lg"
      title={t('project.title')}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('project.done')}</Button>}
    >
      {/* A rail rather than one long scroll: the sections have nothing to do
          with each other, and the same shape as the settings window means one
          way of navigating rather than two. */}
      <div className="flex min-h-0 flex-1">
        <SectionRail
          sections={SECTIONS.map((item) => ({ ...item, label: t(item.labelKey) }))}
          active={section}
          onSelect={setSection}
        />

        <div className="min-w-0 flex-1 space-y-6 overflow-auto p-6">
          {error !== null && (
            <div className="bg-danger-bg text-danger border-danger/25 rounded-[var(--radius-control)] border px-3 py-2">
              {error}
            </div>
          )}

          {section === 'general' && (
            <>
              <Field label={t('project.name')} hint={t('project.nameHint')}>
                <input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                  }}
                  onBlur={commitName}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') setName(project.name)
                  }}
                  className="input focus-ring max-w-sm"
                />
              </Field>

              <Field label={t('project.color')} hint={t('project.colorHint')}>
                <div
                  role="group"
                  aria-label={t('project.color')}
                  className="flex max-w-xs flex-wrap gap-1.5"
                >
                  {PROJECT_COLORS.map((colour) => (
                    <button
                      key={colour}
                      type="button"
                      onClick={() => void onUpdate({ color: colour })}
                      title={colour}
                      aria-pressed={colour === project.color}
                      className={`focus-ring size-6 rounded-full transition-transform hover:scale-110 ${
                        colour === project.color ? 'ring-ink-faint ring-2 ring-offset-2' : ''
                      }`}
                      // The swatch is the colour, so it cannot come from a class.
                      style={{
                        backgroundColor: `var(--project-${colour})`,
                        // Tailwind's offset colour is a variable, not a token here.
                        ['--tw-ring-offset-color' as string]: 'var(--canvas)'
                      }}
                    />
                  ))}
                </div>
              </Field>

              {/* The icon replaces the initials on the tab, so the initials are
                  the first choice in the row: taking a picture off is the same
                  kind of decision as putting one on, not a reset hidden
                  elsewhere. */}
              <Field label={t('project.icon')} hint={t('project.iconHint')}>
                <div
                  role="group"
                  aria-label={t('project.icon')}
                  className="flex max-w-sm flex-wrap gap-1.5"
                  style={
                    { '--project-color': `var(--project-${project.color})` } as React.CSSProperties
                  }
                >
                  <IconChoice
                    label={t('project.iconNone')}
                    selected={!project.icon}
                    onSelect={() => void onUpdate({ icon: null })}
                  >
                    <span className="text-[13px] font-semibold">{initials(project.name)}</span>
                  </IconChoice>

                  {PROJECT_ICONS.map((icon) => (
                    <IconChoice
                      key={icon}
                      // The id itself, as the colour swatches do: these are
                      // names of pictures, and a translated list of sixty-four
                      // of them would be a glossary nobody reads.
                      label={icon}
                      selected={icon === project.icon}
                      onSelect={() => void onUpdate({ icon })}
                    >
                      <ProjectGlyph name={icon} size={18} />
                    </IconChoice>
                  ))}
                </div>
              </Field>

              {/* Changeable, but only while nothing has been cut from it: each
                  workspace is a worktree registered in *this* repository, and
                  git in another one knows nothing about them. Disabled with the
                  reason underneath rather than refused after the fact. */}
              <Field
                label={t('project.repository')}
                hint={hasWorkspaces ? t('project.repositoryLocked') : t('project.repositoryHint')}
              >
                <div className="flex max-w-lg items-center gap-2">
                  <p
                    className="text-ink-faint min-w-0 flex-1 truncate font-mono text-[11px]"
                    title={project.repoPath}
                  >
                    {project.repoPath}
                  </p>

                  <Button
                    disabled={hasWorkspaces}
                    onClick={() => {
                      void (async () => {
                        const picked = await window.octopus.dialog.pickDirectory(
                          t('project.repositoryPick')
                        )
                        if (!picked.ok || picked.value === null) return

                        if (!(await onUpdate({ repoPath: picked.value }))) return
                        onImported()
                      })()
                    }}
                  >
                    {t('project.repositoryChange')}
                  </Button>
                </div>
              </Field>
            </>
          )}

          {/* The list is only what the repository offers. A project added before
              this dialog existed may still sit on a local `main`, and showing
              that next to `origin/main` would list two entries for what reads as
              one branch. The button shows the stored value either way, so the
              difference is visible and one click from fixed. */}
          {section === 'git' && (
            <Field label={t('project.baseBranch')} hint={t('project.baseBranchHint')}>
              <Combobox
                value={project.baseBranch}
                options={branches}
                onChange={changeBranch}
                placeholder={t('project.branchSearch')}
                emptyLabel={t('project.branchNone')}
                display={shortBranchName}
              />
            </Field>
          )}

          {section === 'scripts' && (
            <>
              {SCRIPT_ORDER.map((kind) => {
                const repo = resolved?.scripts[kind]

                return (
                  <FileEditor
                    key={kind}
                    label={t(SCRIPT_FIELDS[kind].label)}
                    hint={t(SCRIPT_FIELDS[kind].hint)}
                    placeholder="#!/bin/sh"
                    supersededBy={
                      repo === undefined || repo.source === 'project'
                        ? undefined
                        : t('project.scriptFromRepo', { from: repo.from })
                    }
                    read={async () => {
                      const result = await window.octopus.projects.readScript(project.id, kind)
                      return result.ok ? result.value : null
                    }}
                    save={(contents) =>
                      void window.octopus.projects.saveScript(project.id, kind, contents)
                    }
                  />
                )
              })}
            </>
          )}

          {/* Its own section rather than a third editor under Scripts. The
              Build header offers a button for each, and two buttons opening the
              same panel would be two names for one action — while what they
              lead to genuinely differs: one file is run, the others are
              copied. */}
          {section === 'files' && (
            <FileEditor
              label={t('project.files')}
              hint={t('project.filesHint')}
              placeholder={'.env\nconfig/master.key'}
              rows={12}
              read={async () => {
                const result = await window.octopus.projects.readCarryList(project.id)
                return result.ok ? result.value : null
              }}
              save={(contents) => void window.octopus.projects.saveCarryList(project.id, contents)}
            />
          )}

          {/* Variables rather than files, and the answer for a project cloned
              from GitHub: a fresh clone has no gitignored `.env` to carry, so
              there is nothing to list and these are typed instead. They are
              written at the end of the workspace's `.env`, where last wins. */}
          {section === 'env' && (
            <>
              {/* Which file, because `.env` is only most stacks. Vite reads
                  `.env.local` and would ignore anything written beside it, so a
                  project on one had nowhere at all to put its variables. */}
              <Field label={t('project.envFile')} hint={t('project.envFileHint')}>
                <input
                  value={envFile}
                  onChange={(event) => {
                    setEnvFile(event.target.value)
                  }}
                  onBlur={commitEnvFile}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') setEnvFile(project.envFile)
                  }}
                  spellCheck={false}
                  className="input focus-ring max-w-sm font-mono"
                />
              </Field>

              {/* Which set. A checkout with a dev section and a production one
                  used to be handled by commenting a block in and out, and a
                  copy taken while it was on production pointed every workspace
                  at production. Naming them makes the choice a choice. */}
              <Field label={t('project.envProfile')} hint={t('project.envProfileHint')}>
                <div className="flex max-w-lg flex-wrap items-center gap-2">
                  <select
                    aria-label={t('project.envProfile')}
                    value={profile}
                    onChange={(event) => {
                      setProfile(event.target.value)
                    }}
                    className="input focus-ring w-40 font-mono"
                  >
                    {profiles.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>

                  {profile !== project.envProfile && (
                    <Button
                      onClick={() => {
                        void onUpdate({ envProfile: profile })
                      }}
                    >
                      {t('project.envProfileMakeDefault')}
                    </Button>
                  )}

                  <Button onClick={() => void addProfile(null)}>
                    {t('project.envProfileNew')}
                  </Button>
                  <Button onClick={() => void addProfile(profile)}>
                    {t('project.envProfileDuplicate')}
                  </Button>
                  {profiles.length > 1 && (
                    <Button variant="destructive" onClick={() => void dropProfile()}>
                      {t('project.envProfileRemove')}
                    </Button>
                  )}
                </div>
              </Field>

              <FileEditor
                /*
                 * Keyed and labelled by the profile, and measured: either alone
                 * prevents the write, and removing both lets it through.
                 *
                 * `FileEditor` loads on its label and saves on blur, so without
                 * a reload switching profile would show the old text and then
                 * write it into the set just chosen. The `key` is the
                 * deliberate half; the label's dependence is incidental, and
                 * would go the moment somebody shortened the wording. Keeping
                 * both means neither edit is the one that breaks it.
                 */
                key={profile}
                label={t('project.envOf', { name: profile })}
                hint={t('project.envHint', { file: project.envFile })}
                placeholder={'MYSQL_HOST=dev.example\nAPP_URL=http://localhost:$OCTOPUS_PORT'}
                rows={12}
                read={async () => {
                  const result = await window.octopus.projects.readEnv(project.id, profile)
                  return result.ok ? result.value : null
                }}
                save={(contents) =>
                  void window.octopus.projects.saveEnv(project.id, profile, contents)
                }
                notes={(contents) => [
                  // Only once there is something to expose. An empty block in a
                  // file git does not ignore is a warning about nothing.
                  ...(envIgnored || contents.trim() === ''
                    ? []
                    : [t('project.envNotIgnored', { file: project.envFile })]),
                  ...checkEnvBody(contents).map((problem) =>
                    t(ENV_PROBLEMS[problem.reason], {
                      line: problem.line,
                      subject: problem.subject
                    })
                  )
                ]}
              />
            </>
          )}

          {section === 'instructions' && (
            <>
              {/* What the agent picks up on its own. octopus loads every
                  settings source, as the plain CLI does, so this is the only
                  place the app can say what that turned out to be. */}
              <Field label={t('project.sources')} hint={t('project.sourcesHint')}>
                <ul className="max-w-lg space-y-1">
                  {sources.map((entry) => (
                    <li key={entry.id} className="flex items-baseline justify-between gap-3">
                      <span className={entry.loaded ? '' : 'text-ink-faint'}>
                        {t(SOURCE_LABELS[entry.id])}
                      </span>
                      {/* Three answers, not two. "On disk" is a stat; "loaded"
                          is a claim about what the agent was started with, and
                          saying the first under the second's name made this
                          panel wrong in every mode at once. */}
                      <span className="text-ink-faint font-mono text-[11px]">
                        {!entry.present
                          ? t('project.sourceAbsent')
                          : !entry.loaded
                            ? t('project.sourceNotLoaded')
                            : entry.count === null
                              ? t('project.sourcePresent')
                              : t('project.sourceCount', { count: entry.count })}
                      </span>
                    </li>
                  ))}
                </ul>
              </Field>

              <InstructionEditors projectId={project.id} />
            </>
          )}

          {/* Reaching removal now takes choosing the section it lives in, which
              is a further step away from a mis-click than a scroll was. */}
          {section === 'repository' && (
            <RepoConfig
              projectId={project.id}
              trusted={project.trustRepoScripts}
              onTrustChange={(trusted) => void onUpdate({ trustRepoScripts: trusted })}
              onImported={onImported}
            />
          )}

          {section === 'danger' && (
            <div className="border-danger/25 bg-danger-bg/40 space-y-2.5 rounded-[var(--radius-control)] border p-3.5">
              <p className="text-danger font-medium">{t('project.dangerZone')}</p>
              <p className="text-ink-faint leading-relaxed">{t('project.removeHint')}</p>
              <Button variant="destructive" onClick={onRemove}>
                {t('sidebar.removeProject')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/**
 * One cell of the icon row — a picture, or the initials that stand in for none.
 *
 * The chosen one is tinted with the project's own colour rather than a generic
 * highlight, so the cell shows what the tab will actually look like.
 */
function IconChoice({
  label,
  selected,
  onSelect,
  children
}: {
  readonly label: string
  readonly selected: boolean
  readonly onSelect: () => void
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={label}
      // Named explicitly: the initials cell would otherwise be announced as the
      // two letters inside it, which says nothing about what clicking it does.
      aria-label={label}
      aria-pressed={selected}
      // The same 36px the tab is: the cell is a preview of it, and a picture
      // picked at half the size it will be worn is picked half blind.
      className={`focus-ring flex size-9 items-center justify-center rounded-[var(--radius-control)] transition-colors ${
        selected ? '' : 'text-ink-soft hover:bg-muted hover:text-ink'
      }`}
      style={
        selected
          ? {
              backgroundColor: 'color-mix(in srgb, var(--project-color) 16%, transparent)',
              color: 'var(--project-color)'
            }
          : undefined
      }
    >
      {children}
    </button>
  )
}
