import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { serve } from '@hono/node-server';

const mockAirtableFetch = vi.hoisted(() => vi.fn());

vi.mock('stripe', () => {
  function MockStripe() { /* no-op */ }
  return { default: MockStripe };
});

vi.mock('../lib/airtable.js', () => ({
  airtableFetch:    mockAirtableFetch,
  airtableCreate:   vi.fn(),
  airtableUpdate:   vi.fn(),
  airtableGetRecord: vi.fn(),
  sanitizeParam: (s: string) => s.replace(/['"\\]/g, '').slice(0, 64),
}));

import app from '../app.js';

let server: ReturnType<typeof serve>;
beforeAll(() => { server = serve({ fetch: app.fetch, port: 0 }); });
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => { vi.clearAllMocks(); });

const user = { id: 'recUser1', fields: { username: 'jessica', first_name: 'Jessica' } };
const campaign = {
  id: 'recCamp1',
  fields: {
    campaign_name: 'Classic Mink Set Drop',
    retail_price: '22.00',
    current_units: 3,
    goal_units: 10,
    status: 'active',
  },
};

describe('GET /:username (bio page)', () => {
  it('returns 404 for unknown username', async () => {
    mockAirtableFetch.mockResolvedValueOnce({ records: [] });
    const res = await request(server).get('/nobody');
    expect(res.status).toBe(404);
    expect(res.text).toContain('404');
  });

  it('renders waitlist page when user has no active campaigns', async () => {
    mockAirtableFetch
      .mockResolvedValueOnce({ records: [user] })   // user lookup
      .mockResolvedValueOnce({ records: [] });        // campaigns lookup
    const res = await request(server).get('/jessica');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Jessica');
    expect(res.text).toContain('Get notified');
  });

  it('renders campaign page when user has one active campaign', async () => {
    mockAirtableFetch
      .mockResolvedValueOnce({ records: [user] })
      .mockResolvedValueOnce({ records: [campaign] });
    const res = await request(server).get('/jessica');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Classic Mink Set Drop');
    expect(res.text).toContain('Pre-Order Now');
  });

  it('sets pf_ref cookie when ?ref= param is present', async () => {
    mockAirtableFetch
      .mockResolvedValueOnce({ records: [user] })
      .mockResolvedValueOnce({ records: [campaign] });
    const res = await request(server).get('/jessica?ref=sarah');
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie']?.toString() ?? '';
    expect(cookie).toContain('pf_ref=sarah');
  });

  it('sanitizes malicious ref param before setting cookie', async () => {
    mockAirtableFetch
      .mockResolvedValueOnce({ records: [user] })
      .mockResolvedValueOnce({ records: [campaign] });
    const res = await request(server).get("/jessica?ref=sarah'hack");
    const cookie = res.headers['set-cookie']?.toString() ?? '';
    expect(cookie).not.toContain("'");
  });
});

describe('GET /:username/:slug (campaign page)', () => {
  it('returns 404 for unknown username', async () => {
    mockAirtableFetch.mockResolvedValueOnce({ records: [] });
    const res = await request(server).get('/nobody/abc12345');
    expect(res.status).toBe(404);
  });

  it('returns 404 when no campaign matches slug', async () => {
    mockAirtableFetch
      .mockResolvedValueOnce({ records: [user] })
      .mockResolvedValueOnce({ records: [] });
    const res = await request(server).get('/jessica/badslug');
    expect(res.status).toBe(404);
  });

  it('renders campaign when slug matches end of record ID', async () => {
    mockAirtableFetch
      .mockResolvedValueOnce({ records: [user] })
      .mockResolvedValueOnce({ records: [campaign] }); // id ends in 'amp1'
    const res = await request(server).get('/jessica/Camp1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Classic Mink Set Drop');
  });

  it('passes ?ref= param to checkout form JS', async () => {
    mockAirtableFetch
      .mockResolvedValueOnce({ records: [user] })
      .mockResolvedValueOnce({ records: [campaign] });
    const res = await request(server).get('/jessica/Camp1?ref=sarah');
    expect(res.status).toBe(200);
    expect(res.text).toContain("referrer: 'sarah'");
  });
});
