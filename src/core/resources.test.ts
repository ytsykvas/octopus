import { describe, expect, it } from 'vitest'

import {
  agentCandidates,
  agentOwners,
  defaultProcessExec,
  measure,
  parseProcessTable,
  parseWorkingDirectories,
  type ProcessExec,
  type ProcessRow,
  readResources,
  terminalKind,
  terminalOwners
} from './resources.js'

const ROOT = 100

/** A process row with its memory given in KiB, the unit `ps` prints. */
function row(pid: number, ppid: number, cpu: number, kib: number): ProcessRow {
  return { pid, ppid, cpu, memory: kib * 1024 }
}

describe('parseProcessTable', () => {
  it('reads pid, parent, cpu and resident memory in bytes', () => {
    expect(parseProcessTable('  100     1  12.5  2048\n  101   100   0.0   512\n')).toEqual([
      row(100, 1, 12.5, 2048),
      row(101, 100, 0, 512)
    ])
  })

  it('skips a line that does not parse instead of failing the reading', () => {
    expect(parseProcessTable('garbage\n101 100 1.0\n102 100 x 4\n103 100 1.0 4\n')).toEqual([
      row(103, 100, 1, 4)
    ])
  })
})

describe('parseWorkingDirectories', () => {
  it('pairs each process with the file lsof names under it', () => {
    const found = parseWorkingDirectories('p201\nfcwd\nn/ws/anna\np202\nfcwd\nn/\n')
    expect([...found]).toEqual([
      [201, '/ws/anna'],
      [202, '/']
    ])
  })

  it('ignores a name that comes before any process', () => {
    expect(parseWorkingDirectories('n/orphan\n').size).toBe(0)
  })
})

describe('terminal owners', () => {
  it('calls the run script a server and every other session a terminal', () => {
    expect(terminalKind('run')).toBe('server')
    expect(terminalKind('shell')).toBe('terminal')
    expect(terminalKind('setup')).toBe('terminal')
  })

  it('leaves out a session that belongs to no workspace', () => {
    expect(
      terminalOwners([
        { pid: 301, owner: { workspaceId: 'p/anna', purpose: 'run' } },
        { pid: 302, owner: { workspaceId: null, purpose: 'auth' } }
      ])
    ).toEqual([{ pid: 301, workspaceId: 'p/anna', kind: 'server' }])
  })
})

describe('agents', () => {
  const rows = [
    row(ROOT, 1, 1, 1),
    row(201, ROOT, 1, 1),
    row(202, ROOT, 1, 1),
    row(301, ROOT, 1, 1),
    row(401, 201, 1, 1)
  ]

  it('are looked for among the direct children no terminal owns', () => {
    expect(
      agentCandidates(rows, ROOT, [{ pid: 301, workspaceId: 'p/anna', kind: 'terminal' }])
    ).toEqual([201, 202])
  })

  it('belong to the workspace their directory is inside, the deepest one first', () => {
    const owners = agentOwners(
      new Map([
        [201, '/ws/anna/src'],
        [202, '/ws/annabel'],
        [203, '/Applications'],
        [204, '/ws/anna/nested']
      ]),
      [
        { id: 'p/anna', path: '/ws/anna' },
        { id: 'p/nested', path: '/ws/anna/nested' }
      ]
    )
    expect(owners).toEqual([
      { pid: 201, workspaceId: 'p/anna', kind: 'agent' },
      { pid: 204, workspaceId: 'p/nested', kind: 'agent' }
    ])
  })

  it('claim a directory equal to the workspace path', () => {
    expect(agentOwners(new Map([[201, '/ws/anna']]), [{ id: 'p/anna', path: '/ws/anna' }])).toEqual(
      [{ pid: 201, workspaceId: 'p/anna', kind: 'agent' }]
    )
  })
})

