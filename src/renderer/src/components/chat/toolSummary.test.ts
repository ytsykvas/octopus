import type { BUILTIN_TOOL_NAMES } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, expectTypeOf, it } from 'vitest'

import { describeToolInput, planTitle, readPlan, readWorktreeMove } from './toolSummary.js'

describe('what a tool call acted on', () => {
  // A tool call is only legible if the row says what it touched, and every
  // tool names that differently.
  it('reads the field each tool uses to name its target', () => {
    expect(describeToolInput({ file_path: '/src/auth.rb' })).toBe('/src/auth.rb')
    expect(describeToolInput({ command: 'npm test' })).toBe('npm test')
    expect(describeToolInput({ pattern: 'useEffect' })).toBe('useEffect')
    expect(describeToolInput({ path: '/src' })).toBe('/src')
    expect(describeToolInput({ url: 'https://example.com' })).toBe('https://example.com')
    expect(describeToolInput({ description: 'run the suite' })).toBe('run the suite')
  })

  // Bash carries both a command and a description; the command is what was run.
  it('prefers the more specific field when a tool carries several', () => {
    expect(describeToolInput({ command: 'npm test', description: 'run the suite' })).toBe(
      'npm test'
    )
  })

  it('trims what it shows', () => {
    expect(describeToolInput({ file_path: '  /src/auth.rb  ' })).toBe('/src/auth.rb')
  })

  it('says nothing rather than showing an empty field', () => {
    expect(describeToolInput({ file_path: '   ' })).toBeNull()
    expect(describeToolInput({})).toBeNull()
  })

  // The shape belongs to whichever tool the model picked, so anything may turn
  // up here — including nothing shaped like an object at all.
  it('says nothing for an input it cannot read', () => {
    expect(describeToolInput(null)).toBeNull()
    expect(describeToolInput('a string')).toBeNull()
    expect(describeToolInput({ file_path: 42 })).toBeNull()
    expect(describeToolInput({ todos: [{ content: 'x' }] })).toBeNull()
  })
})

// In plan mode the agent writes no prose: it calls `ExitPlanMode` and puts the
// whole plan in an argument. Summarised like any other tool call it vanished —
// the row showed a name and nothing else, and the plan was never on screen.
describe('a plan handed over as a tool call', () => {
  it('is read out of the call that carries it', () => {
    expect(readPlan('ExitPlanMode', { plan: '# Add a farewell\n\nOne export.' })).toBe(
      '# Add a farewell\n\nOne export.'
    )
  })

  it('is not looked for in any other tool', () => {
    expect(readPlan('Edit', { plan: 'not a plan' })).toBeNull()
  })

  it('is absent when the call carries none', () => {
    expect(readPlan('ExitPlanMode', { file_path: '/a.ts' })).toBeNull()
    expect(readPlan('ExitPlanMode', { plan: '' })).toBeNull()
    expect(readPlan('ExitPlanMode', null)).toBeNull()
  })

  // The summary looks for `file_path`, `command` and their like, and a plan has
  // none of them — which is exactly how it came to be invisible.
  it('is what the ordinary summary cannot see', () => {
    expect(describeToolInput({ plan: '# Add a farewell' })).toBeNull()
  })
})

describe('what a plan calls itself', () => {
  it('takes the first heading, without its hashes', () => {
    expect(planTitle('# Normalising the locales\n\n## Context\n\nSome prose.')).toBe(
      'Normalising the locales'
    )
  })

  it('falls back to the first line when the plan opens with prose', () => {
    expect(planTitle('\n\nRename the config field.\n\nThen the rest.')).toBe(
      'Rename the config field.'
    )
  })

  // This becomes part of a sentence asking for the plan by name, so a plan
  // whose first line is a paragraph would otherwise become the whole message.
  it('shortens a first line too long to be a name', () => {
    const title = planTitle(`# ${'a'.repeat(200)}`)

    expect(title).toHaveLength(81)
    expect(title.endsWith('…')).toBe(true)
  })

  it('answers nothing for a plan with nothing in it', () => {
    expect(planTitle('\n   \n')).toBe('')
  })
})

