import { ChevronUp, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { InstructionKind } from '@core/instructions.js'

import { Button } from '../Button.js'
import { DropdownMenu, type MenuAction } from '../DropdownMenu.js'
import type { PromptKind } from './requestStatus.js'

/** Each prepared message, named for what pressing it does. */
const LABELS: Record<
  PromptKind,
  | 'pullRequest.fixChecks'
  | 'pullRequest.addressReview'
  | 'pullRequest.resolveConflicts'
  | 'pullRequest.doReview'
  | 'pullRequest.multiAgentReview'
> = {
  fixChecks: 'pullRequest.fixChecks',
  addressReview: 'pullRequest.addressReview',
  resolveConflicts: 'pullRequest.resolveConflicts',
  review: 'pullRequest.doReview',
  multiAgentReview: 'pullRequest.multiAgentReview'
}

/**
 * The first of the two prompts that are always on offer (`requestStatus` puts
 * them last), which is where the line setting them apart is drawn.
 */
const FIRST_ALWAYS: PromptKind = 'review'

/**
 * The prepared messages, in one menu at the foot of the pane.
 *
 * One control wearing the composer's ring rather than a row of buttons: the
 * row grew to six and wrapped, and the ones that answered the moment — a red
 * check, a review, a conflict — looked like the ones that are always there.
 * Here those come first, and the two that always apply sit under a line.
 *
 * Each sends the project's own instruction as an ordinary message in the
 * conversation — visible in the log, editable before it is ever pressed, and
 * nothing the app has written itself (§4).
 */
export function AgentMenu({
  offered,
  onPrompt,
  sending,
  onEditInstructions
}: {
  /** What is worth offering now, in order — `requestStatus` decides. */
  readonly offered: readonly PromptKind[]
  /**
   * Sends a kind's instruction, or null where there is no conversation to send
   * it to. Null rather than a flag beside a handler that could not run: the
   * guard inside would be one nothing can reach.
   */
  readonly onPrompt: ((kind: InstructionKind) => void) | null
  /** Which prompt is in flight, so the trigger says so. */
  readonly sending: InstructionKind | null
  readonly onEditInstructions: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const prompt = (kind: PromptKind, index: number): MenuAction => {
    /* The reason nothing can be sent goes above the first item, where it is
       read before any of them is tried; otherwise a line sets the two that are
       always on offer apart from the ones that apply now, when there are any. */
    const section =
      index === 0 && onPrompt === null
        ? { section: { note: t('pullRequest.noConversation') } }
        : index > 0 && kind === FIRST_ALWAYS
          ? { section: {} }
          : {}

    return {
      id: kind,
      label: t(LABELS[kind]),
      icon: <Sparkles aria-hidden size={12} />,
      disabled: onPrompt === null,
      ...section,
      onSelect: () => {
        onPrompt?.(kind)
      }
    }
  }

  return (
    <DropdownMenu
      align="left"
      actions={[
        ...offered.map(prompt),
        {
          id: 'instructions',
          label: t('pullRequest.editInstructionsItem'),
          icon: <SlidersHorizontal aria-hidden size={12} />,
          // The instruction is the project's own, edited where it lives
          // rather than in a second editor here that could disagree with it.
          section: {},
          onSelect: onEditInstructions
        }
      ]}
      trigger={({ onClick, open }) => (
        <Button
          size="sm"
          variant="agent"
          onClick={onClick}
          aria-expanded={open}
          disabled={sending !== null}
        >
          <Sparkles aria-hidden size={12} />
          {t(sending === null ? 'pullRequest.askAgent' : 'pullRequest.sending')}
          <ChevronUp aria-hidden size={12} />
        </Button>
      )}
    />
  )
}
