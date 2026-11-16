import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { createApp } from '../src/app.js';

test('full approval, shortage resolution, fresh query and persistence workflow', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lieferklar-test-')); const db = join(dir, 'test.sqlite');
  const store = new Store(db); const app = createApp(store, { filesPath: join(dir, 'files'), webDist: join(dir, 'none') });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (url, body, method = 'POST') => {
    const r = await fetch(base + url, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  const user = 'Test Clerk';
  try {
    const initial = (await call('/state')).data; assert.equal(initial.revision, 1);
    let p = (await call('/demo/confirmation', {})).data.proposal;
    assert.equal((await call('/state')).data.orders[0].lines[0].price, 4.5);
    assert.equal((await call('/demo/confirmation', {})).data.duplicate, true);
    const approve = () => ({ revision: p.baseRevision, proposalVersion: p.version, indexes: [0, 1, 2, 3, 4], user });
    await call('/demo/concurrent-change', { revision: 1, user });
    assert.equal((await call(`/proposals/${p.id}/approve`, approve())).status, 409);
    p = (await call(`/proposals/${p.id}/revalidate`, {})).data;
    const applied = await call(`/proposals/${p.id}/approve`, approve()); assert.equal(applied.status, 200);
    assert.equal(applied.data.bottlenecks.length, 3);
    assert.equal((await call(`/proposals/${p.id}/approve`, approve())).status, 409);
    let s = (await call('/state')).data; assert.equal(s.orders[0].lines[4].price, 26.03);
    const request = (await call('/resolutions', { type: 'supplier', productionId: 'prod-100', demandId: 'd1', user })).data;
    await call(`/resolutions/${request.id}/approve`, { revision: s.revision, user });
    s = (await call('/state')).data; assert.equal(s.bottlenecks.length, 3, 'request is not supply');
    const supplierRequest = s.supplierRequests[0];
    const response = await call(`/supplier-requests/${supplierRequest.id}/confirm`, { revision: s.revision, user, quantity: 30, deliveryDate: '2026-11-19' });
    assert.equal(response.status, 200); assert.ok(!response.data.bottlenecks.some(x => x.demandId === 'd1'));
    const plan = (await call('/resolutions', { type: 'reschedule', productionId: 'prod-100', user })).data;
    s = (await call('/state')).data;
    const moved = await call(`/resolutions/${plan.id}/approve`, { revision: s.revision, user });
    assert.equal(moved.status, 200); assert.equal(moved.data.production[0].startDate, '2026-11-24');
    assert.equal(moved.data.demands[0].originalDate, '2026-11-20');
    const chat = await call('/chat', { message: '/state', language: 'de' }); assert.equal(chat.status, 200);
    assert.equal(chat.data.snapshotRevision, moved.data.revision); assert.match(chat.data.content, /2026-11-24/);
    const secondStore = new Store(db); assert.equal(secondStore.get().revision, moved.data.revision); secondStore.close();
    assert.ok((await call('/state')).data.events.some(e => e.type === 'CONFIRMATION_APPROVED' && e.details.approvedValues.length === 5));
    const pdf = await fetch(base + '/sample.pdf'); assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    const csrf = await fetch(base + '/demo/reset', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(csrf.status, 403);
  } finally {
    await new Promise(r => server.close(r)); store.close(); rmSync(dir, { recursive: true, force: true });
  }
});
