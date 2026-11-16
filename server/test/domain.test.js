import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, sampleConfirmation, matchConfirmation, bottlenecks, applyRows, reschedulePlan, extractedSchema } from '../src/domain.js';
import { Store } from '../src/store.js';

function proposal(s, data = sampleConfirmation()) { return { ...matchConfirmation(s, data), approvedIndexes: [], rejectedIndexes: [] }; }
test('extraction schema rejects impossible dates and negative prices', () => {
  const d = sampleConfirmation(); d.lines[0].deliveryDate = '2026-02-30';
  assert.throws(() => extractedSchema.parse(d)); d.lines[0].deliveryDate = '2026-11-23'; d.lines[0].netUnitPrice = -1;
  assert.throws(() => extractedSchema.parse(d));
});
test('matching and preview do not mutate ERP state', () => {
  const s = seedState(), before = structuredClone(s); const p = proposal(s);
  assert.equal(p.rows.length, 5); assert.deepEqual(s, before); assert.equal(bottlenecks(s).length, 0);
});
test('failed order matching explains missing reference, supplier mismatch, closed and ambiguous orders without mutations', () => {
  for (const reason of ['ORDER_REFERENCE_NOT_FOUND', 'ORDER_SUPPLIER_MISMATCH', 'ORDER_NOT_OPEN', 'ORDER_AMBIGUOUS']) {
    const s = seedState(), d = sampleConfirmation();
    if (reason === 'ORDER_REFERENCE_NOT_FOUND') d.orderReference = '1288';
    if (reason === 'ORDER_SUPPLIER_MISMATCH') d.supplier = 'Other supplier';
    if (reason === 'ORDER_NOT_OPEN') s.orders[0].status = 'closed';
    if (reason === 'ORDER_AMBIGUOUS') s.orders.push({ ...structuredClone(s.orders[0]), id: 'other-order' });
    const before = structuredClone(s);
    assert.throws(() => matchConfirmation(s, d), e => {
      assert.equal(e.message, 'ORDER_MATCH_FAILED');
      assert.equal(e.matchDetails.reason, reason);
      assert.deepEqual(e.matchDetails.extracted, { orderReference: d.orderReference, supplier: d.supplier });
      assert.deepEqual(e.matchDetails.availableOrders, s.orders.filter(o => o.status === 'open').map(o => ({ orderReference: o.reference, supplier: o.supplier })));
      return true;
    });
    assert.deepEqual(s, before);
  }
});
test('only selected rows change; net discounted price is not discounted twice', () => {
  const s = seedState(), p = proposal(s); applyRows(s, p, [0, 4]);
  assert.equal(s.orders[0].lines[0].price, 4.8); assert.equal(s.orders[0].lines[4].price, 26.03);
  assert.equal(s.orders[0].lines[1].shipDate, '2026-11-18'); assert.equal(s.demands[0].date, '2026-11-20');
});
test('late receipts create shortages while opening stock covers screws', () => {
  const s = seedState(), p = proposal(s); applyRows(s, p, [0, 1, 2, 3, 4]);
  const b = bottlenecks(s); assert.equal(b.length, 3);
  assert.equal(b.find(x => x.demandId === 'd1').shortage, 30);
  assert.equal(b.find(x => x.demandId === 'd1').availableDate, '2026-11-24');
  assert.equal(b.find(x => x.demandId === 'd2').shortage, 6);
  assert.equal(b.find(x => x.demandId === 'd4').shortage, 3);
  assert.ok(!b.some(x => x.demandId === 'd3'));
});
test('a unit of supply is never allocated to two production demands', () => {
  const s = seedState(); s.inventory[0].quantity = 0; s.orders[0].lines[0].schedules = [{ quantity: 50, date: '2026-11-18' }];
  const b = bottlenecks(s); assert.equal(b.find(x => x.demandId === 'd5').unfilled, 10);
});
test('rescheduling moves the full production demand and remains material feasible', () => {
  const s = seedState(), p = proposal(s); applyRows(s, p, [0, 1, 2, 3, 4]);
  const plan = reschedulePlan(s, 'prod-100'); assert.equal(plan.to, '2026-11-24'); assert.equal(plan.endDate, '2026-11-27');
  assert.equal(s.production[0].startDate, '2026-11-20');
});
test('partial confirmations preserve remaining scheduled quantity', () => {
  const s = seedState(), d = sampleConfirmation(); d.lines[0].quantity = 30;
  const p = proposal(s, d); assert.equal(p.rows[0].proposed.partial, true); applyRows(s, p, [0]);
  assert.equal(s.orders[0].lines[0].schedules.reduce((sum, x) => sum + x.quantity, 0), 50);
  assert.deepEqual(s.orders[0].lines[0].schedules, [{ quantity: 20, date: '2026-11-18' }, { quantity: 30, date: '2026-11-23' }]);
});
test('unknown and ambiguous matches block a write; manual assignment resolves ambiguity', () => {
  const s = seedState(); s.orders[0].lines.push({ ...structuredClone(s.orders[0].lines[0]), id: 'line-extra', position: '60' });
  const d = sampleConfirmation(); d.lines[0].position = '999'; let p = proposal(s, d);
  assert.ok(p.rows[0].issues.includes('AMBIGUOUS_LINE')); assert.throws(() => applyRows(s, p, [0]));
  p = { ...matchConfirmation(s, d, { 0: 'line-extra' }), approvedIndexes: [], rejectedIndexes: [] };
  assert.equal(p.rows[0].issues.length, 0); assert.equal(p.rows[0].lineId, 'line-extra');
});
test('failed store transactions roll back all edits', () => {
  const store = new Store(':memory:'); const before = store.get();
  assert.throws(() => store.transaction(s => { s.revision++; throw new Error('fail'); }));
  assert.deepEqual(store.get(), before); store.close();
});
