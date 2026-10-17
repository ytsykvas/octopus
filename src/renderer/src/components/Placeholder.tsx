import { Mascot } from './Mascot.js'

interface PlaceholderProps {
  readonly title: string
  readonly children: React.ReactNode
  /**
   * Buttons offering the way out of the empty state.
   *
   * A slot of its own rather than part of `children`, which renders inside a
   * paragraph — a button there would be a block element inside a `<p>`, which
   * the browser silently reshapes into markup nobody wrote.
   */
  readonly actions?: React.ReactNode
  /**
   * For a tab in the right column rather than the centre.
   *
   * No panel around it: the column is a few hundred pixels wide and already a
   * panel of its own, and a box inside it reads as a dialog nobody opened. And
   * it scrolls rather than clips, because the server half of the Scripts tab
   * can be left with very little height once the build half is unfolded.
   */
  readonly compact?: boolean
  /**
   * False where another empty state shares the tab. The Scripts tab stacks a
   * build half over a server half, each with its own empty state, and two
   * octopuses one above the other read as a rendering glitch.
   */
  readonly art?: boolean
}

/**
 * What a pane says when it has nothing to show yet.
 *
 * One component rather than a copy per pane: the centre and the chat each had
 * their own, already a few pixels apart, and an empty state is exactly the
 * screen a first-time user reads most carefully.
 *
 * The mascot is decorative and marked so. A screen reader announcing "blue
 * octopus" before "Select a project" would add a word and no information —
 * the title beneath it already says everything the image is there to soften.
 * It is sized by height alone: the drawing is wider than it is tall, and a
 * square box would squeeze it.
 */
export function Placeholder({
  title,
  children,
  actions,
  compact = false,
  art = true
}: PlaceholderProps): React.JSX.Element {
  return (
    <div
      className={`flex min-h-0 flex-1 items-center justify-center ${compact ? 'overflow-auto p-4' : 'p-6'}`}
    >
      <div
        className={`flex flex-col items-center text-center ${compact ? 'max-w-xs p-2' : 'panel max-w-md p-8'}`}
      >
        {art && <Mascot pose="searching" className={`${compact ? 'h-20' : 'h-24'} mb-4 w-auto`} />}

        <p className={`mb-2 font-semibold ${compact ? 'text-[14px]' : 'text-[15px]'}`}>{title}</p>
        <p className="text-ink-soft leading-relaxed">{children}</p>

        {actions !== undefined && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}
