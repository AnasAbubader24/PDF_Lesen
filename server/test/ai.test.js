import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import PDFDocument from 'pdfkit';
import { extractPDF, answerQuestion } from '../src/ai.js';
import { sampleConfirmation } from '../src/domain.js';

test('real LangChain pipeline renders PDF and uses compatible structured tool output', async () => {
  const received = [];
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); received.push(body);
    const message = body.tools?.length ? {
      role: 'assistant', content: null, tool_calls: [{ id: 'call_demo', type: 'function', function: { name: body.tools[0].function.name, arguments: JSON.stringify(sampleConfirmation()) } }]
    } : { role: 'assistant', content: 'Die Bestellung hat den Datenstand v9.' };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 'mock-provider', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message, finish_reason: body.tools?.length ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  }).listen(0, '127.0.0.1');
  await new Promise(r => provider.once('listening', r));
  const previous = { key: process.env.OPPER_API_KEY, url: process.env.OPPER_BASE_URL };
  process.env.OPPER_API_KEY = 'test-only'; process.env.OPPER_BASE_URL = `http://127.0.0.1:${provider.address().port}/v3/compat`;
  try {
    const doc = new PDFDocument(); const chunks = [];
    const buffer = new Promise(resolve => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); });
    doc.text('Auftragsbestaetigung AB26/000812 B-2026-04711'); doc.text('23-002-001129 50 Stk 23.11.2026 4,80 EUR');
    // Regression: even-odd vector fills must use the same Path2D implementation
    // as the rendering canvas (previously two incompatible native versions).
    doc.rect(50, 180, 160, 60).rect(70, 190, 60, 30).fill('#d9eaff', 'even-odd');
    doc.end();
    const extraction = await extractPDF(await buffer);
    assert.equal(extraction.data.confirmationNumber, 'AB26/000812');
    assert.match(extraction.sourceText, /PAGE 1/);
    const input = received[0].messages.find(m => m.role === 'user');
    assert.ok(input.content.some(x => x.type === 'image_url' && x.image_url.url.startsWith('data:image/png;base64,')));
    assert.ok(received[0].tools.length, 'LangChain sends a structured-output tool schema');
    const answer = await answerQuestion('Letzter Stand?', 'de', { revision: 9 }, []);
    assert.match(answer, /v9/); assert.match(received[1].messages[0].content, /"revision":9/);
    assert.ok(!received[1].tools, 'chat has no mutation tools');
  } finally {
    if (previous.key === undefined) delete process.env.OPPER_API_KEY; else process.env.OPPER_API_KEY = previous.key;
    if (previous.url === undefined) delete process.env.OPPER_BASE_URL; else process.env.OPPER_BASE_URL = previous.url;
    await new Promise(r => provider.close(r));
  }
});
