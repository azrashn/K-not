import { applyCorrections, cleanCorrection, correctionsDigest, CORRECTION_HISTORY_MAX, pushHistory, sha256 } from '../../src/videos/transcript-corrections';

const chunks = [
  { text: 'bfs bir kuyruk kullanir', start_seconds: 0, end_seconds: 5 },
  { text: 'dfs bir yigin kullanir', start_seconds: 5, end_seconds: 10 },
  { text: 'dijkstra negatif agirlik', start_seconds: 10, end_seconds: 15 },
];
const fix = (i: number, text: string, from = chunks[i].text) => ({ chunkIndex: i, originalSha: sha256(from), text });

test('a fix replaces only its chunk and keeps the time and the original for display', () => {
  const r = applyCorrections(chunks, [fix(0, 'BFS bir kuyruk kullanır')]);
  expect(r.chunks[0]).toMatchObject({ index: 0, text: 'BFS bir kuyruk kullanır', corrected: true, original_text: 'bfs bir kuyruk kullanir', start_seconds: 0, end_seconds: 5 });
  expect(r.chunks[1]).toMatchObject({ text: 'dfs bir yigin kullanir', corrected: false });
  expect(r.chunks[1]).not.toHaveProperty('original_text');
  expect(r.stale).toEqual([]);
});

test('after a reprocess changed the engine text the fix is stale and is NOT applied to different words', () => {
  const reprocessed = [{ ...chunks[0], text: 'bfs bir kuyruk kullanır ve seviye gezer' }, chunks[1], chunks[2]];
  const r = applyCorrections(reprocessed, [fix(0, 'BFS bir kuyruk kullanır', chunks[0].text)]);
  expect(r.chunks[0].text).toBe('bfs bir kuyruk kullanır ve seviye gezer');
  expect(r.chunks[0].corrected).toBe(false);
  expect(r.stale).toEqual([0]);
});

test('a fix for a chunk that no longer exists is stale', () => {
  expect(applyCorrections(chunks.slice(0, 1), [fix(2, 'x', chunks[2].text)]).stale).toEqual([2]);
});

test('the digest follows every change to the fixes and ignores their order', () => {
  expect(correctionsDigest([])).toBe('');
  const a = correctionsDigest([{ chunkIndex: 0, text: 'a' }, { chunkIndex: 1, text: 'b' }]);
  expect(correctionsDigest([{ chunkIndex: 1, text: 'b' }, { chunkIndex: 0, text: 'a' }])).toBe(a);
  expect(correctionsDigest([{ chunkIndex: 0, text: 'a2' }, { chunkIndex: 1, text: 'b' }])).not.toBe(a);
  expect(correctionsDigest([{ chunkIndex: 0, text: 'a' }])).not.toBe(a);
});

test('history keeps the newest edits first and is bounded', () => {
  let h: any[] = [];
  for (let i = 0; i < CORRECTION_HISTORY_MAX + 5; i++) h = pushHistory(h, `v${i}`, new Date(2026, 10, 16, 12, i));
  expect(h).toHaveLength(CORRECTION_HISTORY_MAX);
  expect(h[0].text).toBe(`v${CORRECTION_HISTORY_MAX + 4}`);
  expect(pushHistory(undefined, 'x')[0].text).toBe('x');
});

test('input is trimmed and bounded; empty, huge or non-text is refused', () => {
  expect(cleanCorrection('  BFS   bir\n kuyruk ')).toBe('BFS bir kuyruk');
  expect(cleanCorrection('')).toBeNull();
  expect(cleanCorrection('   ')).toBeNull();
  expect(cleanCorrection('a'.repeat(3001))).toBeNull();
  expect(cleanCorrection(42)).toBeNull();
});
