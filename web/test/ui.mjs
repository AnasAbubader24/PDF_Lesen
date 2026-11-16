import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../../server/src/store.js';
import { createApp } from '../../server/src/app.js';

const dir = mkdtempSync(join(tmpdir(), 'lieferklar-ui-'));
const store = new Store(join(dir, 'test.sqlite'));
const server = createApp(store, { filesPath: join(dir, 'files'), webDist: resolve('web/dist') }).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto(base);
  await page.getByText('Demo ohne LLM', { exact: true }).click();
  await page.locator('.review-table tbody tr').first().waitFor();
  assert.equal(store.get().orders[0].lines[0].price, 4.5);
  await page.locator('ui5-checkbox').first().click();
  await page.locator('ui5-checkbox').nth(4).click();
  assert.equal(await page.locator('.review-table .new-value .delivery-date-alert').count(), 5);
  const alertColor = await page.locator('.review-table .delivery-date-alert').first().evaluate(el => getComputedStyle(el).color);
  assert.notEqual(alertColor, await page.locator('.review-table .new-value').first().evaluate(el => getComputedStyle(el).color));
  await page.locator('.workspace-main').getByText('Aktualisieren', { exact: true }).click();
  const dialog = page.locator('ui5-dialog[open]').first();
  await dialog.getByText('Abbrechen', { exact: true }).click();
  assert.equal(store.get().orders[0].lines[0].price, 4.5, 'Cancel must not write');
  await page.locator('.workspace-main').getByText('Aktualisieren', { exact: true }).click();
  await dialog.getByText('Aktualisieren', { exact: true }).click();
  await page.getByText('Ausgewählte Änderungen freigegeben und im Mock-ERP gespeichert.', { exact: true }).waitFor();
  assert.equal(store.get().orders[0].lines[0].price, 4.8);
  assert.equal(store.get().orders[0].lines[4].price, 26.03);
  assert.equal(store.get().orders[0].lines[1].shipDate, '2026-11-18');
  await page.getByText('Aktuellen Datenstand abfragen', { exact: true }).click();
  await page.getByText('Aktueller ERP-Datenstand · v2', { exact: true }).waitFor();
  await page.locator('[ui5-side-navigation-item][data-tab="shortages"]').click();
  await page.getByText('Produktionsverschiebung vorschlagen', { exact: true }).first().click();
  await page.locator('.resolution').getByText('Aktualisieren', { exact: true }).click();
  await page.locator('ui5-message-strip').filter({ hasText: 'Alle Materialbedarfe sind zum benötigten Termin gedeckt.' }).waitFor();
  assert.equal(store.get().production[0].startDate, '2026-11-24');
  await page.locator('[ui5-side-navigation-item][data-tab="erp"]').click();
  await page.getByText('Aktueller ERP-Datenstand · v3', { exact: true }).waitFor();
  // UI5 language selector, including RTL and localized dates.
  await page.locator('.header-controls ui5-select').click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await page.getByText('Latest ERP data state · v3', { exact: true }).waitFor();
  await page.locator('.header-controls ui5-select').click();
  await page.getByRole('option', { name: 'العربية', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  await page.locator('.header-controls ui5-select').click();
  await page.getByRole('option', { name: 'Deutsch', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  assert.ok(dimensions.width <= dimensions.viewport + 1, JSON.stringify(dimensions));
  assert.deepEqual(errors, []);
  // Exercise drag-and-drop without provider calls or writes to ERP data.
  await page.route('**/api/state', async route => {
    const response = await route.fetch();
    const data = await response.json(); data.aiConfigured = true;
    await route.fulfill({ response, json: data });
  });
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.pdf-drop-area[aria-disabled="false"]').waitFor();
  let uploads = 0;
  await page.route('**/api/confirmations', async route => {
    uploads++;
    assert.ok(route.request().postDataBuffer().includes(Buffer.from('drop-test.pdf')));
    await route.fulfill({ json: { duplicate: true, proposal: store.get().proposals[0] } });
  });
  const drop = async name => {
    const transfer = await page.evaluateHandle(name => {
      const data = new DataTransfer(); data.items.add(new File(['%PDF-test'], name, { type: 'application/pdf' })); return data;
    }, name);
    await page.locator('.pdf-drop-area').dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
  };
  await drop('not-a-pdf.txt');
  await page.locator('ui5-message-strip').filter({ hasText: 'Bitte genau eine PDF-Datei ablegen.' }).waitFor();
  assert.equal(uploads, 0);
  const beforeDrop = store.get();
  await drop('drop-test.pdf');
  await page.locator('ui5-message-strip').filter({ hasText: 'Diese Bestätigung wurde bereits importiert.' }).waitFor();
  assert.equal(uploads, 1);
  assert.deepEqual(store.get(), beforeDrop);
  await page.route('**/api/state', async route => {
    const response = await route.fetch();
    const data = await response.json(); data.aiConfigured = true;
    data.proposals[0].rows[1].current.shipDate = '2026-11-10';
    data.proposals[0].rows[1].proposed.shipDate = '2026-11-10';
    await route.fulfill({ response, json: data });
  });
  await page.reload();
  await page.locator('.review-table tbody tr').nth(1).locator('.new-value .delivery-date-alert').waitFor();
  assert.ok(await page.locator('.review-table tbody tr').nth(1).innerText().then(text => text.includes('Überfällig zum Demo-Stichtag')));
  if (process.env.SCREENSHOT_PATH) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  }
  // Optional screenshot location explicitly provided by caller (outside project).
  if (process.env.WORKFLOW_SCREENSHOT_PATH) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[ui5-side-navigation-item][data-tab="workspace"]').click();
    await page.getByText('Neu abgleichen', { exact: true }).click();
    await page.getByText('Aktuellen Datenstand abfragen', { exact: true }).click();
    await page.getByText('Aktueller ERP-Datenstand · v3', { exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: process.env.WORKFLOW_SCREENSHOT_PATH, fullPage: true });
  }
  console.log('UI tests passed: red changed dates, Update/Cancel approval gate, PDF drag-and-drop validation, selected writes, current-state chat, rescheduling, languages, RTL, mobile overflow, no browser errors.');
} catch (error) {
  console.error('UI failure state:', JSON.stringify({ revision: store.get().revision, production: store.get().production, resolutions: store.get().resolutions }));
  console.error('Page text:', (await page.locator('body').innerText()).slice(-8000));
  throw error;
} finally {
  await browser.close(); await new Promise(r => server.close(r)); store.close(); rmSync(dir, { recursive: true, force: true });
}
