import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import PDFDocument from 'pdfkit';
import { seedState, sampleConfirmation, matchConfirmation, applyRows, bottlenecks, reschedulePlan, addDays, daysBetween, fail, extractedSchema, isoDate } from './domain.js';
import { Store, checkRevision, event, message } from './store.js';
import { aiConfigured, extractPDF, answerQuestion } from './ai.js';

const approvalSchema = z.object({ revision: z.number().int(), proposalVersion: z.number().int(), indexes: z.array(z.number().int().nonnegative()).min(1).refine(x => new Set(x).size === x.length), user: z.string().trim().min(1).max(100) });
const actionSchema = z.object({ revision: z.number().int(), user: z.string().trim().min(1).max(100) });
const publicState = s => ({ ...s, bottlenecks: bottlenecks(s), aiConfigured: aiConfigured(), model: process.env.OPPER_MODEL || 'anthropic/claude-sonnet-4-5' });
function proposalById(s, id) { const p = s.proposals.find(x => x.id === id); if (!p) fail('PROPOSAL_NOT_FOUND', 404); return p; }
function pending(p) { return p.rows.filter(x => !p.approvedIndexes.includes(x.index) && !p.rejectedIndexes.includes(x.index)); }
function refreshStatus(p) { p.status = pending(p).length ? 'pending' : p.approvedIndexes.length ? 'applied' : 'rejected'; }

