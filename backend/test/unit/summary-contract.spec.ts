import { readFileSync } from 'node:fs';
import path from 'node:path';
import { verifiedSummaryItems } from '../../src/knowledge/summary';

// Same file the AI service's pytest checks against its real output (tests/unit/test_summary_contract.py).
const fixture = JSON.parse(readFileSync(path.resolve(__dirname, '../../../ai-service/tests/contract/summary_response.json'), 'utf8'));

test('the backend accepts the exact response the AI service produces', () => {
  const items = verifiedSummaryItems('summary', fixture.response, fixture.sources);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ text: 'Kuyruk FIFO yapısıdır.', source: { id: 's1', location: { kind: 'page', page: 1 } } });
});

test('a response in the model\'s raw shape (points instead of items) is not accepted', () => {
  expect(verifiedSummaryItems('summary', fixture.model_output, fixture.sources)).toEqual([]);
});
