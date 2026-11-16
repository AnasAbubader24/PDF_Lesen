import { createApp } from '../server/src/app.js';
import { Store } from '../server/src/store.js';
import { mkdirSync, writeFileSync } from 'node:fs';
const store = new Store(':memory:');
const server = createApp(store).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sample-5-pages.pdf`);
  if (!response.ok) throw new Error('PDF generation failed');
  mkdirSync('test-documents', { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(buffer) });
  try {
    const pdf = await task.promise;
    if (pdf.numPages !== 5) throw new Error(`Expected 5 pages, got ${pdf.numPages}`);
    writeFileSync('test-documents/Auftragsbestaetigung-5-Seiten.pdf', buffer);
    console.log(`Generated and verified: test-documents/Auftragsbestaetigung-5-Seiten.pdf (${pdf.numPages} pages)`);
  } finally { await task.destroy(); }
} finally { await new Promise(r => server.close(r)); store.close(); }
