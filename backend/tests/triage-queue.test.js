import test from 'node:test';
import assert from 'node:assert/strict';

import { createTriageQueue } from '../services/triageQueue.js';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('triage queue processes jobs in order while deduplicating by reportId', async () => {
  const executed = [];
  const queue = createTriageQueue(async ({ reportId }) => {
    executed.push(reportId);
    await wait(10);
  });

  queue.enqueue({ reportId: 'report-1', description: 'first' });
  queue.enqueue({ reportId: 'report-2', description: 'second' });
  queue.enqueue({ reportId: 'report-1', description: 'duplicate update' });

  await queue.whenIdle();

  assert.deepEqual(executed, ['report-1', 'report-2']);
  assert.equal(queue.getPendingCount(), 0);
});

test('triage queue rejects malformed jobs', () => {
  const queue = createTriageQueue(async () => {});
  assert.throws(() => queue.enqueue({ reportId: '' }), /non-empty reportId/);
  assert.throws(() => queue.enqueue(null), /non-empty reportId/);
});
