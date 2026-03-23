import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { serve } from '@hono/node-server';

const mockAirtableFetch  = vi.hoisted(() => vi.fn());
const mockAirtableCreate = vi.hoisted(() => vi.fn());

vi.mock('stripe', () => {
  function MockStripe() { /* no-op */ }
  return { default: MockStripe };
});

vi.mock('../lib/airtable.js', () => ({
  airtableFetch:    mockAirtableFetch,
  airtableCreate:   mockAirtableCreate,
  airtableUpdate:   vi.fn(),
  airtableGetRecord: vi.fn(),
  sanitizeParam: (s: string) => s.replace(/['"\\]/g, '').slice(0, 64),
}));

import app from '../app.js';

let server: ReturnType<typeof serve>;
beforeAll(() => { server = serve({ fetch: app.fetch, port: 0 }); });
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => { vi.clearAllMocks(); });

const post = (body: object) =>
  request(server).post('/api/waitlist').send(body);

describe('POST /api/waitlist', () => {

  describe('validation', () => {
    it('returns 400 for missing email', async () => {
      const res = await post({ username: 'jessica' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it('returns 400 for invalid email format', async () => {
      const res = await post({ email: 'notanemail', username: 'jessica' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it('returns 400 for missing username', async () => {
      const res = await post({ email: 'test@example.com' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/username/i);
    });

    it('returns 404 when creator username does not exist', async () => {
      mockAirtableFetch.mockResolvedValueOnce({ records: [] });
      const res = await post({ email: 'test@example.com', username: 'nobody' });
      expect(res.status).toBe(404);
    });
  });

  describe('success', () => {
    it('creates waitlist entry and returns success', async () => {
      mockAirtableFetch.mockResolvedValueOnce({
        records: [{ id: 'recUser1', fields: { username: 'jessica' } }],
      });
      mockAirtableCreate.mockResolvedValueOnce({});

      const res = await post({ email: 'fan@example.com', username: 'jessica' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(mockAirtableCreate).toHaveBeenCalledWith('WAITLISTS', {
        user_id: ['recUser1'],
        email: 'fan@example.com',
        notified: false,
      });
    });
  });
});
