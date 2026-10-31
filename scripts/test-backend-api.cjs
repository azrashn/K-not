/** Real MySQL API regression runner. Only a fresh knot_test_w1_<run> schema.
 * AI in the API harness is fake; no existing application data is reset. */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const tag = Date.now().toString(36);
const schema = 'knot_test_w1_' + tag;
const url = new URL('mysql://127.0.0.1:3306');
url.username = 'knot_test_' + tag;
url.password = randomBytes(24).toString('hex');
const inspected = spawnSync('docker', ['inspect', 'knot_mysql'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (inspected.status !== 0) throw new Error('Start Knot Docker database before API tests.');
const container = JSON.parse(inspected.stdout)[0];
const directory = container.Config.Labels?.['com.docker.compose.project.working_dir'];
if (!directory || path.resolve(directory).toLowerCase() !== root.toLowerCase()) {
  throw new Error('Refusing to use a database container belonging to a different repository.');
}
const setup = spawnSync('docker', ['exec', '-i', 'knot_mysql', 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root'], {
  input: `CREATE DATABASE ${schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\nCREATE USER '${url.username}'@'%' IDENTIFIED BY '${url.password}';\nGRANT ALL PRIVILEGES ON ${schema}.* TO '${url.username}'@'%';\n`,
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
if (setup.status !== 0) throw new Error('Isolated API test setup failed; connection details are not printed.');
const child = spawn(process.execPath, ['node_modules/jest/bin/jest.js', '--config', 'jest.config.js',
  '--selectProjects', 'api', '--runInBand', '--forceExit', ...process.argv.slice(2)], {
  cwd: path.join(root, 'backend'), windowsHide: true,
  env: { ...process.env, TEST_DATABASE_PRECREATED: 'true', TEST_DATABASE_RUN_ID: tag,
    TEST_DATABASE_SERVER_URL: url.toString().replace(/\/$/, '') }, stdio: ['ignore', 'pipe', 'pipe'] });
fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
const log = path.join(root, 'logs/backend-api-tests.log'); fs.writeFileSync(log, '');
let output = '', pending = '';
function consume(data) {
  pending += data.toString(); const end = pending.lastIndexOf('\n'); if (end < 0) return;
  const complete = pending.slice(0, end + 1); pending = pending.slice(end + 1);
  const clean = complete.split(url.toString().replace(/\/$/, '')).join('[REDACTED]').split(url.password).join('[REDACTED]');
  output += clean; fs.appendFileSync(log, clean);
}
child.stdout.on('data', consume); child.stderr.on('data', consume);
child.on('error', () => { console.error('API test runner could not start.'); process.exitCode = 1; });
child.on('close', code => {
  consume('\n');
  console.log(output.split('\n').filter(line => /^(PASS |FAIL |Test Suites:|Tests:|Time:|Ran all)/.test(line)).join('\n'));
  console.log('Synthetic test schema retained for inspection:', schema);
  process.exitCode = code ?? 1;
});
