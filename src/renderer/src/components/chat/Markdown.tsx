import { Children } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

import { shown } from '../diff/shown.js'
import { CodeBlock } from './CodeBlock.js'

/**
 * The same text, with anything that would not draw as itself named in place.
 *
 * `<ReactMarkdown>` has no hook for text nodes — `components` maps element
 * types — so this is applied by every component that can hold text, and the
 * map below is complete for that reason rather than for tidiness. The element
 * set is bounded and knowable: `mdast-util-to-hast` with `remark-gfm` and
 * `remark-breaks`, and raw HTML deliberately off, emits nothing else. `h5`,
 * `h6` and `del` were missing and had been falling through to the browser's
 * own sizes, which is the very thing the map exists to prevent.
 *
 * Only direct string children. An element child renders through its own entry
 * here and names its own text, so nesting is covered without a walk.
 *
 * A right-to-left override reorders what is on screen while the plan the agent
 * holds is untouched — and `PlanDialog` draws markdown on the surface where a
 * plan is approved for execution, one gesture from the permission card that
 * was fixed first.
 */
function marked(children: React.ReactNode): React.ReactNode {
  return Children.map(children, (child) => (typeof child === 'string' ? shown(child) : child))
}

/**
 * What keeps a long unbroken run inside the column.
 *
 * The agent quotes what it was given, so a pasted URL or a line of minified
 * JSON comes back one turn later with nowhere to wrap. Laid out at its full
 * width it overflows its paragraph, and the pane around it scrolls — which
 * takes every other row off-centre and has to be scrolled back to read.
 *
 * `wrap-anywhere` rather than `break-words`, for the reason `UserMessage`
 * gives: only `anywhere` counts towards the intrinsic size, so the block is
 * allowed to be narrow rather than merely spilling once a width is capped.
 *
 * Not on the wrapper, and not on `pre` or a table cell: `overflow-wrap` is
 * inherited, a fenced block is `white-space: pre` and wraps nowhere whatever
 * this says, and a table already scrolls inside its own box — making its cells
 * wrap instead would be a different design, decided elsewhere.
 */
const WRAP = 'wrap-anywhere'

/**
 * How each element is drawn, in the tokens the rest of the interface uses.
 *
 * Given explicitly rather than left to a prose stylesheet: this is markdown
 * written by a model, dropped into a chat log beside tool rows and permission
 * cards, and the browser's own `h1` would be three times the size of anything
 * around it. The scale here is the interface's, not a document's.
 */
const COMPONENTS: Components = {
  h1: ({ children }) => (
    <p className={`mt-3 mb-1 text-[15px] font-semibold first:mt-0 ${WRAP}`}>{marked(children)}</p>
  ),
  h2: ({ children }) => (
    <p className={`mt-3 mb-1 font-semibold first:mt-0 ${WRAP}`}>{marked(children)}</p>
  ),
  h3: ({ children }) => (
    <p className={`text-ink-soft mt-2.5 mb-1 font-semibold first:mt-0 ${WRAP}`}>
      {marked(children)}
    </p>
  ),
  h4: ({ children }) => (
    <p className={`text-ink-soft mt-2.5 mb-1 font-semibold first:mt-0 ${WRAP}`}>
      {marked(children)}
    </p>
  ),
  h5: ({ children }) => (
    <p className={`text-ink-soft mt-2.5 mb-1 font-semibold first:mt-0 ${WRAP}`}>
      {marked(children)}
    </p>
  ),
  h6: ({ children }) => (
    <p className={`text-ink-soft mt-2.5 mb-1 font-semibold first:mt-0 ${WRAP}`}>
      {marked(children)}
    </p>
  ),

  p: ({ children }) => (
    <p className={`my-1.5 leading-relaxed first:mt-0 last:mb-0 ${WRAP}`}>{marked(children)}</p>
  ),
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className={`leading-relaxed ${WRAP}`}>{marked(children)}</li>,

  strong: ({ children }) => <strong className="font-semibold">{marked(children)}</strong>,
  em: ({ children }) => <em className="italic">{marked(children)}</em>,
  del: ({ children }) => <del className="text-ink-faint line-through">{marked(children)}</del>,

  a: ({ children, href }) => (
    // No navigation: a click would replace the window with the page, since this
    // is an Electron renderer and not a browser tab. Shown as a link, left as
    // text — the address is in the title for anyone who wants it.
    <span className="text-accent underline decoration-dotted" title={href}>
      {marked(children)}
    </span>
  ),

  blockquote: ({ children }) => (
    <blockquote className={`border-line text-ink-soft my-1.5 border-l pl-3 ${WRAP}`}>
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-line my-3" />,

  // Fenced blocks arrive as `pre > code`, and the wrapper is what carries the
  // frame — so it is also the only place that knows a block is a block.
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ children, className }) => {
    // A fenced block is the only `code` that carries a language class, and it
    // is already inside the `pre` above — styling it again would put a chip
    // around every line of it.
    if (className !== undefined) return <code className={className}>{marked(children)}</code>

    return (
      <code className={`bg-muted rounded-[4px] px-1 py-0.5 font-mono text-[11px] ${WRAP}`}>
        {marked(children)}
      </code>
    )
  },

  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-line border-b px-2 py-1 font-semibold">{marked(children)}</th>
  ),
  td: ({ children }) => (
    <td className="border-line border-b px-2 py-1 align-top">{marked(children)}</td>
  )
}

/**
 * Markdown as the agent wrote it.
 *
 * Rendered rather than shown raw because a plan is mostly structure — headings,
 * steps, fenced code — and as one block of pre-wrapped text it reads as a wall
 * with `##` in it.
 *
 * Raw HTML is deliberately not enabled. This is model output, and the one thing
 * that must never be possible is markup from it reaching the document.
 *
 * `remarkBreaks` keeps a single newline as a line break. Markdown's own rule is
 * that only a blank line ends a paragraph, and that rule is written for prose
 * being typeset — it is wrong for everything that arrives here. A CLI command's
 * answer is lines: `/usage` reports each window on its own, and joined into a
 * paragraph the numbers run into the sentence that follows them and the reading
 * order stops being obvious. The agent writes to the same expectation, since
 * every other surface its output is read on breaks on a newline.
 *
 * A plugin rather than two trailing spaces inserted into the text: this one
 * works on the parsed document, so a newline inside a fenced block stays a
 * newline in code rather than becoming markup.
 */
export function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
