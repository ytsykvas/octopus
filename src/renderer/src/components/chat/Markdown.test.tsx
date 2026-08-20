import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Markdown } from './Markdown.js'

describe('markdown as the agent wrote it', () => {
  it('turns headings into headings rather than showing the hashes', () => {
    render(<Markdown text={'# Normalising the locales\n\nSome prose.'} />)

    expect(screen.getByText('Normalising the locales')).toBeInTheDocument()
    expect(screen.queryByText(/^#/)).not.toBeInTheDocument()
  })

  it('keeps a fenced block as one block rather than as loose lines', () => {
    const { container } = render(<Markdown text={'```ts\nconst a = 1\n```'} />)

    const block = container.querySelector('pre')
    expect(block).toBeInTheDocument()
    expect(block?.textContent).toContain('const a = 1')
  })

  it('draws a list as a list', () => {
    const { container } = render(<Markdown text={'- first\n- second'} />)

    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('sets inline code apart from the words around it', () => {
    const { container } = render(<Markdown text={'Look at `en.ts` first.'} />)

    expect(container.querySelector('code')?.textContent).toBe('en.ts')
  })

  // Every element the agent actually reaches for in a plan, in one document.
  // Each one is drawn by a rule of ours rather than by the browser's defaults —
  // an unstyled `h1` in a chat log is three times the size of everything beside
  // it — so each is a rule that can be got wrong.
  it('draws every part of a plan the way the interface draws things', () => {
    const { container } = render(
      <Markdown
        text={[
          '# Title',
          '## Section',
          '### Step',
          '#### Detail',
          '',
          'Prose with **bold** and *emphasis*.',
          '',
          '1. first',
          '2. second',
          '',
          '> a quotation',
          '',
          '---',
          '',
          '| Field | Meaning |',
          '| --- | --- |',
          '| `en` | the source |'
        ].join('\n')}
      />
    )

    for (const text of ['Title', 'Section', 'Step', 'Detail']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }

    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('emphasis')
    expect(container.querySelectorAll('ol li')).toHaveLength(2)
    expect(container.querySelector('blockquote')?.textContent).toContain('a quotation')
    expect(container.querySelector('hr')).toBeInTheDocument()
    expect(container.querySelector('th')?.textContent).toBe('Field')
    expect(container.querySelector('td')?.textContent).toBe('en')
  })

  // The single assertion that is about safety rather than looks. A plan is
  // model output; markup inside it must stay text, whatever it says.
  it('never lets markup out of the text into the document', () => {
    const { container } = render(
      <Markdown text={'<img src=x onerror="alert(1)"> and <b>bold</b>'} />
    )

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<b>bold</b>')
  })

  // What `/usage` sends: one window per line, no blank lines between them.
  // Under markdown's own rule those are one paragraph, and the answer read as a
  // wall with the numbers running into the words after them.
  it('keeps a line on its own line without a blank line above it', () => {
    const { container } = render(
      <Markdown text={'Current session: 29% used\nCurrent week: 8% used'} />
    )

    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(container.querySelectorAll('br')).toHaveLength(1)
  })

  // The reason this is a plugin and not two spaces appended to every line: a
  // fenced block's newlines are content, and marking them up would put `<br>`
  // through the middle of the code.
  it('leaves the newlines inside a fenced block as newlines', () => {
    const { container } = render(<Markdown text={'```ts\nconst a = 1\nconst b = 2\n```'} />)

    expect(container.querySelector('pre br')).toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('const a = 1\nconst b = 2')
  })

  // A link that navigated would replace the whole window: this is a renderer,
  // not a browser tab, and there is no way back from it.
  it('shows a link without offering to follow it', () => {
    const { container } = render(<Markdown text={'[the docs](https://example.com)'} />)

    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByTitle('https://example.com')).toHaveTextContent('the docs')
  })
})
