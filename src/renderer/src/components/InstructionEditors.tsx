import { useTranslation } from 'react-i18next'

import type { InstructionKind } from '@core/instructions.js'

import { FileEditor } from './FileEditor.js'

/**
 * Every instruction the pull request tab can send, in the order its buttons
 * offer them.
 *
 * A table rather than the editors written out, because there are two dialogs
 * showing the same set and a new kind would otherwise be two more editors to
 * remember. The keys are literals so `t()` still checks them.
 */
export const INSTRUCTION_KINDS: readonly {
  readonly kind: InstructionKind
  readonly labelKey:
    | 'instructions.pullRequest'
    | 'instructions.commitMessage'
    | 'instructions.fixChecks'
    | 'instructions.addressReview'
    | 'instructions.review'
    | 'instructions.multiAgentReview'
    | 'instructions.resolveConflicts'
  readonly hintKey:
    | 'instructions.pullRequestHint'
    | 'instructions.commitMessageHint'
    | 'instructions.fixChecksHint'
    | 'instructions.addressReviewHint'
    | 'instructions.reviewHint'
    | 'instructions.multiAgentReviewHint'
    | 'instructions.resolveConflictsHint'
}[] = [
  {
    kind: 'pullRequest',
    labelKey: 'instructions.pullRequest',
    hintKey: 'instructions.pullRequestHint'
  },
  {
    kind: 'commitMessage',
    labelKey: 'instructions.commitMessage',
    hintKey: 'instructions.commitMessageHint'
  },
  { kind: 'fixChecks', labelKey: 'instructions.fixChecks', hintKey: 'instructions.fixChecksHint' },
  {
    kind: 'addressReview',
    labelKey: 'instructions.addressReview',
    hintKey: 'instructions.addressReviewHint'
  },
  { kind: 'review', labelKey: 'instructions.review', hintKey: 'instructions.reviewHint' },
  {
    kind: 'multiAgentReview',
    labelKey: 'instructions.multiAgentReview',
    hintKey: 'instructions.multiAgentReviewHint'
  },
  {
    kind: 'resolveConflicts',
    labelKey: 'instructions.resolveConflicts',
    hintKey: 'instructions.resolveConflictsHint'
  }
]

/**
 * Shorter than one editor's default, because there are several of them.
 *
 * Sixteen rows each is a page nobody scrolls to the end of, and an instruction
 * is read to be corrected rather than written from scratch here.
 */
const ROWS = 10

/**
 * Every instruction, as the installation holds it — Settings → Instructions.
 *
 * A project's own are drawn by `LayeredEditor` in Project settings, beside the
 * repository's and this installation's, because there the question is which of
 * several applies. Here there is one layer and the template it starts from, so
 * a plain editor says all there is; the hint says what can override it.
 *
 * `INSTRUCTION_KINDS` is the one table both dialogs draw from, so they cannot
 * drift into disagreeing about what an instruction is called or what it does.
 */
export function InstructionEditors(): React.JSX.Element {
  const { t } = useTranslation()
  const scope = t('instructions.scopeGlobal')

  return (
    <>
      {INSTRUCTION_KINDS.map(({ kind, labelKey, hintKey }) => (
        <FileEditor
          key={kind}
          label={t(labelKey)}
          hint={`${t(hintKey)} ${scope}`}
          rows={ROWS}
          read={async () => {
            const result = await window.octopus.projects.readInstruction(null, kind)
            return result.ok ? result.value : null
          }}
          save={(contents) => window.octopus.projects.saveInstruction(null, kind, contents)}
        />
      ))}
    </>
  )
}
