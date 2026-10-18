import { Blocks } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SessionSkillSource } from '@core/sessionSkills.js'
import type { OwnSkillScope } from '@core/skillNames.js'
import type { SkillListing } from '@core/skills.js'

import { useAnchoredPanel } from '../../hooks/useAnchoredPanel.js'
import { DisclosureButton } from '../Disclosure.js'
import { Switch } from '../Switch.js'
import {
  countIn,
  hasSwitch,
  heldSections,
  ownSections,
  panelHeight,
  switchedElsewhere
} from './skillSections.js'

/** Room for a name, a description and a switch without either wrapping twice. */
const PANEL_WIDTH = 320

interface SkillsPanelProps {
  readonly skills: readonly SkillListing[]
  readonly onToggle: (key: string, enabled: boolean) => void
  /**
   * Asked for a fresh list on the way open.
   *
   * The things that change this list happen in another window — a skill
   * written in settings, a project's defaults edited — so there is no event to
   * listen for. Opening the panel is the one moment somebody is about to read
   * it, which makes it the cheapest place to be right.
   */
  readonly onOpen: () => void
  /** Where a conversation with no skills is sent to make one. */
  readonly onOpenSettings: () => void
}

/**
 * Which skills this conversation may reach for.
 *
 * Four groups, and they are four because the answer to "where did this come
 * from" changes what can be done about it: the first two are octopus's own
 * stores and are edited in settings, the third is what the checkout carries and
 * is read-only here, and the fourth is everything the agent holds that octopus
 * never looked for. A group with nothing in it is not drawn.
 *
 * The third group is also absent when the Agent setting would not load it,
 * which is decided in core: a switch over something the session never reads
 * would be a control with nothing behind it. The fourth is absent until a
 * session exists to be asked, which is honest rather than a gap: before the
 * first message there is nothing that could answer.
 *
 * **The fourth is folded, and left out of the count.** It is thirty-odd rows
 * on an ordinary install — Claude Code's own, a plugin's, the ones synced from
 * claude.ai — against a handful of ours, and it is what made the count look
 * wrong: it arrives with the session, so a number that included it changed by
 * itself. Folded, it says how many of its own are on; open, it is split by
 * where each came from. The choice survives closing the panel, since this
 * component stays mounted with the composer — and goes with the pane, which is
 * as long as anyone needs it.
 *
 * The switch works on every row but a plugin's. `skillOverrides` names a skill
 * by the key the CLI knows it by, and that is what the fourth group carries —
 * but the CLI keeps a plugin's skill whatever it says, so those rows are listed
 * without one, under a line saying a plugin is turned off whole, in Claude
 * Code's `/plugin`.
 */
