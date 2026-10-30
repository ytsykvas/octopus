import { describe, expect, it } from 'vitest'

import { breakdownFrom, CONTEXT_CATEGORY_IDS, TOP_TOOLS } from './contextBreakdown.js'

/**
 * A `getContextUsage` reply as the CLI sends it, cut down to the parts the
 * breakdown reads — and with the parts it must ignore left in on purpose:
 * buffer, free and deferred rows, a row with no id, a zero row, and fields
 * (`gridRows`, `apiUsage`, `model`) that belong to the reading instead.
 */
const LIVE = {
  model: 'claude-opus-5[1m]',
  gridRows: [],
  apiUsage: null,
  categories: [
    { id: 'system_prompt', name: 'System prompt', tokens: 3313, color: 'a', kind: 'used' },
    { id: 'system_tools', name: 'System tools', tokens: 9000, color: 'b', kind: 'used' },
    { id: 'mcp_tools_deferred', name: 'MCP tools', tokens: 4000, color: 'c', kind: 'deferred' },
    { id: 'messages', name: 'Messages', tokens: 20_000, color: 'd', kind: 'used' },
    { id: 'autocompact_buffer', name: 'Buffer', tokens: 33_000, color: 'e', kind: 'buffer' },
    { id: 'free_space', name: 'Free', tokens: 900_000, color: 'f', kind: 'free' },
    { name: 'Mystery', tokens: 50, color: 'g', kind: 'used' },
    { id: 'skills', name: 'Skills', tokens: 0, color: 'h', kind: 'used' }
  ],
  memoryFiles: [
    { path: '/Users/x/.claude/CLAUDE.md', type: 'User', tokens: 900 },
    { path: '/w/CLAUDE.md', type: 'Project', tokens: 2100 },
    { path: '/w/a/CLAUDE.md', type: 'Project', tokens: 0 }
  ],
  mcpTools: [
    { name: 'a', serverName: 'github', tokens: 1000 },
    { name: 'b', serverName: 'github', tokens: 500 },
    { name: 'c', serverName: 'linear', tokens: 700, isLoaded: false }
  ],
  mcpInstructions: [{ serverName: 'github', tokens: 300 }],
  messageBreakdown: {
    toolCallsByType: [
      { name: 'Read', callTokens: 10, resultTokens: 100 },
      { name: 'Bash', callTokens: 20, resultTokens: 700 },
      { name: 'Grep', callTokens: 5, resultTokens: 50 },
      { name: 'Edit', callTokens: 300, resultTokens: 30 },
      { name: 'Write', callTokens: 200, resultTokens: 10 },
      { name: 'Glob', callTokens: 1, resultTokens: 2 },
      { name: 'Agent', callTokens: 40, resultTokens: 500 }
    ]
  }
}

describe('what fills the context window', () => {
  it('counts only the kinds that occupy the window, heaviest first', () => {
    expect(breakdownFrom(LIVE)?.categories).toEqual([
      { id: 'messages', tokens: 20_000 },
      { id: 'system_tools', tokens: 9000 },
      { id: 'system_prompt', tokens: 3313 }
    ])
  })

  // The id alone does not say whether a row is in the window: a later CLI may
  // send a known id with a kind that is not `used`, and that row is not filling it.
  it('leaves out a known id the CLI says is not in the window', () => {
    const read = breakdownFrom({
      categories: [
        { id: 'messages', tokens: 100, kind: 'used' },
        { id: 'skills', tokens: 700, kind: 'deferred' }
      ]
    })

    expect(read?.categories).toEqual([{ id: 'messages', tokens: 100 }])
  })

  it('lists the memory files that cost something, heaviest first', () => {
    expect(breakdownFrom(LIVE)?.memoryFiles).toEqual([
      { path: '/w/CLAUDE.md', tokens: 2100 },
      { path: '/Users/x/.claude/CLAUDE.md', tokens: 900 }
    ])
  })

  it('sums an MCP server’s tools and instructions under its name, loaded tools only', () => {
    expect(breakdownFrom(LIVE)?.mcpServers).toEqual([{ name: 'github', tokens: 1800 }])
  })

  it('names the heaviest tools by call and result together, and stops at the top few', () => {
    const tools = breakdownFrom(LIVE)?.tools

    expect(tools).toHaveLength(TOP_TOOLS)
    expect(tools).toEqual([
      { name: 'Bash', tokens: 720 },
      { name: 'Agent', tokens: 540 },
      { name: 'Edit', tokens: 330 },
      { name: 'Write', tokens: 210 },
      { name: 'Read', tokens: 110 }
    ])
  })

  it('leaves a section empty when the reply has nothing for it', () => {
    const { categories } = LIVE

    expect(breakdownFrom({ categories })).toEqual({
      categories: [
        { id: 'messages', tokens: 20_000 },
        { id: 'system_tools', tokens: 9000 },
        { id: 'system_prompt', tokens: 3313 }
      ],
      memoryFiles: [],
      mcpServers: [],
      tools: []
    })
  })

  it('costs one section, not the rest, when it is malformed', () => {
    const read = breakdownFrom({ ...LIVE, memoryFiles: 'x' })

    expect(read?.memoryFiles).toEqual([])
    expect(read?.categories).toHaveLength(3)
    expect(read?.mcpServers).toEqual([{ name: 'github', tokens: 1800 }])
  })

  it('drops one malformed entry and keeps its neighbours', () => {
    const read = breakdownFrom({
      ...LIVE,
      memoryFiles: [{ path: 7 }, { path: '/w/CLAUDE.md', tokens: 2100 }]
    })

    expect(read?.memoryFiles).toEqual([{ path: '/w/CLAUDE.md', tokens: 2100 }])
  })

  it.each([null, 'text', {}, { categories: 'x' }])('says nothing for %j', (reply) => {
    expect(breakdownFrom(reply)).toBeNull()
  })

  it('says nothing when no category is left after filtering', () => {
    const only = [{ id: 'free_space', tokens: 5, kind: 'free' }]

    expect(breakdownFrom({ categories: only })).toBeNull()
  })

  it('keeps the order it was given between equal weights', () => {
    const read = breakdownFrom({
      ...LIVE,
      messageBreakdown: {
        toolCallsByType: [
          { name: 'First', callTokens: 5, resultTokens: 5 },
          { name: 'Second', callTokens: 4, resultTokens: 6 }
        ]
      }
    })

    expect(read?.tools.map((tool) => tool.name)).toEqual(['First', 'Second'])
  })

  it('knows the ids the panel will label', () => {
    expect(CONTEXT_CATEGORY_IDS).toContain('messages')
  })
})
