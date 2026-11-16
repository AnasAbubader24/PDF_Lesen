import { seedState } from './domain.js';

// Explicit demo setup only: never create orders from uploaded confirmations.
export function addTestOrders(state) {
  const template = seedState().orders[0];
  const added = [];
  for (let i = 0; i < 5; i++) {
    const docNum = 4801 + i;
    const reference = `B-2026-${String(docNum).padStart(5, '0')}`;
    if (state.orders.some(order => order.reference === reference)) continue;
    const line = structuredClone(template.lines[i]);
    line.id = `test-line-${docNum}`;
    line.position = '10';
    state.orders.push({
      id: `test-po-${docNum}`, reference, docNum,
      supplier: template.supplier, currency: template.currency, status: 'open',
      lines: [line]
    });
    added.push(reference);
  }
  if (added.length) state.revision++;
  return added;
}
