import { describe, expect, it } from 'vitest'

import {
  allowedStanding,
  covers,
  StandingPermissionSchema,
  standingKey,
  withStanding
} from './standingPermissions.js'

const whole = (toolName: string): { toolName: string; ruleContent: null } => ({
  toolName,
  ruleContent: null
})

const narrow = (
  toolName: string,
  ruleContent: string
): { toolName: string; ruleContent: string } => ({ toolName, ruleContent })

describe('reading a standing answer back', () => {
  /* Every config written before this holds bare names, and a bare name means
     exactly what it always meant: the whole tool. */
  it('reads a bare tool name as the whole tool', () => {
    expect(StandingPermissionSchema.parse('Edit')).toEqual({ toolName: 'Edit', ruleContent: null })
  })

  it('reads a rule with the path it was about', () => {
    expect(
      StandingPermissionSchema.parse({ toolName: 'Edit', ruleContent: '/w/.claude/**' })
    ).toEqual({ toolName: 'Edit', ruleContent: '/w/.claude/**' })
  })

  it('reads a rule with no content as the whole tool', () => {
    expect(StandingPermissionSchema.parse({ toolName: 'Edit' })).toEqual({
      toolName: 'Edit',
      ruleContent: null
    })
  })
})

describe('whether a standing answer covers a call', () => {
  it('does not answer for another tool', () => {
    expect(covers(whole('Edit'), 'Write', { file_path: '/w/a.ts' })).toBe(false)
  })

  it('answers for the whole tool when that is what was granted', () => {
    expect(covers(whole('Edit'), 'Edit', { file_path: '/w/anywhere.ts' })).toBe(true)
  })

  /*
   * The finding this exists for. Answering "always" on one file under
   * `.claude/` used to grant every `Edit` in every workspace, which is an
   * approval an order of magnitude wider than the question asked.
   */
  it('answers only inside the place the rule names', () => {
    const rule = narrow('Edit', '/w/.claude/skills/demo/**')

    expect(covers(rule, 'Edit', { file_path: '/w/.claude/skills/demo/SKILL.md' })).toBe(true)
    expect(covers(rule, 'Edit', { file_path: '/w/src/core/service.ts' })).toBe(false)
  })

  it('answers for the directory itself as well as what is under it', () => {
    expect(covers(narrow('Edit', '/w/docs/**'), 'Edit', { file_path: '/w/docs' })).toBe(true)
  })

  /*
   * A wildcard **inside** a segment is not read at all.
   *
   * Truncating `/w/src/comp*.ts` to its parent would grant the whole of
   * `/w/src` — wider than the rule says, which is the exact failure this
   * module exists to prevent. Asking again costs a click and grants nothing.
   */
  it('covers nothing when the wildcard sits inside a name', () => {
    const rule = narrow('Edit', '/w/src/comp*.ts')

    expect(covers(rule, 'Edit', { file_path: '/w/src/components-private/secret.ts' })).toBe(false)
    expect(covers(rule, 'Edit', { file_path: '/w/src/compose.ts' })).toBe(false)
  })

  /* A rule naming one file covers that file and nothing else. */
  it('covers the one file a rule with no wildcard names', () => {
    const rule = narrow('Edit', '/w/README.md')

    expect(covers(rule, 'Edit', { file_path: '/w/README.md' })).toBe(true)
    expect(covers(rule, 'Edit', { file_path: '/w/README.md.bak' })).toBe(false)
  })

  /* The root is not a place: `/**` would be every path on the machine. */
  it('covers nothing for a rule about the root', () => {
    expect(covers(narrow('Edit', '/**'), 'Edit', { file_path: '/w/a.ts' })).toBe(false)
  })

  /*
   * Narrower than the rule says is safe; wider is the bug. A rule opening with
   * a wildcard would otherwise read as "every path", which is the width this
   * whole change exists to avoid — so it covers nothing and the user is asked.
   */
  it('covers nothing when the rule begins with a wildcard', () => {
    expect(covers(narrow('Edit', '**/*.ts'), 'Edit', { file_path: '/w/a.ts' })).toBe(false)
  })

  /* A `Bash` command has no path argument, so a narrow rule never covers one
     and the user is asked again. */
  it('covers nothing it cannot find a path in', () => {
    expect(covers(narrow('Bash', '/w/**'), 'Bash', { command: 'rm -rf /' })).toBe(false)
    expect(covers(narrow('Edit', '/w/**'), 'Edit', null)).toBe(false)
    expect(covers(narrow('Edit', '/w/**'), 'Edit', { file_path: '' })).toBe(false)
  })

  /* The schema refuses an empty rule, so this is reachable only by calling in
     directly — and the answer is the safe one either way. */
  it('covers nothing for a rule that names nothing', () => {
    expect(covers(narrow('Edit', ''), 'Edit', { file_path: '/w/a.ts' })).toBe(false)
  })

  it('covers what is under a rule already written as a directory', () => {
    const rule = narrow('Edit', '/w/docs/')

    expect(covers(rule, 'Edit', { file_path: '/w/docs/ui.md' })).toBe(true)
    expect(covers(rule, 'Edit', { file_path: '/w/docsy/ui.md' })).toBe(false)
  })

  it('asks the whole list', () => {
    const list = [whole('Read'), narrow('Edit', '/w/docs/**')]

    expect(allowedStanding(list, 'Edit', { file_path: '/w/docs/ui.md' })).toBe(true)
    expect(allowedStanding(list, 'Edit', { file_path: '/w/src/a.ts' })).toBe(false)
    expect(allowedStanding([], 'Read', { file_path: '/w/a.ts' })).toBe(false)
  })
})

describe('adding a standing answer', () => {
  it('keeps the narrowest reading of what was granted', () => {
    const one = withStanding([], narrow('Edit', '/w/docs/**'))
    expect(one).toEqual([narrow('Edit', '/w/docs/**')])

    // The whole tool replaces the narrow ones it makes redundant.
    expect(withStanding(one, whole('Edit'))).toEqual([whole('Edit')])
  })

  /* Otherwise the list grows a row per file for a permission somebody already
     has, and the Settings screen stops being readable. */
  it('adds nothing narrow where the whole tool is already granted', () => {
    expect(withStanding([whole('Edit')], narrow('Edit', '/w/docs/**'))).toEqual([whole('Edit')])
  })

  it('adds the same rule once', () => {
    const list = withStanding([], narrow('Edit', '/w/docs/**'))

    expect(withStanding(list, narrow('Edit', '/w/docs/**'))).toEqual(list)
  })

  it('leaves another tool alone', () => {
    const list = withStanding([whole('Read')], narrow('Edit', '/w/docs/**'))

    expect(list).toEqual([whole('Read'), narrow('Edit', '/w/docs/**')])
  })
})

describe('what a standing answer is known by', () => {
  it('names the tool, and the place when there is one', () => {
    expect(standingKey(whole('Edit'))).toBe('Edit')
    expect(standingKey(narrow('Edit', '/w/docs/**'))).toBe('Edit(/w/docs/**)')
  })
})
