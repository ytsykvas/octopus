import { useTranslation } from 'react-i18next'

import { Segmented } from './Segmented.js'

/**
 * Which of the project's sets of variables a workspace runs with, as one row
 * of buttons.
 *
 * In the open rather than in a menu because it is the question asked most:
 * the same project tested against production data in one workspace and
 * staging in the next, and a build that pulls a different dump for each. A
 * choice that decides which database somebody is about to write to is not one
 * to keep two clicks deep.
 *
 * Nothing at all with fewer than two sets — there is no choice to show, and a
 * project that never made a second sees the pane it always had.
 *
 * Every set is drawn alike. The app has no idea which name means production,
 * and colouring one because it matches a word would be a guess.
 */
export function EnvProfileSwitch({
  profiles,
  value,
  onChange,
  disabled = false
}: {
  readonly profiles: readonly string[]
  /** The set in effect — the workspace's own, or the project's it follows. */
  readonly value: string
  readonly onChange: (name: string) => void
  /** While a build runs: the set it was given is already in its environment. */
  readonly disabled?: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (profiles.length < 2) return null

  return (
    <Segmented
      label={t('scripts.envSwitch')}
      value={value}
      options={profiles.map((name) => ({ value: name, label: name }))}
      onChange={(name) => {
        if (name !== value) onChange(name)
      }}
      disabled={disabled}
      size="sm"
    />
  )
}
