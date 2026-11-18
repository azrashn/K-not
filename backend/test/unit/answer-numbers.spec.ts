import { matchAnswer, parseNumber } from '../../src/learning/answer-match';
import { loadConfig, ConfigError } from '../../src/config/config';

describe('numeric answers in Turkish spelling', () => {
  test.each([
    ['6250000', '6.250.000'],
    ['6250000', '6.250.000 TL'],
    ['1000', '1.000'],
    ['3,5', '3.5'],
    ['3,5', '3,50'],
    ['12345,6', '12.345,6'],
    ['480', '480 km/sa'],
    ['480', '480.'],
    ['-5', '-5'],
    ['33,33', '33,333'],      // more precise than the key, rounds to it
  ])('%s accepts %s', (expected, response) => {
    expect(matchAnswer(expected, response)).not.toBeNull();
  });

  test.each([
    ['6250000', '6.250'],      // 6250 with dot thousands: a different number
    ['6250000', '625.000'],
    ['33,33', '33,3'],         // less precise than the key
    ['480', '480,4'],          // an integer key needs the integer
    ['12', '21'],
    ['5', '-5'],
    ['3', '3-4'],              // an expression is not a number
    ['x+y', 'x-y'],
  ])('%s rejects %s', (expected, response) => {
    expect(matchAnswer(expected, response)).toBeNull();
  });

  test('parseNumber reads one number with an optional unit only', () => {
    expect(parseNumber('25.000.000')).toEqual({ value: 25000000, decimals: 0 });
    expect(parseNumber('1.5')).toEqual({ value: 1.5, decimals: 1 });
    expect(parseNumber('12.345,67 m')).toEqual({ value: 12345.67, decimals: 2 });
    expect(parseNumber('%12')).toEqual({ value: 12, decimals: 0 });
    expect(parseNumber('x+1')).toBeNull();
    expect(parseNumber('1,000,000')).toBeNull();
    expect(parseNumber('3 4')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  test('words still match as before', () => {
    expect(matchAnswer('Kuyruk', 'kuyruk.')).toBe('EQUIVALENT');
    expect(matchAnswer('O(n log n)', 'o(n log n)')).toBe('EXACT');
  });
});

describe('QUIZ_ENGINE setting', () => {
  const env = (extra: Record<string, string> = {}) => ({
    AI_SERVICE_URL: 'http://localhost:8100', DATABASE_URL: 'mysql://x', JWT_SECRET: 'x'.repeat(32), STORAGE_ROOT: '/tmp',
    RAG_INTERNAL_API_TOKEN: 'a'.repeat(16), INGEST_CALLBACK_TOKEN: 'b'.repeat(16), ...extra,
  });
  test('defaults to v2', () => expect(loadConfig(env()).quizEngine).toBe('v2'));
  test('accepts legacy and v2 in any case', () => {
    expect(loadConfig(env({ QUIZ_ENGINE: 'Legacy' })).quizEngine).toBe('legacy');
    expect(loadConfig(env({ QUIZ_ENGINE: ' V2 ' })).quizEngine).toBe('v2');
  });
  test('rejects anything else', () => expect(() => loadConfig(env({ QUIZ_ENGINE: 'v3' }))).toThrow(ConfigError));
});
