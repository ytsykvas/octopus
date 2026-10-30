import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { ContextBreakdown } from '@core/contextBreakdown.js'

import { ContextPanel, contextPanelHeight } from './ContextPanel.js'

const BREAKDOWN: ContextBreakdown = {
  categories: [
    { id: 'messages', tokens: 20_000 },
    { id: 'system_tools', tokens: 12_000 },
    { id: 'system_prompt', tokens: 8000 }
  ],
  memoryFiles: [
    { path: '/Users/x/.claude/CLAUDE.md', tokens: 2100 },
    { path: '/w/CLAUDE.md', tokens: 900 }
  ],
  mcpServers: [{ name: 'github', tokens: 1800 }],
  tools: [
    { name: 'Bash', tokens: 720 },
    { name: 'Read', tokens: 110 }
  ]
}

const TITLE = 'What fills the context'

function renderPanel(breakdown: ContextBreakdown = BREAKDOWN): void {
  render(<ContextPanel breakdown={breakdown} usedTokens={40_000} />)
}

const open = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: TITLE }))
}

describe('what fills the context window', () => {
  it('stays closed until it is asked for', () => {
    renderPanel()

    expect(screen.getByRole('button', { name: TITLE })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens a panel named for what it answers', async () => {
    renderPanel()
    await open()

    expect(screen.getByRole('dialog', { name: TITLE })).toBeInTheDocument()
  })

  it('names each kind of row, heaviest first, with its size', async () => {
    renderPanel()
    await open()

    const bars = screen.getAllByRole('progressbar').map((bar) => bar.getAttribute('aria-label'))

    expect(bars.slice(0, 3)).toEqual(['Messages', 'System tools', 'System prompt'])
    expect(screen.getByText('20k')).toBeInTheDocument()
    expect(screen.getByText('12k')).toBeInTheDocument()
    expect(screen.getByText('8.0k')).toBeInTheDocument()
  })

  // jsdom lays nothing out, so a share is read off the value the bar was given.
  it('draws each row as its share of what the window holds', async () => {
    renderPanel()
    await open()

    const messages = screen.getByRole('progressbar', { name: 'Messages' })

    expect(messages).toHaveAttribute('aria-valuenow', '50')
  })

  // Two files may both be called CLAUDE.md; the end of the path tells them apart
  // and the title keeps the rest for the one who needs it.
  it('shortens a memory file to the end of its path and keeps the whole in its title', async () => {
    renderPanel()
    await open()

    expect(screen.getByTitle('/Users/x/.claude/CLAUDE.md')).toHaveTextContent('.claude/CLAUDE.md')
  })

  it('lists MCP servers and the heaviest tools', async () => {
    renderPanel()
    await open()

    expect(screen.getByText('github')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()
  })

  it('draws a section only when it has rows', async () => {
    renderPanel({ ...BREAKDOWN, mcpServers: [] })
    await open()

    expect(screen.queryByText('MCP servers')).not.toBeInTheDocument()
    expect(screen.getByText('Memory files')).toBeInTheDocument()
  })

  it('says where to go to forget everything after a message', async () => {
    renderPanel()
    await open()

    expect(
      screen.getByText(
        'To forget everything after a message, rewind from that message in the conversation.'
      )
    ).toBeInTheDocument()
  })
})

describe('how tall the panel will be', () => {
  // 36 header + 44 footer, then per section 24 for its heading and 30 a row.
  it('adds the chrome, a heading per section and a row per entry', () => {
    // 4 sections and 8 rows.
    expect(contextPanelHeight(BREAKDOWN)).toBe(36 + 44 + 4 * 24 + 8 * 30)
  })

  it('counts no heading for a section with nothing in it', () => {
    const only = {
      categories: [{ id: 'messages' as const, tokens: 1 }],
      memoryFiles: [],
      mcpServers: [],
      tools: []
    }

    expect(contextPanelHeight(only)).toBe(36 + 44 + 24 + 30)
  })

  // Placed before it is drawn, so a long list cannot ask for more than the
  // window has; the list itself scrolls.
  it('stops growing at a cap', () => {
    const many = {
      ...BREAKDOWN,
      memoryFiles: Array.from({ length: 40 }, (_, at) => ({
        path: `/w/${String(at)}.md`,
        tokens: 1
      }))
    }

    expect(contextPanelHeight(many)).toBe(480)
  })
})