describe('measure', () => {
  it('charges each subtree to its owner and the rest to the application', () => {
    const reading = measure(
      [
        row(ROOT, 1, 2, 100),
        row(110, ROOT, 3, 200), // an Electron helper
        row(201, ROOT, 10, 1000), // anna's agent
        row(202, 201, 5, 500), // a tool the agent ran
        row(301, ROOT, 0, 10), // anna's run pty
        row(302, 301, 0, 10), // run.sh
        row(303, 302, 20, 3000), // the server, three levels down
        row(999, 1, 50, 9000) // another application entirely
      ],
      ROOT,
      [
        { pid: 201, workspaceId: 'p/anna', kind: 'agent' },
        { pid: 301, workspaceId: 'p/anna', kind: 'server' }
      ]
    )

    expect(reading.total).toEqual({ cpu: 40, memory: 4820 * 1024 })
    expect(reading.app).toEqual({ cpu: 5, memory: 300 * 1024 })
    expect(reading.parts).toEqual(
      expect.arrayContaining([
        { workspaceId: 'p/anna', kind: 'agent', cpu: 15, memory: 1500 * 1024 },
        { workspaceId: 'p/anna', kind: 'server', cpu: 20, memory: 3020 * 1024 }
      ])
    )
    expect(reading.parts).toHaveLength(2)
  })

  it('reads nothing when the root is not in the table', () => {
    expect(measure([row(5, 1, 1, 1)], ROOT, [])).toEqual({
      total: { cpu: 0, memory: 0 },
      app: { cpu: 0, memory: 0 },
      parts: []
    })
  })
})

describe('readResources', () => {
  const PS = `${String(ROOT)} 1 1 100\n201 ${String(ROOT)} 10 1000\n301 ${String(ROOT)} 2 50\n`

  it('asks ps, then lsof for the candidates only, and attributes both kinds', async () => {
    const calls: string[][] = []
    const exec: ProcessExec = (command, args) => {
      calls.push([command, ...args])
      return Promise.resolve(command === 'ps' ? PS : 'p201\nfcwd\nn/ws/anna\n')
    }

    const reading = await readResources(
      {
        rootPid: ROOT,
        terminals: [{ pid: 301, workspaceId: 'p/anna', kind: 'terminal' }],
        workspaces: [{ id: 'p/anna', path: '/ws/anna' }],
        cores: 1
      },
      exec
    )

    expect(calls[1]).toEqual(['lsof', '-a', '-d', 'cwd', '-Fn', '-p', '201'])
    expect(reading.app).toEqual({ cpu: 1, memory: 100 * 1024 })
    expect(reading.parts).toEqual(
      expect.arrayContaining([
        { workspaceId: 'p/anna', kind: 'agent', cpu: 10, memory: 1000 * 1024 },
        { workspaceId: 'p/anna', kind: 'terminal', cpu: 2, memory: 50 * 1024 }
      ])
    )
  })

  it('keeps the total and charges agents to the application when lsof fails', async () => {
    const exec: ProcessExec = (command) =>
      command === 'ps' ? Promise.resolve(PS) : Promise.reject(new Error('no lsof'))

    const reading = await readResources(
      {
        rootPid: ROOT,
        terminals: [],
        workspaces: [{ id: 'p/anna', path: '/ws/anna' }],
        cores: 1
      },
      exec
    )

    expect(reading.total.cpu).toBe(13)
    expect(reading.app.cpu).toBe(13)
    expect(reading.parts).toEqual([])
  })

  it('does not ask lsof when there is nobody to ask about', async () => {
    const commands: string[] = []
    const exec: ProcessExec = (command) => {
      commands.push(command)
      return Promise.resolve(`${String(ROOT)} 1 1 1\n`)
    }

    await readResources({ rootPid: ROOT, terminals: [], workspaces: [], cores: 1 }, exec)

    expect(commands).toEqual(['ps'])
  })

  // `ps` counts per core: ten cores at 15% each read 150%, which is 15% of the machine.
  it('reads CPU as a share of the whole processor', async () => {
    const exec: ProcessExec = () => Promise.resolve(`${String(ROOT)} 1 150 1\n`)

    const reading = await readResources(
      { rootPid: ROOT, terminals: [], workspaces: [], cores: 10 },
      exec
    )

    expect(reading.total.cpu).toBe(15)
  })

  it('treats a core count below one as one rather than dividing by zero', async () => {
    const exec: ProcessExec = () => Promise.resolve(`${String(ROOT)} 1 40 1\n`)

    const reading = await readResources(
      { rootPid: ROOT, terminals: [], workspaces: [], cores: 0 },
      exec
    )

    expect(reading.total.cpu).toBe(40)
  })
})

describe('defaultProcessExec', () => {
  const node = process.execPath

  it('answers what the command printed', async () => {
    await expect(defaultProcessExec(node, ['-e', 'process.stdout.write("ok")'])).resolves.toBe('ok')
  })

  it('keeps the output of a command that failed after printing it', async () => {
    await expect(
      defaultProcessExec(node, ['-e', 'process.stdout.write("partial"); process.exit(1)'])
    ).resolves.toBe('partial')
  })

  it('fails when the command failed and printed nothing', async () => {
    await expect(defaultProcessExec(node, ['-e', 'process.exit(1)'])).rejects.toThrow()
  })
})