export function createApp(store = new Store(), options = {}) {
  const app = express();
  const files = resolve(options.filesPath || process.env.FILES_PATH || './data/files');
  mkdirSync(files, { recursive: true });
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'], fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameSrc: ["'self'", 'blob:'], objectSrc: ["'none'"], upgradeInsecureRequests: null } } }));
  app.use(express.json({ limit: '1mb' }));
  // Local demo only. Disallow cross-origin mutations, including browser CSRF.
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'CROSS_ORIGIN_BLOCKED' });
      const origin = req.get('origin');
      if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'CROSS_ORIGIN_BLOCKED' });
    }
    next();
  });
  app.get('/api/health', (_, res) => res.json({ ok: true, aiConfigured: aiConfigured() }));
  app.get('/api/state', (_, res) => { res.set('Cache-Control', 'no-store'); res.json(publicState(store.get())); });
  app.get('/api/orders/:id', (req, res) => {
    const s = store.get(); const o = s.orders.find(x => x.id === req.params.id || x.reference === req.params.id);
    if (!o) fail('ORDER_NOT_FOUND', 404); res.json({ revision: s.revision, order: o });
  });
  app.get('/api/files/:id', (req, res) => {
    if (!/^[\da-f-]+$/.test(req.params.id)) fail('FILE_NOT_FOUND', 404);
    const p = resolve(files, `${req.params.id}.pdf`); if (!existsSync(p)) fail('FILE_NOT_FOUND', 404);
    res.set('Content-Type', 'application/pdf').set('Content-Disposition', 'inline'); res.sendFile(p);
  });
  app.get('/api/sample.pdf', (_, res) => {
    res.set('Content-Type', 'application/pdf').set('Content-Disposition', 'inline; filename="Auftragsbestaetigung.pdf"');
    const doc = new PDFDocument({ size: 'A4', margin: 40 }); doc.pipe(res);
    const d = sampleConfirmation();
    doc.fontSize(20).fillColor('#185e57').text('BEISPIEL INDUSTRIEBEDARF AG');
    doc.moveDown().fontSize(10).fillColor('#444').text('MUSTERDOKUMENT - FIKTIVE DATEN - IMPORTTEST');
    doc.moveDown().fontSize(18).fillColor('#185e57').text('Auftragsbestätigung');
    doc.moveDown().fontSize(11).fillColor('#111').text(`Lieferant: ${d.supplier}\nIhre Bestellnummer: ${d.orderReference}\nBestätigungsnr.: ${d.confirmationNumber}\nBelegdatum: 12.11.2026\nWährung: EUR`);
    for (const l of d.lines) {
      doc.moveDown().fontSize(12).fillColor('#185e57').text(`${l.position}  ${seedState().orders[0].lines.find(x => x.itemCode === l.itemCode).description}`);
      doc.fontSize(10).fillColor('#111').text(`Art.-Nr.: ${l.supplierItemCode} | Ihre Artikelnummer: ${l.itemCode}\nMenge: ${l.quantity} ${l.unit} | Lieferdatum: ${l.deliveryDate.split('-').reverse().join('.')}\nPreis netto je Einheit: ${l.netUnitPrice.toFixed(2).replace('.', ',')} EUR | Gesamt: ${(l.quantity * l.netUnitPrice).toFixed(2).replace('.', ',')} EUR`);
      if (l.position === '50') doc.text('Listenpreis 27,40 EUR abzüglich 5 % Rabatt; Nettoeinheitspreis 26,03 EUR.');
    }
    doc.moveDown().text('Nettobetrag: 1.356,96 EUR | USt 19 %: 257,82 EUR | Gesamtbetrag: 1.614,78 EUR');
    doc.end();
  });

  app.get('/api/sample-5-pages.pdf', (_, res) => {
    res.set('Content-Type', 'application/pdf').set('Content-Disposition', 'inline; filename="Auftragsbestaetigung-5-Seiten.pdf"');
    const doc = new PDFDocument({ size: 'A4', margin: 45 }); doc.pipe(res);
    const data = sampleConfirmation();
    const order = seedState().orders[0];
    data.lines.forEach((line, index) => {
      if (index) doc.addPage();
      doc.fontSize(10).fillColor('#556b82').text('MUSTERDOKUMENT - FIKTIVE DATEN - MEHRSEITIGER IMPORTTEST');
      doc.moveDown().fontSize(22).fillColor('#131e29').text('Auftragsbestätigung');
      doc.moveDown().fontSize(12).text(`Lieferant: ${data.supplier}\nIhre Bestellnummer: ${data.orderReference}\nBestätigungsnr.: AB26/000813\nBelegdatum: 12.11.2026\nWährung: EUR\nSeite ${index + 1} von 5`);
      doc.moveDown(2).fontSize(16).text(`Position ${line.position}`);
      doc.moveDown().fontSize(14).text(order.lines[index].description);
      doc.moveDown().fontSize(12).text(`Art.-Nr. des Lieferanten: ${line.supplierItemCode}\nIhre Artikelnummer: ${line.itemCode}\nMenge: ${line.quantity} ${line.unit}\nBestätigtes Lieferdatum: ${line.deliveryDate.split('-').reverse().join('.')}\nPreis netto je Einheit: ${line.netUnitPrice.toFixed(2).replace('.', ',')} EUR\nPositionsbetrag netto: ${(line.quantity * line.netUnitPrice).toFixed(2).replace('.', ',')} EUR`);
      if (index === 4) {
        doc.moveDown().text('Listenpreis 27,40 EUR abzüglich 5 % Rabatt. Nettoeinheitspreis nach Rabatt: 26,03 EUR.');
        doc.moveDown(2).text('Gesamtsummen für alle fünf Seiten:\nNettobetrag: 1.356,96 EUR\nUSt 19 %: 257,82 EUR\nGesamtbetrag: 1.614,78 EUR');
      }
      doc.fontSize(10).fillColor('#556b82').text(`AB26/000813 | ${data.orderReference} | Seite ${index + 1}/5`, 45, 750);
    });
    doc.end();
  });

  function addProposal(data, metadata) {
    return store.transaction(s => {
      const duplicate = s.proposals.find(p => p.hash === metadata.hash || (p.extracted.orderReference === data.orderReference && p.extracted.confirmationNumber === data.confirmationNumber));
      if (duplicate) return { duplicate: true, proposal: duplicate };
      const matched = matchConfirmation(s, data);
      const p = { id: randomUUID(), version: 1, baseRevision: s.revision, status: 'pending', createdAt: new Date().toISOString(), extracted: data,
        approvedIndexes: [], rejectedIndexes: [], ...metadata, ...matched };
      s.proposals.push(p);
      const preview = structuredClone(s);
      const valid = p.rows.filter(r => !r.issues.length).map(r => r.index);
      if (valid.length) applyRows(preview, p, valid);
      p.previewBottlenecks = bottlenecks(preview);
      message(s, 'system', 'PROPOSAL_CREATED', { proposalId: p.id, orderReference: data.orderReference });
      event(s, 'PROPOSAL_CREATED', { proposalId: p.id, mode: metadata.mode });
      return { duplicate: false, proposal: p };
    });
  }
  app.post('/api/demo/confirmation', (_, res) => {
    const data = sampleConfirmation();
    res.json(addProposal(data, { hash: 'seed-confirmation-v1', fileId: null, fileName: 'Demo-Auftragsbestätigung', sourceText: data.lines.map(x => x.evidence).join('\n'), mode: 'fixture' }));
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
  app.post('/api/confirmations', upload.single('file'), async (req, res) => {
    if (!req.file || !req.file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail('INVALID_PDF');
    const hash = createHash('sha256').update(req.file.buffer).digest('hex');
    const existing = store.get().proposals.find(x => x.hash === hash);
    if (existing) return res.json({ duplicate: true, proposal: existing });
    const { data, sourceText } = await extractPDF(req.file.buffer);
    const fileId = randomUUID();
    writeFileSync(resolve(files, `${fileId}.pdf`), req.file.buffer);
    res.json(addProposal(data, { hash, fileId, fileName: req.file.originalname, sourceText, mode: 'llm' }));
  });
  app.put('/api/proposals/:id', (req, res) => {
    const body = z.object({ extracted: extractedSchema, overrides: z.record(z.string(), z.string()).default({}), proposalVersion: z.number().int(), user: z.string().min(1).max(100) }).parse(req.body);
    res.json(store.transaction(s => {
      const p = proposalById(s, req.params.id);
      if (p.version !== body.proposalVersion) fail('STALE_PROPOSAL', 409);
      if (p.approvedIndexes.length || p.rejectedIndexes.length) fail('PROPOSAL_ALREADY_REVIEWED', 409);
      Object.assign(p, matchConfirmation(s, body.extracted, body.overrides));
      p.extracted = body.extracted; p.baseRevision = s.revision; p.version++;
      const preview = structuredClone(s); applyRows(preview, p, p.rows.filter(r => !r.issues.length).map(r => r.index));
      p.previewBottlenecks = bottlenecks(preview);
      event(s, 'PROPOSAL_CORRECTED', { proposalId: p.id, extracted: p.extracted }, body.user);
      message(s, 'system', 'PROPOSAL_CORRECTED', { proposalId: p.id }); return p;
    }));
  });
  app.post('/api/proposals/:id/revalidate', (req, res) => {
    res.json(store.transaction(s => {
      const p = proposalById(s, req.params.id); if (p.status !== 'pending') fail('PROPOSAL_ALREADY_REVIEWED', 409);
      const matched = matchConfirmation(s, p.extracted);
      p.rows = matched.rows; p.baseRevision = s.revision; p.version++;
      const preview = structuredClone(s); applyRows(preview, p, pending(p).filter(r => !r.issues.length).map(r => r.index));
      p.previewBottlenecks = bottlenecks(preview);
      message(s, 'system', 'PROPOSAL_REVALIDATED', { proposalId: p.id }); return p;
    }));
  });
  app.post('/api/proposals/:id/approve', (req, res) => {
    const b = approvalSchema.parse(req.body);
    const result = store.transaction(s => {
      const p = proposalById(s, req.params.id);
      checkRevision(s, b.revision); checkRevision(s, p.baseRevision);
      if (p.version !== b.proposalVersion) fail('STALE_PROPOSAL', 409);
      applyRows(s, p, b.indexes); p.approvedIndexes.push(...b.indexes);
      s.revision++; p.baseRevision = s.revision; p.version++; refreshStatus(p);
      const preview = structuredClone(s);
      applyRows(preview, p, pending(p).filter(r => !r.issues.length).map(r => r.index));
      p.previewBottlenecks = bottlenecks(preview);
      const updated = s.orders.find(o => o.id === p.orderId);
      event(s, 'CONFIRMATION_APPROVED', { proposalId: p.id, indexes: b.indexes,
        approvedValues: p.rows.filter(x => b.indexes.includes(x.index)), orderAfter: structuredClone(updated) }, b.user);
      message(s, 'system', 'CONFIRMATION_APPROVED', { proposalId: p.id, revision: s.revision });
      return { revision: s.revision, order: updated, bottlenecks: bottlenecks(s) };
    });
    res.json(result);
  });
  app.post('/api/proposals/:id/reject', (req, res) => {
    const b = approvalSchema.parse(req.body);
    res.json(store.transaction(s => {
      const p = proposalById(s, req.params.id); if (p.version !== b.proposalVersion) fail('STALE_PROPOSAL', 409);
      for (const i of b.indexes) if (!pending(p).some(r => r.index === i)) fail('INVALID_APPROVAL');
      p.rejectedIndexes.push(...b.indexes); p.version++; refreshStatus(p);
      event(s, 'CONFIRMATION_REJECTED', { proposalId: p.id, indexes: b.indexes }, b.user);
      message(s, 'system', 'CONFIRMATION_REJECTED', { proposalId: p.id }); return p;
    }));
  });
  app.post('/api/resolutions', (req, res) => {
    const b = z.object({ type: z.enum(['reschedule', 'supplier']), productionId: z.string(), demandId: z.string().optional(), user: z.string().min(1).max(100) }).parse(req.body);
    res.json(store.transaction(s => {
      let details;
      if (b.type === 'reschedule') {
        details = reschedulePlan(s, b.productionId);
        if (details.from === details.to) fail('NO_BOTTLENECK');
        const simulated = structuredClone(s); const shift = daysBetween(details.from, details.to);
        const prod = simulated.production.find(p => p.id === b.productionId); prod.startDate = details.to; prod.endDate = details.endDate;
        for (const d of simulated.demands.filter(d => d.productionId === b.productionId)) d.date = addDays(d.date, shift);
        details.bottlenecksAfter = bottlenecks(simulated);
      } else {
        const shortage = bottlenecks(s).find(x => x.demandId === b.demandId && x.productionId === b.productionId);
        if (!shortage) fail('NO_BOTTLENECK');
        const order = s.orders.find(o => o.lines.some(l => l.itemCode === shortage.itemCode));
        const line = order?.lines.find(l => l.itemCode === shortage.itemCode);
        if (!line || shortage.shortage > line.openQuantity) fail('NO_SUPPLIER_SUPPLY');
        details = { orderId: order.id, lineId: line.id, supplier: order.supplier, orderReference: order.reference,
          itemCode: shortage.itemCode, quantity: shortage.shortage,
          requestedDeliveryDate: addDays(shortage.requiredDate, -s.receivingDays),
          draft: `Sehr geehrte Damen und Herren,\nfür unsere Bestellung ${order.reference}, Artikel ${shortage.itemCode}, benötigen wir eine vorgezogene Teillieferung von ${shortage.shortage} ${line.unit} bis zum ${addDays(shortage.requiredDate, -s.receivingDays)}. Bitte bestätigen Sie Menge und Termin.\nMit freundlichen Grüßen\nEinkauf` };
      }
      const p = { id: randomUUID(), type: b.type, status: 'pending', baseRevision: s.revision, createdAt: new Date().toISOString(), details };
      s.resolutions.push(p); event(s, 'RESOLUTION_PROPOSED', p, b.user);
      message(s, 'system', 'RESOLUTION_PROPOSED', { resolutionId: p.id }); return p;
    }));
  });
  app.post('/api/resolutions/:id/approve', (req, res) => {
    const b = actionSchema.parse(req.body);
    res.json(store.transaction(s => {
      const p = s.resolutions.find(x => x.id === req.params.id);
      if (!p) fail('PROPOSAL_NOT_FOUND', 404); if (p.status !== 'pending') fail('PROPOSAL_ALREADY_REVIEWED', 409);
      checkRevision(s, b.revision); checkRevision(s, p.baseRevision);
      if (p.type === 'reschedule') {
        const verified = reschedulePlan(s, p.details.productionId);
        if (verified.to !== p.details.to) fail('STALE_REVISION', 409);
        const prod = s.production.find(x => x.id === p.details.productionId);
        const shift = daysBetween(prod.startDate, p.details.to);
        prod.startDate = p.details.to; prod.endDate = p.details.endDate;
        for (const d of s.demands.filter(x => x.productionId === prod.id)) d.date = addDays(d.date, shift);
      } else s.supplierRequests.push({ id: randomUUID(), ...p.details, status: 'requested', resolutionId: p.id });
      p.status = 'applied'; s.revision++;
      event(s, 'RESOLUTION_APPROVED', p, b.user); message(s, 'system', 'RESOLUTION_APPROVED', { resolutionId: p.id, revision: s.revision });
      return publicState(s);
    }));
  });
  app.post('/api/resolutions/:id/reject', (req, res) => {
    const b = actionSchema.parse(req.body);
    res.json(store.transaction(s => {
      const p = s.resolutions.find(x => x.id === req.params.id);
      if (!p || p.status !== 'pending') fail('PROPOSAL_ALREADY_REVIEWED', 409);
      p.status = 'rejected'; event(s, 'RESOLUTION_REJECTED', p, b.user); return p;
    }));
  });
  // Simulated supplier response is an explicit, separate approval, not an LLM tool.
  app.post('/api/supplier-requests/:id/confirm', (req, res) => {
    const b = actionSchema.extend({ quantity: z.number().positive(), deliveryDate: isoDate }).parse(req.body);
    res.json(store.transaction(s => {
      checkRevision(s, b.revision);
      const request = s.supplierRequests.find(x => x.id === req.params.id);
      if (!request || request.status !== 'requested') fail('REQUEST_NOT_PENDING', 409);
      if (b.quantity > request.quantity || b.deliveryDate < s.asOfDate) fail('INVALID_SUPPLIER_CONFIRMATION');
      const order = s.orders.find(o => o.id === request.orderId); const line = order.lines.find(l => l.id === request.lineId);
      const fake = { orderId: order.id, approvedIndexes: [], rejectedIndexes: [], rows: [{ index: 0, lineId: line.id, issues: [], proposed: { shipDate: b.deliveryDate, price: line.price, confirmed: true, confirmationDate: s.asOfDate, confirmationNumber: `${line.confirmationNumber || 'DEMO'}-TEIL`, quantity: b.quantity } }] };
      applyRows(s, fake, [0]); request.status = 'confirmed'; request.confirmation = { quantity: b.quantity, deliveryDate: b.deliveryDate };
      s.revision++; event(s, 'SUPPLIER_RESPONSE_APPROVED', { request, lineAfter: structuredClone(line) }, b.user);
      message(s, 'system', 'SUPPLIER_RESPONSE_APPROVED', { revision: s.revision }); return publicState(s);
    }));
  });
  app.post('/api/chat', async (req, res) => {
    const b = z.object({ message: z.string().trim().min(1).max(4000), language: z.enum(['de', 'en', 'fr', 'es', 'it', 'pt', 'ar', 'zh']).default('de') }).parse(req.body);
    const snapshot = store.get();
    const grounded = { revision: snapshot.revision, asOfDate: snapshot.asOfDate, receivingDays: snapshot.receivingDays,
      orders: snapshot.orders, inventory: snapshot.inventory, production: snapshot.production, demands: snapshot.demands,
      supplierRequests: snapshot.supplierRequests, bottlenecks: bottlenecks(snapshot),
      pendingProposals: snapshot.proposals.filter(p => p.status === 'pending').map(p => ({ id: p.id, rows: p.rows })) };
    let answer;
    const deterministic = /^(\/state|\/status|\/bestand)$/i.test(b.message);
    if (deterministic || !aiConfigured()) answer = `ERP Revision ${snapshot.revision}\n${JSON.stringify(grounded, null, 2)}`;
    else answer = await answerQuestion(b.message, b.language, grounded, snapshot.messages);
    const m = store.transaction(s => {
      message(s, 'user', b.message); return message(s, 'assistant', answer, { snapshotRevision: snapshot.revision, mode: deterministic || !aiConfigured() ? 'state' : 'llm', snapshot: grounded });
    });
    res.json(m);
  });
  app.post('/api/demo/reset', (req, res) => {
    const b = actionSchema.extend({ confirmation: z.literal('RESET') }).parse(req.body);
    res.json(store.transaction(s => {
      checkRevision(s, b.revision); const next = seedState(); next.revision = s.revision + 1;
      Object.assign(s, next); event(s, 'DEMO_RESET', {}, b.user); return publicState(s);
    }));
  });
  app.post('/api/demo/concurrent-change', (req, res) => {
    const b = actionSchema.parse(req.body);
    res.json(store.transaction(s => {
      checkRevision(s, b.revision); s.orders[0].lines[0].price = +(s.orders[0].lines[0].price + .1).toFixed(2); s.revision++;
      event(s, 'MOCK_CONCURRENT_CHANGE', { lineId: 'line-1', price: s.orders[0].lines[0].price }, b.user); return publicState(s);
    }));
  });
  app.use('/api', (_, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  const webDist = resolve(options.webDist || '../web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('/{*path}', (_, res) => res.sendFile(resolve(webDist, 'index.html')));
  }
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ZodError) return res.status(400).json({ error: 'VALIDATION_FAILED', details: err.issues.map(x => ({ path: x.path, message: x.message })) });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'FILE_TOO_LARGE' });
    if (err.message === 'ORDER_MATCH_FAILED' && err.matchDetails) return res.status(400).json({ error: err.message, matchDetails: err.matchDetails });
    if (err.status && /^[A-Z_]+$/.test(err.message)) return res.status(err.status).json({ error: err.message });
    // Avoid leaking provider responses, credentials, or internal paths.
    console.error('Request failed', req.method, req.path, err.name);
    res.status(502).json({ error: 'REQUEST_FAILED' });
  });
  return app;
}
