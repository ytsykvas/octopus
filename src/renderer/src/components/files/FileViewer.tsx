import { ExternalLink, RefreshCw } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useFileContent } from '../../hooks/useFileContent.js'
import { highlight, type Token } from '../diff/highlight.js'
import { languageFor } from '../diff/language.js'
import { MAX_LINE_LENGTH } from '../diff/useHighlighting.js'
import { fileSize } from '../fileSize.js'
import { IconButton, Notice } from '../paneControls.js'

/**
 * Past these a file is drawn plain.
 *
 * The highlighter runs in the window's own thread, and a large file freezes it
 * for as long as tokenising takes — longer than it is worth for a file being
 * read rather than edited. Lines are the diff's own limit: a minified bundle is
 * a few enormous lines, and those are the slow ones.
 */
export const MAX_HIGHLIGHT_CHARS = 256_000
export const MAX_HIGHLIGHT_LINES = 20_000

function highlightable(text: string, lines: readonly string[]): boolean {
  return (
    text.length <= MAX_HIGHLIGHT_CHARS &&
    lines.length <= MAX_HIGHLIGHT_LINES &&
    lines.every((line) => line.length <= MAX_LINE_LENGTH)
  )
}

interface FileViewerProps {
  readonly workspaceId: string
  readonly path: string
  readonly onError: (message: string | null) => void
}

/**
 * A file of the workspace, read-only, in the centre where the conversations
 * are.
 *
 * Read-only on purpose: the agent writes these files, and an editor here would
 * be a second writer racing it with nothing to say which won. "Open in editor"
 * is the way to change one.
 */
export function FileViewer({ workspaceId, path, onError }: FileViewerProps): React.JSX.Element {
  const { t } = useTranslation()
  const { content, error, reload, openExternally } = useFileContent(workspaceId, path)

  const open = async (): Promise<void> => {
    const failure = await openExternally()
    if (failure !== null) onError(failure)
  }

  const body = (): React.JSX.Element => {
    if (error !== null) return <Notice tone="danger">{error}</Notice>
    if (content === null) return <Notice>{t('viewer.loading')}</Notice>

    switch (content.kind) {
      case 'text':
        return <Code path={path} text={content.text} />
      case 'binary':
        return <Notice>{t('viewer.binary', { size: fileSize(content.bytes) })}</Notice>
      case 'tooLarge':
        return (
          <Notice>
            {t('viewer.tooLarge', {
              size: fileSize(content.bytes),
              limit: fileSize(content.limit)
            })}
          </Notice>
        )
      case 'missing':
        return <Notice>{t('viewer.missing')}</Notice>
      case 'deleted':
        return content.text === null ? (
          <Notice>{t('viewer.deletedUnreadable')}</Notice>
        ) : (
          <>
            <p className="bg-danger-bg text-danger border-line shrink-0 border-b px-4 py-1.5 text-[12px]">
              {t('viewer.deleted')}
            </p>
            <Code path={path} text={content.text} />
          </>
        )
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line flex shrink-0 items-center gap-2 border-b px-4 py-1.5">
        <span className="text-ink-faint min-w-0 flex-1 truncate font-mono text-[11px]" title={path}>
          {path}
        </span>
        <IconButton label={t('viewer.reload')} onClick={reload}>
          <RefreshCw aria-hidden size={13} />
        </IconButton>
        <IconButton label={t('viewer.openExternally')} onClick={() => void open()}>
          <ExternalLink aria-hidden size={13} />
        </IconButton>
      </div>
      {body()}
    </div>
  )
}

/**
 * The text with line numbers, coloured once the highlighter has it.
 *
 * Two `<pre>`s side by side rather than a row per line: a 5 000-line file is
 * then a handful of elements instead of ten thousand, and a selection in the
 * code never picks up the numbers.
 */
function Code({ path, text }: { readonly path: string; readonly text: string }): React.JSX.Element {
  const { t } = useTranslation()
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  const language = languageFor(path)
  const colourable = language !== null && highlightable(text, lines)

  const [coloured, setColoured] = useState<{ text: string; tokens: Token[][] } | null>(null)
  const tokens = coloured?.text === text ? coloured.tokens : null

  useEffect(() => {
    if (!colourable) return
    let current = true
    void highlight(language, text).then((found) => {
      if (current && found !== null) setColoured({ text, tokens: found })
    })
    return () => {
      current = false
    }
  }, [colourable, language, text])

  return (
    <>
      {language !== null && !colourable && (
        <p className="text-ink-faint border-line shrink-0 border-b px-4 py-1.5 text-[11px]">
          {t('viewer.plain')}
        </p>
      )}
      <div className="flex min-h-0 flex-1 overflow-auto">
        <pre
          aria-hidden
          // Its own ground, or long lines scrolled sideways show through it.
          className="text-ink-faint bg-canvas sticky left-0 shrink-0 py-3 pr-3 pl-4 text-right font-mono text-[12px] leading-[18px] select-none"
        >
          {lines.map((_, index) => index + 1).join('\n')}
        </pre>
        <pre className="diff-code text-ink min-w-0 flex-1 py-3 pr-4 font-mono text-[12px] leading-[18px]">
          {tokens === null
            ? lines.join('\n')
            : tokens.map((line, index) => (
                <Fragment key={index}>
                  {index > 0 && '\n'}
                  {line.map((token, at) => (
                    <span
                      key={at}
                      style={
                        {
                          '--shiki-light': token.light,
                          '--shiki-dark': token.dark
                        } as React.CSSProperties
                      }
                    >
                      {token.text}
                    </span>
                  ))}
                </Fragment>
              ))}
        </pre>
      </div>
    </>
  )
}
