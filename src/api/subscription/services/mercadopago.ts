/**
 * MercadoPago Subscriptions (Preapproval) service
 *
 * Docs: https://www.mercadopago.com.pe/developers/es/reference/subscriptions
 *
 * Flow:
 *   1. createSubscription() → returns init_point URL → redirect user to MP checkout
 *   2. User pays on MP, MP sends webhook to /api/subscriptions/mp-webhook
 *   3. verifyWebhook() validates signature
 *   4. processWebhook() fetches preapproval details and activates Pro plan
 */

import crypto from 'crypto';

const MP_API = 'https://api.mercadopago.com';

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function mpFetch(method: 'GET' | 'POST', path: string, body?: object) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error('Missing MERCADOPAGO_ACCESS_TOKEN env variable');

  const res = await fetch(`${MP_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json() as any;

  if (!res.ok) {
    const msg = data.message || data.error || 'MercadoPago API error';
    throw new Error(`MercadoPago: ${msg} (status ${res.status})`);
  }

  return data;
}

// ─── Service factory ─────────────────────────────────────────────────────────

export default ({ strapi }) => ({

  /**
   * Create a subscription (preapproval) for a user.
   * Returns the init_point URL to redirect the user to MP checkout.
   *
   * If MERCADOPAGO_PLAN_ID is set, uses a pre-created plan.
   * Otherwise, creates a standalone recurring subscription on the fly.
   */
  async createSubscription(userId: number, userEmail: string): Promise<string> {
    const backUrl  = `${process.env.NEXTJS_URL || 'http://localhost:3000'}/pricing/success`;
    const planId   = process.env.MERCADOPAGO_PLAN_ID;
    const amount   = parseFloat(process.env.MP_PRO_AMOUNT   || '9.99');
    const currency = process.env.MP_PRO_CURRENCY || 'USD';

    let payload: any;

    if (planId) {
      // Use a pre-created plan (recommended for production)
      payload = {
        preapproval_plan_id: planId,
        payer_email: userEmail,
        back_url: backUrl,
        external_reference: String(userId),
        status: 'pending',
      };
    } else {
      // Standalone subscription (good for testing)
      payload = {
        reason: 'Cashi Pro — Suscripción mensual',
        auto_recurring: {
          frequency:          1,
          frequency_type:     'months',
          transaction_amount: amount,
          currency_id:        currency,
        },
        payer_email:        userEmail,
        back_url:           backUrl,
        external_reference: String(userId),
        status:             'pending',
      };
    }

    const data = await mpFetch('POST', '/preapproval', payload);

    // Save the preapproval ID for future reference
    await this._saveMPId(userId, data.id);

    return data.init_point as string;
  },

  /**
   * Verify the MP webhook X-Signature header.
   * Returns the notification id from the query params if valid.
   */
  verifyWebhook(
    xSignature: string,
    xRequestId: string,
    notificationId: string,
    ts: string
  ): void {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!secret) throw new Error('Missing MERCADOPAGO_WEBHOOK_SECRET env variable');

    // MP signs: "id:{notificationId};request-id:{xRequestId};ts:{ts}"
    const manifest = `id:${notificationId};request-id:${xRequestId};ts:${ts}`;
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

    // Extract v1 hash from "ts=xxx,v1=yyy"
    const v1Match = xSignature.match(/v1=([a-f0-9]+)/);
    const received = v1Match?.[1] ?? '';

    if (expected !== received) {
      throw new Error('Invalid MercadoPago webhook signature');
    }
  },

  /**
   * Process a validated webhook notification.
   * Fetches the preapproval details and updates the subscription in DB.
   */
  async processWebhook(preapprovalId: string): Promise<void> {
    const data = await mpFetch('GET', `/preapproval/${preapprovalId}`);

    const userId = parseInt(data.external_reference || '0', 10);
    if (!userId) {
      strapi.log.warn(`[MP] Webhook: no external_reference in preapproval ${preapprovalId}`);
      return;
    }

    const status = this._mapMPStatus(data.status);
    const plan   = status === 'active' ? 'pro' : 'free';

    let periodEnd: Date | null = null;
    if (data.auto_recurring?.end_date) {
      periodEnd = new Date(data.auto_recurring.end_date);
    } else if (status === 'active') {
      periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    await this._upsert(userId, {
      plan,
      status,
      paymentProvider: 'mercadopago',
      providerToken: preapprovalId,
      currentPeriodEnd: periodEnd,
    });

    strapi.log.info(`[MP] User ${userId}: plan=${plan} status=${status}`);
  },

  // ── Private ─────────────────────────────────────────────────────────────────

  async _saveMPId(userId: number, preapprovalId: string) {
    const existing = await strapi.db.query('api::subscription.subscription').findOne({
      where: { user: userId },
    });
    if (existing) {
      await strapi.db.query('api::subscription.subscription').update({
        where: { id: existing.id },
        data: { providerToken: preapprovalId, paymentProvider: 'mercadopago' },
      });
    }
  },

  async _upsert(userId: number, data: Record<string, any>) {
    const existing = await strapi.db.query('api::subscription.subscription').findOne({
      where: { user: userId },
    });
    if (existing) {
      return strapi.db.query('api::subscription.subscription').update({
        where: { id: existing.id },
        data,
      });
    }
    return strapi.db.query('api::subscription.subscription').create({
      data: { ...data, user: userId },
    });
  },

  _mapMPStatus(mpStatus: string): string {
    const map: Record<string, string> = {
      authorized: 'active',
      paused:     'canceled',
      cancelled:  'canceled',
      pending:    'active',   // pending = awaiting first payment, treat as active
    };
    return map[mpStatus] ?? 'canceled';
  },
});