/** Every built-in tool the SDK names, by whether a call to it is itself a move into another worktree. */
const A_CALL_THAT_MOVES: Record<(typeof BUILTIN_TOOL_NAMES)[number], boolean> = {
  Agent: false,
  Artifact: false,
  AskUserQuestion: false,
  // A `cd` in a shell moves the session too, and the CLI keeps it — but
  // nothing in the call says where to, so it is not one to read here.
  Bash: false,
  ClaudeDesign: false,
  CronCreate: false,
  CronDelete: false,
  CronList: false,
  Edit: false,
  EndConversation: false,
  EnterPlanMode: false,
  EnterWorktree: true,
  ExitPlanMode: false,
  ExitWorktree: true,
  Glob: false,
  Grep: false,
  ListAgents: false,
  ListMcpResourcesTool: false,
  LSP: false,
  Monitor: false,
  NotebookEdit: false,
  OfferChromeSetup: false,
  // As `Bash`.
  PowerShell: false,
  Projects: false,
  propose_skills: false,
  ProposeGoal: false,
  PushNotification: false,
  Read: false,
  ReadMcpResourceDirTool: false,
  ReadMcpResourceTool: false,
  ReadNotifications: false,
  RemoteTrigger: false,
  ReportFindings: false,
  ScheduleWakeup: false,
  SendFeedback: false,
  SendMessage: false,
  SendUserFile: false,
  SendUserMessage: false,
  ShareOnboardingGuide: false,
  ShowOnboardingRolePicker: false,
  Skill: false,
  SubagentHandback: false,
  TaskCreate: false,
  TaskGet: false,
  TaskList: false,
  TaskStop: false,
  TaskUpdate: false,
  TodoWrite: false,
  ToolSearch: false,
  WaitForMcpServers: false,
  WebFetch: false,
  WebSearch: false,
  Workflow: false,
  Write: false
}

/*
 * The agent can move its working directory into another worktree. The window's
 * diff, files, terminal and scripts stay on the workspace's own, so the move is
 * said in the log rather than left as a tool name with nothing beside it.
 */
describe('the agent moving into another worktree, or back', () => {
  it('names the worktree it moved into, by path or by name', () => {
    expect(readWorktreeMove('EnterWorktree', { path: '/repo/.claude/worktrees/spike' })).toEqual({
      kind: 'enter',
      target: '/repo/.claude/worktrees/spike'
    })
    expect(readWorktreeMove('EnterWorktree', { name: ' spike ' })).toEqual({
      kind: 'enter',
      target: 'spike'
    })
  })

  // Without either the CLI makes up a name, which only its result says.
  it('moves into a new worktree it was given no name for', () => {
    expect(readWorktreeMove('EnterWorktree', {})).toEqual({ kind: 'enter', target: null })
    expect(readWorktreeMove('EnterWorktree', { name: '  ' })).toEqual({
      kind: 'enter',
      target: null
    })
  })

  it('tells leaving one kept from leaving one removed', () => {
    expect(readWorktreeMove('ExitWorktree', { action: 'keep' })).toEqual({
      kind: 'exit',
      removed: false
    })
    expect(readWorktreeMove('ExitWorktree', { action: 'remove', discard_changes: true })).toEqual({
      kind: 'exit',
      removed: true
    })
  })

  /*
   * Over the SDK's own list, so a tool the SDK adds to it fails the typecheck
   * here until somebody says whether a call to it is a move. One that is and
   * is not read here leaves the diff, the terminal and the scripts on the
   * workspace's worktree without a word.
   */
  it('is read from every built-in call that is a move, and from no other', () => {
    // A list that widened to `string` would still compile and decide nothing.
    expectTypeOf<(typeof BUILTIN_TOOL_NAMES)[number]>().not.toEqualTypeOf<string>()
    for (const [name, moves] of Object.entries(A_CALL_THAT_MOVES)) {
      // Both schemas read this, so a null means "not looked for", not "unreadable".
      expect(readWorktreeMove(name, { action: 'keep' }) !== null, name).toBe(moves)
    }
  })

  it('is not looked for in any other tool, nor in an input it cannot read', () => {
    expect(readWorktreeMove('Bash', { path: '/elsewhere' })).toBeNull()
    expect(readWorktreeMove('ExitWorktree', { action: 'archive' })).toBeNull()
    expect(readWorktreeMove('EnterWorktree', null)).toBeNull()
  })
})
