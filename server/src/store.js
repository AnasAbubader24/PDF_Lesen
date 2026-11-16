import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { seedState, fail } from './domain.js';

export class Store {
  constructor(path = process.env.DB_PATH || './data/erp.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id=1), body TEXT NOT NULL)');
    if (!this.db.prepare('SELECT id FROM state').get()) this.db.prepare('INSERT INTO state VALUES (1, ?)').run(JSON.stringify(seedState()));
  }
  get() { return JSON.parse(this.db.prepare('SELECT body FROM state WHERE id=1').get().body); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.get(); const result = fn(state);
      this.db.prepare('UPDATE state SET body=? WHERE id=1').run(JSON.stringify(state));
      this.db.exec('COMMIT'); return result;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  close() { this.db.close(); }
}
export function checkRevision(s, revision) { if (s.revision !== revision) fail('STALE_REVISION', 409); }
export function event(s, type, details, user = 'Demo-Sachbearbeitung') {
  s.events.push({ id: randomUUID(), at: new Date().toISOString(), type, user, details, revision: s.revision });
}
export function message(s, role, content, extra = {}) {
  const m = { id: randomUUID(), at: new Date().toISOString(), role, content, ...extra };
  s.messages.push(m); return m;
}
