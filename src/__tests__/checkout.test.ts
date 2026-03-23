import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { serve } from '@hono/node-server';

const mockAirtableFetch  = vi.hoisted(() => vi.fn());
const mockAirtableCreate = vi.hoisted(() => vi.fn());
const mockAirtableUpdate = vi.hoisted(() => vi.fn());
const mockAirtableGet    = vi.hoisted(() => vi.fn());
const mockFetch          = vi.hoisted(() => vi.fn());

vi.mock('stripe', () => {
  function MockStripe() { /* no-op for non-webhook tests */ }
  return { default: MockStripe };
});

vi.mock('../lib/airtable.js', () => ({
  airtableFetch:    mockAirtableFetch,
  airtableCreate:   mockAirtableCreate,
  airtableUpdate:   mockAirtableUpdate,
  airtableGetRecord: mockAirtableGet,
  sanitizeParam: (s: string) => s.replace(/['"\\]/g, '').slice(0, 64),
}));

// Mock global fetch (used for Stripe checkout session creation)
vi.stubGlobal('fetch', mockFetch);

import app from '../app.js';

let server: ReturnType<typeof serve>;
beforeAll(() => { server = serve({ fetch: app.fetch, port: 0 }); });
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => { vi.clearAllMocks(); });

// ── Fixtures ──────────────────────────────────────────────────────────────────
const campaign = {
  id: 'recCamp1',
  fields: {
    campaign_name: 'Classic Mink Set Drop',
    user_id: ['recUser1'],
    current_units: 3,
    goal_units: 10,
  },
};

const user = {
  id: 'recUser1',
  fields: { username: 'jessica', first_name: 'Jessica' },
};

const stripeSession = {
  id: 'cs_test_abc',
  url: 'https://checkout.stripe.com/pay/cs_test_abc',
};

function setupHappyPath() {
  mockAirtableGet
    .mockResolvedValueOnce(campaign) // campaign lookup
    .mockResolvedValueOnce(user);    // user lookup for username
  mockFetch.mockResolvedValueOnce({
    json: async () => stripeSession,
  } as Response);
  mockAirtableCreate.mockResolvedValueOnce({ records: [{ id: 'recOrder1' }] });
  mockAirtableUpdate.mockResolvedValueOnce({});
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/checkout', () => {

  describe('validation', () => {
    it('returns 400 when campaign_id is missing', async () => {
      const res = await request(server).post('/api/checkout')
        .send({ email: 'a@b.com', amount: 2200 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when email is missing', async () => {
      const res = await request(server).post('/api/checkout')
        .send({ campaign_id: 'recCamp1', amount: 2200 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when amount is missing', async () => {
      const res = await request(server).post('/api/checkout')
        .send({ campaign_id: 'recCamp1', email: 'a@b.com' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when campaign not found', async () => {
      mockAirtableGet.mockResolvedValueOnce(null);
      const res = await request(server).post('/api/checkout')
        .send({ campaign_id: 'recBad', email: 'a@b.com', amount: 2200 });
      expect(res.status).toBe(404);
    });
  });

  describe('successful order', () => {
    it('returns checkout_url on valid request', async () => {
      setupHappyPath();
      const res = await request(server).post('/api/checkout').send({
        campaign_id: 'recCamp1',
        email: 'customer@example.com',
        name: 'Jane',
        amount: 2200,
      });
      expect(res.status).toBe(200);
      expect(res.body.checkout_url).toBe(stripeSession.url);
      expect(res.body.session_id).toBe(stripeSession.id);
    });

    it('creates ORDERS record with campaign_id_text and last_state_change', async () => {
      setupHappyPath();
      await request(server).post('/api/checkout').send({
        campaign_id: 'recCamp1',
        email: 'customer@example.com',
        amount: 2200,
      });
      expect(mockAirtableCreate).toHaveBeenCalledWith('ORDERS', expect.objectContaining({
        campaign_id: ['recCamp1'],
        campaign_id_text: 'recCamp1',
        capture_status: 'pending',
        state: 'Pre-Auth',
      }));
      const orderFields = mockAirtableCreate.mock.calls[0][1];
      expect(orderFields.last_state_change).toBeTruthy();
    });

    it('increments campaign current_units by 1', async () => {
      setupHappyPath();
      await request(server).post('/api/checkout').send({
        campaign_id: 'recCamp1',
        email: 'x@x.com',
        amount: 2200,
      });
      expect(mockAirtableUpdate).toHaveBeenCalledWith('CAMPAIGNS', 'recCamp1', {
        current_units: 4,
      });
    });
  });

  describe('referral', () => {
    it('creates REFERRALS record when valid referrer supplied', async () => {
      setupHappyPath();
      // referrer user lookup (fire-and-forget async, need to flush)
      mockAirtableFetch.mockResolvedValueOnce({
        records: [{ id: 'recReferrer', fields: { username: 'sarah' } }],
      });
      mockAirtableCreate.mockResolvedValue({});

      await request(server).post('/api/checkout').send({
        campaign_id: 'recCamp1',
        email: 'customer@example.com',
        amount: 2200,
        referrer: 'sarah',
      });

      // flush microtasks so fire-and-forget runs
      await new Promise((r) => setImmediate(r));

      const refCall = mockAirtableCreate.mock.calls.find(
        ([table]) => table === 'REFERRALS'
      );
      expect(refCall).toBeTruthy();
      expect(refCall![1]).toMatchObject({
        referrer_id: ['recReferrer'],
        referred_email: 'customer@example.com',
        status: 'pending',
      });
    });

    it('does NOT create REFERRALS on self-referral (same user)', async () => {
      // User IS the referrer — same record ID
      mockAirtableGet
        .mockResolvedValueOnce(campaign)
        .mockResolvedValueOnce({ id: 'recUser1', fields: { username: 'jessica' } });
      mockFetch.mockResolvedValueOnce({ json: async () => stripeSession } as Response);
      mockAirtableCreate.mockResolvedValueOnce({ records: [{ id: 'recO' }] });
      mockAirtableUpdate.mockResolvedValueOnce({});
      mockAirtableFetch.mockResolvedValueOnce({
        records: [{ id: 'recUser1', fields: { username: 'jessica' } }], // same ID
      });

      await request(server).post('/api/checkout').send({
        campaign_id: 'recCamp1',
        email: 'jessica@example.com',
        amount: 2200,
        referrer: 'jessica',
      });
      await new Promise((r) => setImmediate(r));

      const refCall = mockAirtableCreate.mock.calls.find(
        ([table]) => table === 'REFERRALS'
      );
      expect(refCall).toBeUndefined();
    });
  });
});
