import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, sampleConfirmation, matchConfirmation, applyRows } from '../src/domain.js';
import { addTestOrders } from '../src/test-orders.js';

test('explicit test setup adds five matching orders without changing existing records or bypassing approval', () => {
  const state = seedState();
  const before = structuredClone(state);
  assert.equal(addTestOrders(state).length, 5);
  assert.equal(state.revision, 2);
  assert.deepEqual(state.orders[0], before.orders[0]);
  for (const key of ['inventory', 'production', 'demands', 'proposals', 'resolutions', 'supplierRequests', 'events', 'messages']) {
    assert.deepEqual(state[key], before[key]);
  }
  const sample = sampleConfirmation();
  for (let i = 0; i < 5; i++) {
    const order = state.orders[i + 1];
    const confirmation = { ...sample, orderReference: order.reference,
      confirmationNumber: `AB26/${String(901 + i).padStart(6, '0')}`,
      lines: [{ ...sample.lines[i], position: '10' }] };
    const snapshot = structuredClone(state);
    const matched = matchConfirmation(state, confirmation);
    assert.equal(matched.orderId, order.id);
    assert.deepEqual(matched.rows[0].issues, []);
    assert.deepEqual(state, snapshot);
    assert.equal(order.lines[0].confirmed, false);
    applyRows(state, { ...matched, approvedIndexes: [], rejectedIndexes: [] }, [0]);
    assert.equal(order.lines[0].confirmationNumber, confirmation.confirmationNumber);
    assert.deepEqual(state.orders[0], before.orders[0]);
  }
  const snapshot = structuredClone(state);
  assert.deepEqual(addTestOrders(state), []);
  assert.deepEqual(state, snapshot);
});
