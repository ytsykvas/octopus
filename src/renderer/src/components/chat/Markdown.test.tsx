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

describe('text that would not draw as itself', () => {
  /*
   * The half that stayed open when the permission card was fixed. Every plain
   * string the agent writes goes through `shown`; markdown did not, and
   * `PlanDialog` draws markdown on the surface where a plan is authorised — so
   * an override could reorder what somebody approved while the plan the agent
   * holds was untouched.
   */
  it('names a right-to-left override in the agent\u2019s prose', () => {
    render(<Markdown text={'Run rm -rf /tmp\u202E gnp.txt now.'} />)

    expect(screen.getByText('U+202E')).toBeInTheDocument()
  })

  /*
   * Three block contexts rather than one, because that was the open question:
   * the chip is an inline span, and a heading, a table cell and a fenced block
   * each had to take it without breaking.
   */
  it('names one in a heading', () => {
    render(<Markdown text={'# Deploy\u202E to staging'} />)

    expect(screen.getByText('U+202E')).toBeInTheDocument()
  })

  it('names one in a table cell', () => {
    render(<Markdown text={'| a |\n| --- |\n| one\u202Etwo |'} />)

    expect(screen.getByText('U+202E')).toBeInTheDocument()
  })

  /*
   * And inside a fenced block, which is where a command most often is.
   * `CodeBlock` copies `textContent`, so the copy carries the name rather than
   * the character — the trade-off `DiffPanel` already records, taken the same
   * way on purpose: what is copied is what was read.
   */
  it('names one inside a fenced block, and copies what it showed', () => {
    const { container } = render(<Markdown text={'```sh\nrm -rf /tmp\u202E gnp.txt\n```'} />)

    expect(screen.getByText('U+202E')).toBeInTheDocument()
    expect(container.querySelector('pre')?.textContent).toContain('U+202E')
    expect(container.querySelector('pre')?.textContent).not.toContain('\u202E')
  })

  // Text that is ordinary is left exactly as it is: no chip, no wrapper.
  it('leaves prose with nothing to name alone', () => {
    const { container } = render(<Markdown text={'An ordinary sentence.'} />)

    expect(container.querySelectorAll('span')).toHaveLength(0)
  })

  /*
   * `h5`, `h6` and `del` had no entry in the map, so their text reached the
   * document through the browser's own rendering — which is what the map
   * exists to prevent, and also meant nothing named an override in them.
   */
  it('names one in the elements that used to have no entry at all', () => {
    render(<Markdown text={'##### Five\u202E\n\n###### Six\u202E\n\n~~struck\u202Eout~~'} />)

    expect(screen.getAllByText('U+202E')).toHaveLength(3)
  })
})

describe('a run of characters with nowhere to wrap', () => {
  /*
   * The agent quotes what it was given, so a pasted URL or a line of minified
   * JSON comes back one turn later. Laid out at its full width it overflows
   * its paragraph, and the pane around it is `overflow-auto` — so the whole
   * conversation scrolls sideways and every other row goes off-centre.
   *
   * jsdom has no layout, so the class is the only thing here that can be
   * asserted. It is also exactly the fix, and removing it turns this red.
   */
  it('gives the agent\u2019s prose somewhere to break', () => {
    const { container } = render(<Markdown text={'See https://example.com/a/very/long/one'} />)

    expect(container.querySelector('p')).toHaveClass('wrap-anywhere')
  })

  it('gives a list item and a heading the same', () => {
    const { container } = render(<Markdown text={'# One\n\n- two'} />)

    expect(container.querySelector('li')).toHaveClass('wrap-anywhere')
    // Headings are drawn as `p`, so the first one is the heading.
    expect(container.querySelectorAll('p')[0]).toHaveClass('wrap-anywhere')
  })

  /*
   * And a fenced block does not get it: `white-space: pre` means no wrapping
   * happens whatever `overflow-wrap` says, and breaking code at an arbitrary
   * column would misrepresent it. The block keeps its own scroll.
   */
  it('leaves a fenced block to scroll instead', () => {
    const { container } = render(<Markdown text={'```\nlong\n```'} />)

    expect(container.querySelector('pre')).not.toHaveClass('wrap-anywhere')
  })
})
