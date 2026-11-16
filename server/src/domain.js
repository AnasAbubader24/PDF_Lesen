import { z } from 'zod';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
}, 'Invalid calendar date');
export const extractedSchema = z.object({
  supplier: z.string().min(1),
  orderReference: z.string().min(1),
  confirmationNumber: z.string().min(1),
  confirmationDate: isoDate,
  currency: z.string().length(3),
  lines: z.array(z.object({
    position: z.string(),
    itemCode: z.string().min(1),
    supplierItemCode: z.string(),
    quantity: z.number().positive(),
    unit: z.string().min(1),
    deliveryDate: isoDate,
    netUnitPrice: z.number().nonnegative(),
    evidence: z.string().min(1),
    page: z.number().int().positive()
  })).min(1).max(100)
});

export function seedState() {
  const codes = ['23-002-001129', '23-002-001130', '23-002-001131', '95-004-000001', '20-008-001005'];
  const descriptions = ['Rillenkugellager 6205-2RS', 'Zahnriemen HTD 8M-1200', 'Hydrauliköl HLP 46', 'Sechskantschraube M10×40', 'Näherungsschalter induktiv M12'];
  const quantities = [50, 10, 4, 500, 12];
  const prices = [4.5, 38.5, 85, .12, 27.4];
  const supplierCodes = ['BI-104512', 'BI-220871', 'BI-305540', 'BI-409330', 'BI-512012'];
  return {
    revision: 1,
    asOfDate: '2026-11-12',
    receivingDays: 1,
    orders: [{ id: 'po-4711', reference: 'B-2026-04711', docNum: 4711,
      supplier: 'Beispiel Industriebedarf AG', currency: 'EUR', status: 'open',
      lines: codes.map((itemCode, i) => ({ id: `line-${i + 1}`, position: String((i + 1) * 10), itemCode,
        supplierItemCode: supplierCodes[i], description: descriptions[i], quantity: quantities[i],
        openQuantity: quantities[i], unit: i === 2 ? 'Gebinde' : 'Stk', price: prices[i],
        shipDate: i === 4 ? '2026-11-25' : '2026-11-18', confirmed: false,
        confirmationDate: null, confirmationNumber: null,
        schedules: [{ quantity: quantities[i], date: i === 4 ? '2026-11-25' : '2026-11-18' }]
      })) }],
    inventory: codes.map((itemCode, i) => ({ itemCode, quantity: [10, 2, 1, 800, 0][i] })),
    production: [
      { id: 'prod-100', reference: 'FA-2026-0100', description: 'Montage Antriebseinheit', startDate: '2026-11-20', endDate: '2026-11-23', originalStartDate: '2026-11-20' },
      { id: 'prod-101', reference: 'FA-2026-0101', description: 'Wartung Hydraulikstation', startDate: '2026-11-24', endDate: '2026-11-25', originalStartDate: '2026-11-24' },
      { id: 'prod-102', reference: 'FA-2026-0102', description: 'Montage Ersatzantrieb', startDate: '2026-11-25', endDate: '2026-11-27', originalStartDate: '2026-11-25' }
    ],
    demands: [
      { id: 'd1', productionId: 'prod-100', itemCode: codes[0], quantity: 40, date: '2026-11-20', originalDate: '2026-11-20' },
      { id: 'd2', productionId: 'prod-100', itemCode: codes[1], quantity: 8, date: '2026-11-20', originalDate: '2026-11-20' },
      { id: 'd3', productionId: 'prod-100', itemCode: codes[3], quantity: 300, date: '2026-11-20', originalDate: '2026-11-20' },
      { id: 'd4', productionId: 'prod-101', itemCode: codes[2], quantity: 4, date: '2026-11-24', originalDate: '2026-11-24' },
      { id: 'd5', productionId: 'prod-102', itemCode: codes[0], quantity: 20, date: '2026-11-25', originalDate: '2026-11-25' }
    ],
    proposals: [], resolutions: [], supplierRequests: [], events: [], messages: []
  };
}