export function SkillsPanel({
  skills,
  onToggle,
  onOpen,
  onOpenSettings
}: SkillsPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { open, position, container, toggle, close } = useAnchoredPanel()
  const [heldOpen, setHeldOpen] = useState(false)

  // Records rather than lists, so a scope or source with no heading is a type
  // error here instead of a group drawn without one.
  const scopeHeadings: Record<OwnSkillScope, string> = {
    global: t('chat.skillsGlobal'),
    project: t('chat.skillsProject'),
    repository: t('chat.skillsRepository')
  }
  const sourceHeadings: Record<SessionSkillSource, string> = {
    builtin: t('chat.skillsBuiltin'),
    plugin: t('chat.skillsPlugin'),
    synced: t('chat.skillsSynced'),
    own: t('chat.skillsOwn')
  }

  const own = ownSections(skills)
  const held = heldSections(skills)
  const ours = countIn(own)

  const rowsOf = (rows: readonly SkillListing[]): ReactNode =>
    rows.map((skill) => <SkillRow key={skill.key} skill={skill} onToggle={onToggle} />)

  return (
    <div ref={container} className="contents">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('chat.skillsTitle')}
        onClick={(event) => {
          event.stopPropagation()
          if (!open) onOpen()
          toggle(event.currentTarget, {
            width: PANEL_WIDTH,
            height: panelHeight(own, held)
          })
        }}
        // The attic's own hover surface, cancelled by negative margins so the
        // strip keeps its inset and does not grow taller — the same treatment
        // the context reading opposite gets.
        className={`focus-ring hover:bg-muted hover:text-ink-soft -my-0.5 inline-flex items-center gap-1 rounded-[var(--radius-control)] px-1 py-0.5 transition-colors ${
          open ? 'bg-muted text-ink-soft' : ''
        }`}
      >
        <Blocks aria-hidden size={11} className="shrink-0 opacity-70" />
        {t('chat.skills')}
        {ours.total > 0 && <span className="tabular-nums">{ours.enabled}</span>}
      </button>

      {open && position && (
        <div
          role="dialog"
          aria-label={t('chat.skillsTitle')}
          style={{ ...position, width: PANEL_WIDTH }}
          className="border-line bg-canvas fixed z-50 rounded-[var(--radius-panel)] border shadow-[var(--shadow-pop)]"
        >
          <p className="border-line text-ink-faint border-b px-3 py-2 text-[11px]">
            {t('chat.skillsTitle')}
          </p>

          {own.length === 0 && held.length === 0 ? (
            <div className="space-y-2 px-3 py-3">
              <p className="text-ink text-[13px]">{t('chat.skillsEmpty')}</p>
              <p className="text-ink-faint text-[11px]">{t('chat.skillsEmptyNote')}</p>
              <button
                type="button"
                onClick={() => {
                  close()
                  onOpenSettings()
                }}
                className="focus-ring text-accent rounded-[var(--radius-control)] text-[11px] hover:underline"
              >
                {t('chat.skillsSettings')}
              </button>
            </div>
          ) : (
            <div className="max-h-80 overflow-auto py-1">
              {own.map((section) => (
                <SkillGroup key={section.id} heading={scopeHeadings[section.id]}>
                  {rowsOf(section.rows)}
                </SkillGroup>
              ))}

              {held.length > 0 && (
                <SkillGroup
                  heading={t('chat.skillsSession')}
                  fold={{
                    open: heldOpen,
                    onOpenChange: setHeldOpen,
                    summary: t('chat.skillsSessionCount', { count: countIn(held).enabled })
                  }}
                >
                  {held.map((section) => (
                    <div key={section.id}>
                      <p className="text-ink-faint px-3 pt-1.5 pb-0.5 text-[11px]">
                        {sourceHeadings[section.id]}
                      </p>
                      {switchedElsewhere(section) && (
                        <p className="text-ink-faint px-3 pb-1 text-[11px] leading-snug">
                          {t('chat.skillsPluginNote')}
                        </p>
                      )}
                      {rowsOf(section.rows)}
                    </div>
                  ))}
                </SkillGroup>
              )}
            </div>
          )}

          {/* Said once, quietly, because a switch that looks like a lock is
              worse than no switch: what this does is keep the skill out of the
              agent's listing, not off the disk it can still read. */}
          <p className="border-line text-ink-faint border-t px-3 py-2 text-[11px]">
            {t('chat.skillsNote')}
          </p>
        </div>
      )}
    </div>
  )
}

interface SkillGroupProps {
  readonly heading: string
  /** Makes the heading a disclosure, with what the folded group would say. */
  readonly fold?: {
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly summary: string
  }
  readonly children: ReactNode
}

/**
 * A heading and what is under it — the one shape every group in the panel has.
 *
 * Folding is a property of the group rather than a second component, so the
 * group that folds is drawn by the same lines as the three that do not and
 * cannot drift from them.
 */
function SkillGroup({ heading, fold, children }: SkillGroupProps): React.JSX.Element {
  if (fold === undefined) {
    return (
      <div>
        <p className="section-label px-3 pt-2 pb-1">{heading}</p>
        {children}
      </div>
    )
  }

  return (
    <div>
      <DisclosureButton
        open={fold.open}
        onOpenChange={fold.onOpenChange}
        className="section-label focus-ring hover:text-ink flex w-full items-center gap-1 px-3 pt-2 pb-1 text-left transition-colors"
      >
        <span className="min-w-0 flex-1 truncate">{heading}</span>
        <span className="text-ink-faint font-normal tabular-nums">{fold.summary}</span>
      </DisclosureButton>
      {fold.open && children}
    </div>
  )
}

interface SkillRowProps {
  readonly skill: SkillListing
  readonly onToggle: (key: string, enabled: boolean) => void
}

/**
 * A skill, what it is for, and the switch that keeps it from the agent — where
 * one would do anything. Without it the switch's room is kept, so the names in
 * a group still start in one column.
 */
function SkillRow({ skill, onToggle }: SkillRowProps): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 px-3 py-1.5">
      {hasSwitch(skill) ? (
        <Switch
          checked={skill.enabled}
          label={skill.name}
          onChange={(next) => {
            onToggle(skill.key, next)
          }}
        />
      ) : (
        <span aria-hidden className="w-7 shrink-0" />
      )}
      <span className="min-w-0">
        <span className="text-ink block truncate text-[13px]">{skill.name}</span>
        {skill.description !== '' && (
          <span className="text-ink-faint block truncate text-[11px]">{skill.description}</span>
        )}
      </span>
    </div>
  )
}
