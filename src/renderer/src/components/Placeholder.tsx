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
 */
export function Placeholder({ title, children, actions }: PlaceholderProps): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="panel flex max-w-md flex-col items-center p-8 text-center">
        <Mascot className="mb-4 size-24" />

        <p className="mb-2 text-[15px] font-semibold">{title}</p>
        <p className="text-ink-soft leading-relaxed">{children}</p>

        {actions !== undefined && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}
