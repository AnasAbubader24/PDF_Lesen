import { writeFileSync } from 'node:fs';
import { Store, event } from './store.js';
import { addTestOrders } from './test-orders.js';

const store = new Store();
try {
  const backup = `${process.env.DB_PATH || './data/erp.sqlite'}.before-test-orders-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify(store.get(), null, 2), { flag: 'wx', mode: 0o600 });
  const added = store.transaction(state => {
    const references = addTestOrders(state);
    if (references.length) event(state, 'TEST_ORDERS_ADDED', { references }, 'Demo setup');
    return references;
  });
  console.log(JSON.stringify({ backup, added, revision: store.get().revision }));
} finally { store.close(); }
