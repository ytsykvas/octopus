import { useTranslation } from 'react-i18next'

/**
 * The line a commit is made under, wherever the pane makes one.
 *
 * Shared because there are two of them — the form that opens a request and the
 * row that updates one — and two fields for one idea drift. This app has already
 * spent a commit deleting a second copy of a function for exactly that reason.
 *
 * The label wraps the field and nothing else. Everything said about it sits
 * outside, or the field's own name would be the label plus two paragraphs of
 * explanation, which is what anything reading the form aloud would announce.
 */
export function CommitMessageField({
  value,
  onChange,
  /**
   * What pressing the button will do, which is not the same in the two places.
   *
   * One commits and opens a request; the other commits and pushes onto one that
   * exists. The field is the same and the consequence is not, so the sentence
   * comes from the caller.
   */
  hint
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly hint: string
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="section-label">{t('pullRequest.commitMessage')}</span>
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          placeholder={t('pullRequest.commitMessagePlaceholder')}
          className="input"
        />
      </label>

      <p className="text-ink-faint leading-relaxed">{hint}</p>
    </div>
  )
}
