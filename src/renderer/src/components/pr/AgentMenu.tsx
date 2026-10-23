import { ChevronUp, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../Button.js'
import { DropdownMenu, type MenuAction } from '../DropdownMenu.js'
import type { PromptKind } from './requestStatus.js'

/** Each prepared message, named for what pressing it does. */
const LABELS = {
  fixChecks: 'pullRequest.fixChecks',
  addressReview: 'pullRequest.addressReview',
  resolveConflicts: 'pullRequest.resolveConflicts',
  review: 'pullRequest.doReview',
  multiAgentReview: 'pullRequest.multiAgentReview'
} as const satisfies Record<PromptKind, string>

/** The two that apply to any open request, under whatever this moment calls for. */
const ALWAYS = ['review', 'multiAgentReview'] as const satisfies readonly PromptKind[]

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
  /** What this moment calls for, most pressing first — `requestStatus` decides. */
  readonly offered: readonly PromptKind[]
  /**
   * Sends a kind's instruction, or null where there is no conversation to send
   * it to — which draws every prompt disabled, with the reason above the first.
   */
  readonly onPrompt: ((kind: PromptKind) => void) | null
  /** A prepared message on its way, which the trigger says. */
  readonly sending: boolean
  readonly onEditInstructions: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  /* The reason nothing can be sent is the first item's description: read
     before any of them is tried, and — unlike a section's note, which is
     presentation — read by a screen reader too. Otherwise a line sets the two
     that are always on offer apart from the ones that apply now, when there are
     any. A disabled row takes no press, so the call below only ever runs with a
     conversation to send to. */
  const prompt = (kind: PromptKind, index: number): MenuAction => ({
    id: kind,
    label: t(LABELS[kind]),
    icon: <Sparkles aria-hidden size={12} />,
    disabled: onPrompt === null,
    ...(index === 0 && onPrompt === null ? { description: t('pullRequest.noConversation') } : {}),
    ...(index > 0 && kind === ALWAYS[0] ? { section: {} } : {}),
    onSelect: () => {
      onPrompt?.(kind)
    }
  })

  return (
    <DropdownMenu
      align="left"
      actions={[
        ...[...offered, ...ALWAYS].map(prompt),
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
          disabled={sending}
          className="whitespace-nowrap"
        >
          <Sparkles aria-hidden size={12} />
          {t(sending ? 'pullRequest.sending' : 'pullRequest.askAgent')}
          <ChevronUp aria-hidden size={12} />
        </Button>
      )}
    />
  )
}
