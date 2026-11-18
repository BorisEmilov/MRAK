import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { sqlSales } from './sales.js';

const fake = sqlSales((text) => {
  if (text.includes('FROM users'))
    return Promise.resolve({ rows: [{ accounts: '40', buyers: '10' }] });
  if (text.includes('GROUP BY'))
    return Promise.resolve({ rows: [{ sku: 'full-game', source: 'web', count: '9' }] });
  if (text.includes('UPDATE')) return Promise.resolve({ rows: [{}] });
  if (text.includes('SELECT user_id'))
    return Promise.resolve({ rows: [{ user_id: 'u', name: '<b>x</b>', status: 'pending' }] });
  return Promise.resolve({ rows: [{ count: '1' }] });
});

describe('sales panel', () => {
  it('reports the demo → purchase conversion and escapes names', async () => {
    const app = createApp({ sales: fake });
    const sum = await request(app).get('/v1/sales/summary?days=7');
    expect(sum.body).toMatchObject({
      days: 7,
      accounts: 40,
      buyers: 10,
      conversion: 0.25,
      refunds: 1,
    });
    const page = await request(app).get('/sales');
    expect(page.text).toContain('25.0 %');
    expect(page.text).toContain('&#60;b&#62;x');
    expect(page.text).not.toContain('<b>x</b>');
  });

  it('moderates collector names with a strict body', async () => {
    const app = createApp({ sales: fake });
    const id = '0b9f0c4e-4c1e-4a39-9f5a-2f1f0d6a9b11';
    expect(
      (await request(app).post(`/v1/collector-names/${id}`).send({ status: 'approved' })).status,
    ).toBe(204);
    expect(
      (await request(app).post(`/v1/collector-names/${id}`).send({ status: 'ok' })).status,
    ).toBe(400);
    expect((await request(createApp()).get('/v1/sales/summary')).status).toBe(503);
  });
});
