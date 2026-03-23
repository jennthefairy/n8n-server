import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { serve } from '@hono/node-server';

// ── Hoisted mocks (must be defined before vi.mock calls) ──────────────────────
const mockConstructEvent = vi.hoisted(() => vi.fn());
const mockAirtableFetch  = vi.hoisted(() => vi.fn());
const mockAirtableUpdate = vi.hoisted(() => vi.fn());
const mockAirtableCreate = vi.hoisted(() => vi.fn());
const mockAirtableGet    = vi.hoisted(() => vi.fn());

vi.mock('stripe', () => {
  function MockStripe() {
    // @ts-expect-error mock constructor
    this.webhooks = { constructEventAsync: mockConstructEvent };
  }
  return { default: MockStripe };
});

vi.mock('../lib/airtable.js', () => ({
  airtableFetch:    mockAirtableFetch,
  airtableUpdate:   mockAirtableUpdate,
  airtableCreate:   mockAirtableCreate,
  airtableGetRecord: mockAirtableGet,
  sanitizeParam: (s: string) => s.replace(/['"\\]/g, '').slice(0, 64),
}));

// ── Import app AFTER mocks ────────────────────────────────────────────────────
import app from '../app.js';

// ── Server lifecycle ──────────────────────────────────────────────────────────
let server: ReturnType<typeof serve>;
beforeAll(() => { server = serve({ fetch: app.fetch, port: 0 }); });
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => { vi.clearAllMocks(); });

// ── Helpers ───────────────────────────────────────────────────────────────────
const post = () => request(server).post('/api/webhook/stripe')
  .set('stripe-signature', 'sig_test')
  .set('Content-Type', 'application/json')
  .send('{}');

function mockEvent(type: string, obj: Record<string, unknown> = {}) {
  mockConstructEvent.mockResolvedValueOnce({ type, data: { object: obj } });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/webhook/stripe', () => {

  describe('signature validation', () => {
    it('returns 400 when stripe-signature header is missing', async () => {
      const res = await request(server)
        .post('/api/webhook/stripe')
        .set('Content-Type', 'application/json')
        .send('{}');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/signature/i);
    });

    it('returns 400 when signature is invalid', async () => {
      mockConstructEvent.mockRejectedValueOnce(new Error('No signatures found'));
      const res = await post();
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid signature');
    });
  });

  describe('checkout.session.completed', () => {
    it('updates order capture_status to pending and stores payment_intent_id', async () => {
      mockEvent('checkout.session.completed', {
        id: 'cs_test_123',
        payment_intent: 'pi_test_abc',
      });
      mockAirtableFetch.mockResolvedValueOnce({
        records: [{ id: 'recOrder1', fields: { stripe_session_id: 'cs_test_123' } }],
      });
      mockAirtableUpdate.mockResolvedValueOnce({});

      const res = await post();
      expect(res.status).toBe(200);
      expect(mockAirtableUpdate).toHaveBeenCalledWith('ORDERS', 'recOrder1', {
        capture_status: 'pending',
        payment_intent_id: 'pi_test_abc',
      });
    });

    it('is a no-op when no matching order found', async () => {
      mockEvent('checkout.session.completed', { id: 'cs_unknown', payment_intent: 'pi_x' });
      mockAirtableFetch.mockResolvedValueOnce({ records: [] });

      const res = await post();
      expect(res.status).toBe(200);
      expect(mockAirtableUpdate).not.toHaveBeenCalled();
    });
  });

  describe('payment_intent.amount_capturable_updated', () => {
    it('does NOT update Airtable — purely a log event', async () => {
      mockEvent('payment_intent.amount_capturable_updated', {
        id: 'pi_test_123',
        amount_capturable: 2200,
      });

      const res = await post();
      expect(res.status).toBe(200);
      expect(mockAirtableFetch).not.toHaveBeenCalled();
      expect(mockAirtableUpdate).not.toHaveBeenCalled();
    });
  });

  describe('payment_intent.canceled', () => {
    it('sets order to Released when capture_status is pending', async () => {
      mockEvent('payment_intent.canceled', { id: 'pi_test_cancel' });
      mockAirtableFetch.mockResolvedValueOnce({
        records: [{ id: 'recOrder2', fields: { capture_status: 'pending' } }],
      });
      mockAirtableUpdate.mockResolvedValueOnce({});

      const res = await post();
      expect(res.status).toBe(200);
      expect(mockAirtableUpdate).toHaveBeenCalledWith('ORDERS', 'recOrder2', {
        capture_status: 'cancelled',
        state: 'Released',
      });
    });

    it('is idempotent — skips update if already cancelled', async () => {
      mockEvent('payment_intent.canceled', { id: 'pi_already_done' });
      mockAirtableFetch.mockResolvedValueOnce({
        records: [{ id: 'recOrder3', fields: { capture_status: 'cancelled' } }],
      });

      const res = await post();
      expect(res.status).toBe(200);
      expect(mockAirtableUpdate).not.toHaveBeenCalled();
    });

    it('is a no-op when no matching order found', async () => {
      mockEvent('payment_intent.canceled', { id: 'pi_not_found' });
      mockAirtableFetch.mockResolvedValueOnce({ records: [] });

      const res = await post();
      expect(res.status).toBe(200);
      expect(mockAirtableUpdate).not.toHaveBeenCalled();
    });
  });

  describe('payment_intent.succeeded (referral points)', () => {
    it('awards 10 points when a pending referral exists', async () => {
      mockEvent('payment_intent.succeeded', { id: 'pi_captured' });
      // Fetch order
      mockAirtableFetch.mockResolvedValueOnce({
        records: [{ id: 'recOrder4', fields: { payment_intent_id: 'pi_captured', stripe_session_id: 'cs_ref_123' } }],
      });
      // Fetch referral
      mockAirtableFetch.mockResolvedValueOnce({
        records: [{ id: 'recRef1', fields: { referrer_id: ['recUser1'], status: 'pending' } }],
      });
      // Get referrer user
      mockAirtableGet.mockResolvedValueOnce({ id: 'recUser1', fields: { points_balance: 50 } });
      mockAirtableCreate.mockResolvedValueOnce({});
      mockAirtableUpdate.mockResolvedValue({});

      const res = await post();
      expect(res.status).toBe(200);
      expect(mockAirtableCreate).toHaveBeenCalledWith('POINTS_LEDGER', expect.objectContaining({
        user_id: ['recUser1'],
        delta: 10,
        reason: 'referral_vested',
        ref_id: 'recRef1',
      }));
      expect(mockAirtableUpdate).toHaveBeenCalledWith('REFERRALS', 'recRef1', expect.objectContaining({
        status: 'awarded',
        points_awarded: 10,
      }));
      expect(mockAirtableUpdate).toHaveBeenCalledWith('USERS', 'recUser1', { points_balance: 60 });
    });

    it('skips points if no pending referral exists', async () => {
      mockEvent('payment_intent.succeeded', { id: 'pi_no_ref' });
      mockAirtableFetch.mockResolvedValueOnce({
        records: [{ id: 'recOrder5', fields: { stripe_session_id: 'cs_no_ref' } }],
      });
      mockAirtableFetch.mockResolvedValueOnce({ records: [] });

      const res = await post();
      expect(res.status).toBe(200);
      expect(mockAirtableCreate).not.toHaveBeenCalled();
    });

    it('skips if no matching order', async () => {
      mockEvent('payment_intent.succeeded', { id: 'pi_ghost' });
      mockAirtableFetch.mockResolvedValueOnce({ records: [] });

      const res = await post();
      expect(res.status).toBe(200);
      expect(mockAirtableCreate).not.toHaveBeenCalled();
    });
  });

  it('returns 200 for unknown event types', async () => {
    mockEvent('customer.created', { id: 'cus_123' });
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});
