const load = (env: Record<string, string | undefined>) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
  let mod: typeof import('../../src/common/limits');
  jest.isolateModules(() => { mod = require('../../src/common/limits'); });
  process.env = saved;
  return mod!;
};
const MIB = 1024 * 1024;

test('defaults suit real lecture files: 20 MB study files, 100 MB videos', () => {
  const m = load({ STUDY_FILE_MAX_BYTES: undefined, VIDEO_MAX_BYTES: undefined });
  expect(m.STUDY_FILE_MAX_BYTES).toBe(20 * MIB);
  expect(m.VIDEO_MAX_BYTES).toBe(100 * MIB);
});

test('values from the environment are used inside their safe range', () => {
  const m = load({ STUDY_FILE_MAX_BYTES: String(8 * MIB), VIDEO_MAX_BYTES: String(500 * MIB) });
  expect(m.STUDY_FILE_MAX_BYTES).toBe(8 * MIB);
  expect(m.VIDEO_MAX_BYTES).toBe(500 * MIB);
});

test.each(['abc', '-5', '1.5', '10', String(99999 * MIB), ''])('a bad value %j falls back to the default instead of failing large', (bad) => {
  const m = load({ STUDY_FILE_MAX_BYTES: bad, VIDEO_MAX_BYTES: bad });
  expect(m.STUDY_FILE_MAX_BYTES).toBe(20 * MIB);
  expect(m.VIDEO_MAX_BYTES).toBe(100 * MIB);
});

test('sizes are written in whole megabytes for messages', () => {
  const m = load({});
  expect(m.mbText(20 * MIB)).toBe('20 MB');
  expect(m.mbText(1536 * 1024)).toBe('2 MB');
  expect(m.mbText(10)).toBe('1 MB');
});
