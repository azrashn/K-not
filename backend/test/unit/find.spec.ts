import { findInSegments, fold } from '../../src/knowledge/find';

const segs = [
  { id: 's1', text: 'Genişlik öncelikli arama (BFS) bir kuyruk kullanır.', location: { kind: 'page', page: 1 } },
  { id: 's2', text: 'Işık enerjisi klorofil tarafından yakalanır.  Işık\nönemlidir.', location: { kind: 'page', page: 2 } },
  { id: 's3', text: 'Dijkstra negatif ağırlıkla çalışmaz.', location: { kind: 'video', start_ms: 5000 } },
];

test('case, Turkish diacritics and spacing do not matter', () => {
  expect(fold('Işık İĞÜŞÖÇ')).toBe('isik igusoc');
  expect(findInSegments(segs, 'ISIK').map((h) => h.segment_id)).toEqual(['s2']);
  expect(findInSegments(segs, 'genislik oncelikli')[0].segment_id).toBe('s1');
  expect(findInSegments(segs, 'kuyruk   kullanır')[0].segment_id).toBe('s1');
});

test('every hit keeps its location and counts repeats inside the segment', () => {
  const [hit] = findInSegments(segs, 'ışık');
  expect(hit.location).toEqual({ kind: 'page', page: 2 });
  expect(hit.count).toBe(2);
  expect(findInSegments(segs, 'negatif')[0].location).toEqual({ kind: 'video', start_ms: 5000 });
});

test('the match offsets point at the matched words inside the snippet', () => {
  const [hit] = findInSegments(segs, 'klorofil');
  expect(hit.snippet.slice(hit.match_start, hit.match_end)).toBe('klorofil');
  const long = [{ id: 'l', text: 'a '.repeat(200) + 'Hedef Sözcük burada ' + 'b '.repeat(200), location: null }];
  const [far] = findInSegments(long, 'hedef sözcük');
  expect(far.snippet.startsWith('…') && far.snippet.endsWith('…')).toBe(true);
  expect(far.snippet.slice(far.match_start, far.match_end)).toBe('Hedef Sözcük');
  expect(far.snippet.length).toBeLessThan(200);
});

test('a too short or absent query finds nothing, and results are capped', () => {
  expect(findInSegments(segs, 'a')).toEqual([]);
  expect(findInSegments(segs, '   ')).toEqual([]);
  expect(findInSegments(segs, 'zzzz')).toEqual([]);
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, text: 'kuyruk', location: i }));
  expect(findInSegments(many, 'kuyruk')).toHaveLength(50);
  expect(findInSegments(many, 'kuyruk', 5)).toHaveLength(5);
});
