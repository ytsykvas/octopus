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

  // A link that navigated would replace the whole window: this is a renderer,
  // not a browser tab, and there is no way back from it.
  it('shows a link without offering to follow it', () => {
    const { container } = render(<Markdown text={'[the docs](https://example.com)'} />)

    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByTitle('https://example.com')).toHaveTextContent('the docs')
  })
})
