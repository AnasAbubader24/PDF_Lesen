import PDFDocument from 'pdfkit';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { seedState, sampleConfirmation } from '../server/src/domain.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const folder = 'test-documents/different-orders';
mkdirSync(folder, { recursive: true });
const sample = sampleConfirmation();
const order = seedState().orders[0];
const money = value => value.toFixed(2).replace('.', ',');
for (let i = 0; i < 5; i++) {
  const reference = `B-2026-${String(4801 + i).padStart(5, '0')}`;
  const confirmation = `AB26/${String(901 + i).padStart(6, '0')}`;
  const path = `${folder}/Auftragsbestaetigung-${reference}.pdf`;
  if (existsSync(path)) throw new Error(`File already exists: ${path}`);
  const line = sample.lines[i];
  const total = Math.round(line.quantity * line.netUnitPrice * 100) / 100;
  const tax = Math.round(total * 0.19 * 100) / 100;
  const doc = new PDFDocument({ size: 'A4', margin: 45 });
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.fontSize(10).fillColor('#556b82').text('MUSTERDOKUMENT - FIKTIVE DATEN - EIGENSTÄNDIGER IMPORTTEST');
  doc.moveDown().fontSize(22).fillColor('#131e29').text('Auftragsbestätigung');
  doc.moveDown().fontSize(12).text(`Lieferant: ${sample.supplier}\nIhre Bestellnummer: ${reference}\nBestätigungsnr.: ${confirmation}\nBelegdatum: 12.11.2026\nWährung: EUR`);
  doc.moveDown(2).fontSize(16).text(`Position 10 - ${order.lines[i].description}`);
  doc.moveDown().fontSize(12).text(`Art.-Nr. des Lieferanten: ${line.supplierItemCode}\nIhre Artikelnummer: ${line.itemCode}\nMenge: ${line.quantity} ${line.unit}\nBestätigtes Lieferdatum: ${line.deliveryDate.split('-').reverse().join('.')}\nPreis netto je Einheit: ${money(line.netUnitPrice)} EUR\nPositionsbetrag netto: ${money(total)} EUR`);
  if (i === 4) doc.moveDown().text('Listenpreis 27,40 EUR abzüglich 5 % Rabatt. Nettoeinheitspreis nach Rabatt: 26,03 EUR.');
  doc.moveDown(2).text(`Nettobetrag: ${money(total)} EUR\nUSt 19 %: ${money(tax)} EUR\nGesamtbetrag: ${money(total + tax)} EUR`);
  doc.fontSize(10).fillColor('#556b82').text(`${confirmation} | ${reference} | Seite 1 von 1`, 45, 750);
  doc.end();
  const buffer = await completed;
  const task = getDocument({ data: new Uint8Array(buffer) });
  try {
    const pdf = await task.promise;
    if (pdf.numPages !== 1) throw new Error('Expected one page');
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
    if (!text.includes(reference) || !text.includes(confirmation)) throw new Error('Missing document references');
    writeFileSync(path, buffer);
    console.log(`Verified: ${path} | ${confirmation} | 1 page`);
  } finally { await task.destroy(); }
}
