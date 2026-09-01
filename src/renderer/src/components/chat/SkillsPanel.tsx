import { Blocks } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SkillScope } from '@core/skillNames.js'
import type { SkillListing } from '@core/skills.js'

import { useAnchoredPanel } from '../../hooks/useAnchoredPanel.js'
import { Switch } from '../Switch.js'

/** Room for a name, a description and a switch without either wrapping twice. */
const PANEL_WIDTH = 320
const ROW_HEIGHT = 44
const GROUP_HEADING = 24
const PANEL_CHROME = 84

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
 * Three groups, and they are three because the answer to "where did this come
 * from" changes what can be done about it: the first two are octopus's own
 * stores and are edited in settings, while the third is what the checkout
 * carries and is read-only here. A group with nothing in it is not drawn —
 * most projects have no skills of their own, and an empty heading is a
 * promise the interface is not keeping.
 *
 * The third group is also absent when the Agent setting would not load it,
 * which is decided in core: a switch over something the session never reads
 * would be a control with nothing behind it.
 */
export function SkillsPanel({
  skills,
  onToggle,
  onOpen,
  onOpenSettings
}: SkillsPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { open, position, container, toggle, close } = useAnchoredPanel()

  const groups: readonly { readonly scope: SkillScope; readonly heading: string }[] = [
    { scope: 'global', heading: t('chat.skillsGlobal') },
    { scope: 'project', heading: t('chat.skillsProject') },
    { scope: 'repository', heading: t('chat.skillsRepository') }
  ]

  const shown = groups
    .map((group) => ({ ...group, rows: skills.filter((skill) => skill.scope === group.scope) }))
    .filter((group) => group.rows.length > 0)

  const enabled = skills.filter((skill) => skill.enabled).length
  const height = PANEL_CHROME + shown.length * GROUP_HEADING + skills.length * ROW_HEIGHT

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
          toggle(event.currentTarget, { width: PANEL_WIDTH, height })
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
        {skills.length > 0 && <span className="tabular-nums">{enabled}</span>}
      </button>

      {open && position && (
        <div
          role="dialog"
          aria-label={t('chat.skillsTitle')}
          style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}
          className="border-line bg-canvas fixed z-50 rounded-[var(--radius-panel)] border shadow-[var(--shadow-pop)]"
        >
          <p className="border-line text-ink-faint border-b px-3 py-2 text-[11px]">
            {t('chat.skillsTitle')}
          </p>

          {shown.length === 0 ? (
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
              {shown.map((group) => (
                <div key={group.scope}>
                  <p className="section-label px-3 pt-2 pb-1">{group.heading}</p>
                  {group.rows.map((skill) => (
                    <div key={skill.key} className="flex items-start gap-2 px-3 py-1.5">
                      <Switch
                        checked={skill.enabled}
                        label={skill.name}
                        onChange={(next) => {
                          onToggle(skill.key, next)
                        }}
                      />
                      <span className="min-w-0">
                        <span className="text-ink block truncate text-[13px]">{skill.name}</span>
                        {skill.description !== '' && (
                          <span className="text-ink-faint block truncate text-[11px]">
                            {skill.description}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
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
