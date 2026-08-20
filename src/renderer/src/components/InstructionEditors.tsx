import { useTranslation } from 'react-i18next'

import type { InstructionKind } from '@core/instructions.js'

import { FileEditor } from './FileEditor.js'

/**
 * Every instruction the pull request tab can send, in the order its buttons
 * offer them.
 *
 * A table rather than five editors written out, because there are two dialogs
 * showing the same five and a sixth kind would otherwise be two more editors to
 * remember. The keys are literals so `t()` still checks them.
 */
const KINDS: readonly {
  readonly kind: InstructionKind
  readonly labelKey:
    | 'instructions.pullRequest'
    | 'instructions.addressReview'
    | 'instructions.review'
    | 'instructions.multiAgentReview'
    | 'instructions.resolveConflicts'
  readonly hintKey:
    | 'instructions.pullRequestHint'
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
 * Shorter than one editor's default, because there are five of them.
 *
 * Sixteen rows each is a page nobody scrolls to the end of, and an instruction
 * is read to be corrected rather than written from scratch here.
 */
const ROWS = 10

/**
 * The five instructions, at whichever scope this dialog is about.
 *
 * `null` is the installation's own; a project id is that project's override.
 * One component for both, so the two dialogs cannot drift into disagreeing
 * about what an instruction is called or what it does — the same argument
 * `Field` makes for itself.
 *
 * What differs between the scopes is one sentence, appended to each hint: the
 * global one says a project may override it, and a project's says it overrides
 * the global one and that emptying it is a decision. Written as ten hints
 * instead, half of them would go stale the first time a button changed.
 */
export function InstructionEditors({
  projectId
}: {
  readonly projectId: string | null
}): React.JSX.Element {
  const { t } = useTranslation()

  const scope = projectId === null ? t('instructions.scopeGlobal') : t('instructions.scopeProject')

  return (
    <>
      {KINDS.map(({ kind, labelKey, hintKey }) => (
        <FileEditor
          key={kind}
          label={t(labelKey)}
          hint={`${t(hintKey)} ${scope}`}
          rows={ROWS}
          read={async () => {
            const result = await window.octopus.projects.readInstruction(projectId, kind)
            return result.ok ? result.value : null
          }}
          save={(contents) => {
            void window.octopus.projects.saveInstruction(projectId, kind, contents)
          }}
        />
      ))}
    </>
  )
}
