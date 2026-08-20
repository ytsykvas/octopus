import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

import { CodeBlock } from './CodeBlock.js'

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
    <p className="mt-3 mb-1 text-[15px] font-semibold first:mt-0">{children}</p>
  ),
  h2: ({ children }) => <p className="mt-3 mb-1 font-semibold first:mt-0">{children}</p>,
  h3: ({ children }) => (
    <p className="text-ink-soft mt-2.5 mb-1 font-semibold first:mt-0">{children}</p>
  ),
  h4: ({ children }) => (
    <p className="text-ink-soft mt-2.5 mb-1 font-semibold first:mt-0">{children}</p>
  ),

  p: ({ children }) => <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,

  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,

  a: ({ children, href }) => (
    // No navigation: a click would replace the window with the page, since this
    // is an Electron renderer and not a browser tab. Shown as a link, left as
    // text — the address is in the title for anyone who wants it.
    <span className="text-accent underline decoration-dotted" title={href}>
      {children}
    </span>
  ),

  blockquote: ({ children }) => (
    <blockquote className="border-line text-ink-soft my-1.5 border-l pl-3">{children}</blockquote>
  ),
  hr: () => <hr className="border-line my-3" />,

  // Fenced blocks arrive as `pre > code`, and the wrapper is what carries the
  // frame — so it is also the only place that knows a block is a block.
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ children, className }) => {
    // A fenced block is the only `code` that carries a language class, and it
    // is already inside the `pre` above — styling it again would put a chip
    // around every line of it.
    if (className !== undefined) return <code className={className}>{children}</code>

    return (
      <code className="bg-muted rounded-[4px] px-1 py-0.5 font-mono text-[11px]">{children}</code>
    )
  },

  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-line border-b px-2 py-1 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-line border-b px-2 py-1 align-top">{children}</td>
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