export function sampleConfirmation() {
  const s = seedState();
  return {
    supplier: s.orders[0].supplier, orderReference: s.orders[0].reference,
    confirmationNumber: 'AB26/000812', confirmationDate: '2026-11-12', currency: 'EUR',
    lines: s.orders[0].lines.map((l, i) => ({ position: l.position, itemCode: l.itemCode,
      supplierItemCode: l.supplierItemCode, quantity: l.quantity, unit: l.unit,
      deliveryDate: ['2026-11-23', '2026-11-23', '2026-11-27', '2026-11-23', '2026-12-11'][i],
      netUnitPrice: [4.8, 38.5, 89.9, .12, 26.03][i], page: 1,
      evidence: `${l.itemCode}; ${l.quantity} ${l.unit}; ${['23.11.2026', '23.11.2026', '27.11.2026', '23.11.2026', '11.12.2026'][i]}; ${[4.8, 38.5, 89.9, .12, 26.03][i]} EUR netto je Einheit`
    }))
  };
}

export function addDays(s, days) {
  const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
export function fail(code, status = 400) { const e = new Error(code); e.status = status; throw e; }
const norm = s => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

export function matchConfirmation(state, raw, overrides = {}) {
  const data = extractedSchema.parse(raw);
  const orders = state.orders.filter(o => norm(o.reference) === norm(data.orderReference) && norm(o.supplier) === norm(data.supplier) && o.status === 'open');
  if (orders.length !== 1) {
    const referenceMatches = state.orders.filter(o => norm(o.reference) === norm(data.orderReference));
    const supplierMatches = referenceMatches.filter(o => norm(o.supplier) === norm(data.supplier));
    const error = new Error('ORDER_MATCH_FAILED');
    error.status = 400;
    error.matchDetails = {
      reason: !referenceMatches.length ? 'ORDER_REFERENCE_NOT_FOUND' : !supplierMatches.length ? 'ORDER_SUPPLIER_MISMATCH' : !orders.length ? 'ORDER_NOT_OPEN' : 'ORDER_AMBIGUOUS',
      extracted: { orderReference: data.orderReference, supplier: data.supplier },
      availableOrders: state.orders.filter(o => o.status === 'open').map(o => ({ orderReference: o.reference, supplier: o.supplier }))
    };
    throw error;
  }
  const order = orders[0];
  if (order.currency !== data.currency.toUpperCase()) fail('CURRENCY_MISMATCH');
  const used = new Set();
  const rows = data.lines.map((l, i) => {
    let candidates = order.lines.filter(x => x.itemCode === l.itemCode && x.openQuantity > 0);
    if (overrides[i]) candidates = candidates.filter(x => x.id === overrides[i]);
    else if (candidates.length > 1) {
      const byPosition = candidates.filter(x => x.position === l.position);
      if (byPosition.length === 1) candidates = byPosition;
    }
    const line = candidates.length === 1 ? candidates[0] : null;
    const issues = [];
    if (!line) issues.push(candidates.length ? 'AMBIGUOUS_LINE' : 'ITEM_NOT_FOUND');
    if (line && used.has(line.id)) issues.push('DUPLICATE_LINE');
    if (line) {
      used.add(line.id);
      if (norm(line.unit) !== norm(l.unit)) issues.push('UNIT_MISMATCH');
      if (l.quantity > line.openQuantity) issues.push('QUANTITY_EXCEEDS_OPEN');
      if (l.deliveryDate < state.asOfDate) issues.push('PAST_DELIVERY_DATE');
      if (l.supplierItemCode && l.supplierItemCode !== line.supplierItemCode) issues.push('SUPPLIER_ITEM_MISMATCH');
    }
    return { index: i, lineId: line?.id ?? null, candidates: candidates.map(x => ({ id: x.id, position: x.position })),
      description: line?.description ?? l.itemCode, issues,
      current: line ? { shipDate: line.shipDate, price: line.price, confirmed: line.confirmed, confirmationNumber: line.confirmationNumber } : null,
      proposed: { shipDate: l.deliveryDate, price: l.netUnitPrice, confirmed: true, confirmationDate: data.confirmationDate, confirmationNumber: data.confirmationNumber,
        quantity: l.quantity, partial: line ? l.quantity < line.openQuantity : false }
    };
  });
  return { orderId: order.id, rows };
}

export function applyRows(state, proposal, indexes) {
  const order = state.orders.find(o => o.id === proposal.orderId);
  for (const index of indexes) {
    const row = proposal.rows.find(r => r.index === index);
    if (!row || row.issues.length || proposal.approvedIndexes.includes(index) || proposal.rejectedIndexes.includes(index)) fail('INVALID_APPROVAL');
    const line = order.lines.find(l => l.id === row.lineId);
    const p = row.proposed;
    line.price = p.price; line.confirmed = p.confirmed; line.confirmationDate = p.confirmationDate; line.confirmationNumber = p.confirmationNumber;
    // Confirmed partial quantities replace that quantity of the existing schedule;
    // remaining supply retains its prior expected date, never an invented date.
    let remaining = line.openQuantity - p.quantity;
    const remainder = [];
    for (const schedule of [...line.schedules].sort((a, b) => b.date.localeCompare(a.date))) {
      const qty = Math.min(remaining, schedule.quantity);
      if (qty > 0) remainder.push({ quantity: qty, date: schedule.date });
      remaining -= qty;
    }
    line.schedules = [{ quantity: p.quantity, date: p.shipDate }, ...remainder].sort((a, b) => a.date.localeCompare(b.date));
    line.shipDate = line.schedules.at(-1).date;
  }
}

// Allocate each unit once, across chronologically sorted demands. Unfilled earlier
// demand reserves future receipts before a later demand can use them.
export function bottlenecks(state) {
  const receipts = new Map();
  const add = (code, lot) => receipts.set(code, [...(receipts.get(code) ?? []), lot]);
  for (const x of state.inventory) add(x.itemCode, { date: state.asOfDate, quantity: x.quantity, source: 'stock' });
  for (const o of state.orders.filter(o => o.status === 'open')) for (const l of o.lines) for (const r of l.schedules)
    add(l.itemCode, { date: addDays(r.date, state.receivingDays), quantity: r.quantity, source: l.id, orderId: o.id, deliveryDate: r.date });
  for (const lots of receipts.values()) lots.sort((a, b) => a.date.localeCompare(b.date));
  const result = [];
  for (const d of [...state.demands].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    let needed = d.quantity, onTime = 0, earliest = d.date;
    const allocated = [];
    for (const lot of receipts.get(d.itemCode) ?? []) {
      const take = Math.min(needed, lot.quantity);
      if (!take) continue;
      lot.quantity -= take; needed -= take;
      if (lot.date <= d.date) onTime += take;
      if (lot.date > earliest) earliest = lot.date;
      allocated.push({ ...lot, quantity: take });
      if (!needed) break;
    }
    if (onTime < d.quantity) result.push({ demandId: d.id, productionId: d.productionId, itemCode: d.itemCode,
      quantity: d.quantity, shortage: d.quantity - onTime, requiredDate: d.date,
      originalDate: d.originalDate, availableDate: needed ? null : earliest,
      delayDays: needed ? null : daysBetween(d.date, earliest), unfilled: needed, allocated });
  }
  return result;
}

export function reschedulePlan(state, productionId) {
  const production = state.production.find(p => p.id === productionId);
  if (!production) fail('PRODUCTION_NOT_FOUND', 404);
  const simulated = structuredClone(state);
  let target = production.startDate;
  // Moving a demand behind other production can change its allocation. Recompute
  // after every move until the complete production order is material feasible.
  for (let i = 0; i < 100; i++) {
    const shortages = bottlenecks(simulated).filter(x => x.productionId === productionId);
    if (!shortages.length) return { productionId, from: production.startDate, to: target,
      endDate: addDays(production.endDate, daysBetween(production.startDate, target)) };
    if (shortages.some(x => !x.availableDate)) fail('NO_FEASIBLE_SUPPLY');
    const next = shortages.reduce((max, x) => x.availableDate > max ? x.availableDate : max, target);
    if (next <= target) fail('NO_FEASIBLE_SUPPLY');
    const shift = daysBetween(target, next);
    for (const d of simulated.demands.filter(d => d.productionId === productionId)) d.date = addDays(d.date, shift);
    target = next;
  }
  fail('NO_FEASIBLE_SUPPLY');
}
