import { describe, expect, test } from 'vitest'
import {
  classifyPortOwner, diagnose, formatReport, hasFailure, listeningPidsFromNetstat, maskDatabaseUrl,
  modelNames, mysqlContainerState, usesDockerMysql, effectiveDockerStatus, parseDatabaseUrl, parseDockerPs, prefersLoopbackIp, useLoopbackIp,
} from '../../scripts/lib/doctor-core.mjs'

const base = {
  node: '24.14.0', docker: 'running', mysqlState: 'healthy', mysqlReachable: true,
  databaseUrl: 'mysql://knot:pw@127.0.0.1:3306/knot_dev', envFiles: { missing: [] },
  ports: { backend: { port: 3000, owner: 'free' }, frontend: { port: 5173, owner: 'free' }, ai: { port: 8100, owner: 'free' } },
  ollama: { reachable: true, models: ['qwen3:4b-instruct'] }, llm: { configured: true, baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:4b-instruct' },
}

describe('database url helpers', () => {
  test('parses host, port and database without the password', () => {
    expect(parseDatabaseUrl('mysql://knot:s%40crt@127.0.0.1:3307/knot_dev')).toEqual({ user: 'knot', host: '127.0.0.1', port: 3307, database: 'knot_dev' })
    expect(parseDatabaseUrl('not a url')).toBeNull()
  })
  test('masks the password so it can be printed', () => {
    expect(maskDatabaseUrl('mysql://knot:secret@localhost:3306/db')).toBe('mysql://knot:***@localhost:3306/db')
  })
  test('detects and rewrites localhost to the loopback IP only for the host part', () => {
    const url = 'mysql://knot:localhost@localhost:3306/knot_dev'
    expect(prefersLoopbackIp(url)).toBe(true)
    expect(useLoopbackIp(url)).toBe('mysql://knot:localhost@127.0.0.1:3306/knot_dev')
    expect(prefersLoopbackIp('mysql://knot:pw@127.0.0.1:3306/db')).toBe(false)
  })
})

describe('docker state', () => {
  const ps = parseDockerPs('knot_mysql|exited|Exited (255) 2 minutes ago\nknot_mysql_db|exited|Exited (255) 5 weeks ago\n')
  test('parses names, states and status text', () => {
    expect(ps).toHaveLength(2)
    expect(ps[0]).toMatchObject({ name: 'knot_mysql', state: 'exited' })
  })
  test.each([
    [[], 'missing'],
    [[{ name: 'knot_mysql', state: 'exited', status: 'Exited (255)' }], 'stopped'],
    [[{ name: 'knot_mysql', state: 'running', status: 'Up 8 seconds (health: starting)' }], 'starting'],
    [[{ name: 'knot_mysql', state: 'running', status: 'Up 3 minutes (healthy)' }], 'healthy'],
    [[{ name: 'knot_mysql', state: 'running', status: 'Up 3 minutes (unhealthy)' }], 'unhealthy'],
  ])('mysql container state for %j is %s', (rows, expected) => expect(mysqlContainerState(rows)).toBe(expected))
  test('the old knot_mysql_db container is not mistaken for the project container', () => {
    expect(mysqlContainerState([{ name: 'knot_mysql_db', state: 'running', status: 'Up 1 hour (healthy)' }])).toBe('missing')
  })
})

describe('port ownership', () => {
  const netstat = [
    '  TCP    127.0.0.1:8100         0.0.0.0:0              LISTENING       10548',
    '  TCP    127.0.0.1:52471        127.0.0.1:8100         TIME_WAIT       0',
    '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       777',
  ].join('\n')
  test('only the listening process of the asked port is returned', () => {
    expect(listeningPidsFromNetstat(netstat, 8100)).toEqual([10548])
    expect(listeningPidsFromNetstat(netstat, 3000)).toEqual([777])
    expect(listeningPidsFromNetstat(netstat, 5173)).toEqual([])
  })
  test('a listener we did not start is foreign, ours only when every pid is tracked', () => {
    expect(classifyPortOwner([], [1])).toBe('free')
    expect(classifyPortOwner([10548], [1, 2])).toBe('foreign')
    expect(classifyPortOwner([1], [1, 2])).toBe('ours')
    expect(classifyPortOwner([1, 9], [1, 2])).toBe('foreign')
  })
})

describe('diagnose', () => {
  test('a healthy setup has no failures', () => {
    expect(hasFailure(diagnose(base))).toBe(false)
  })
  test('a stopped mysql container says how to start it', () => {
    const items = diagnose({ ...base, mysqlState: 'stopped', mysqlReachable: false })
    expect(hasFailure(items)).toBe(true)
    expect(formatReport(items)).toContain('docker start knot_mysql')
  })
  test('a foreign process on the AI port is a failure that names the pid', () => {
    const items = diagnose({ ...base, ports: { ...base.ports, ai: { port: 8100, owner: 'foreign', pids: [10548] } } })
    expect(formatReport(items)).toContain('PID 10548')
    expect(hasFailure(items)).toBe(true)
  })
  test('localhost in the database url is only a warning with a fix', () => {
    const items = diagnose({ ...base, databaseUrl: 'mysql://knot:pw@localhost:3306/knot_dev' })
    expect(hasFailure(items)).toBe(false)
    expect(formatReport(items)).toContain('--fix')
  })
  test('a missing local model is a warning, not a failure', () => {
    const items = diagnose({ ...base, ollama: { reachable: true, models: [] } })
    expect(hasFailure(items)).toBe(false)
    expect(formatReport(items)).toContain('ollama pull qwen3:4b-instruct')
  })
  test('docker down is reported once and mysql state is not guessed', () => {
    const items = diagnose({ ...base, docker: 'stopped', mysqlState: 'missing', mysqlReachable: false })
    expect(items.filter((i) => /MySQL konteyner/.test(i.text))).toHaveLength(0)
    expect(hasFailure(items)).toBe(true)
  })
  test('an old Node.js is refused', () => {
    expect(hasFailure(diagnose({ ...base, node: '18.19.0' }))).toBe(true)
    expect(hasFailure(diagnose({ ...base, node: '20.18.0' }))).toBe(true)
    expect(hasFailure(diagnose({ ...base, node: '20.19.0' }))).toBe(false)
  })
  test('model list is read from the OpenAI compatible response', () => {
    expect(modelNames({ data: [{ id: 'a' }, { id: 'b' }, {}] })).toEqual(['a', 'b'])
    expect(modelNames(null)).toEqual([])
  })
})

describe('docker is only required when the project manages MySQL with it', () => {
  test('docker setup with a local database uses docker', () => {
    expect(usesDockerMysql({ envDockerExists: true, host: '127.0.0.1' })).toBe(true)
    expect(usesDockerMysql({ envDockerExists: true, host: 'localhost' })).toBe(true)
  })
  test('no .env.docker (own MySQL) or a remote database does not', () => {
    expect(usesDockerMysql({ envDockerExists: false, host: '127.0.0.1' })).toBe(false)
    expect(usesDockerMysql({ envDockerExists: true, host: 'db.example.com' })).toBe(false)
  })
})

describe('effective docker status', () => {
  const base = { dockerStatus: 'stopped', mysqlReachable: false, envDockerExists: true, host: '127.0.0.1' }
  test('docker down and database unreachable is a real problem', () => {
    expect(effectiveDockerStatus(base)).toBe('stopped')
  })
  test('docker down but the database answers means MySQL is provided another way', () => {
    expect(effectiveDockerStatus({ ...base, mysqlReachable: true })).toBe('skipped')
  })
  test('docker running stays running', () => {
    expect(effectiveDockerStatus({ ...base, dockerStatus: 'running' })).toBe('running')
  })
  test('a remote database never needs docker', () => {
    expect(effectiveDockerStatus({ ...base, host: 'db.example.com' })).toBe('skipped')
  })
})
