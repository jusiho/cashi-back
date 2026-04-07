/**
 * Subscription service — Stripe integration
 *
 * Manages user subscription plans via Stripe.
 * Plans: free (default) | pro ($9.99/month)
 */

import Stripe = require('stripe');
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';

// Stripe v22 CJS types declare the export as a plain function, not a class constructor.
// Cast to any for instantiation, then cast back to the proper instance type.
type StripeInstance = Stripe.Stripe;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const StripeClass = Stripe as any;

const PLANS = {
  free: { name: 'Free', price: 0 },
  pro:  { name: 'Pro',  price: 9.99 },
};

function getStripe(): StripeInstance {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY env variable');
  return new StripeClass(key, { apiVersion: '2025-03-31.basil' }) as StripeInstance;
}

export default ({ strapi }) => ({

  // ── Queries ───────────────────────────────────────────────────────────────

  async getByUser(userId: number) {
    return strapi.db.query('api::subscription.subscription').findOne({
      where: { user: userId },
    });
  },

  async getOrCreateFree(userId: number) {
    let sub = await this.getByUser(userId);
    if (!sub) {
      sub = await strapi.db.query('api::subscription.subscription').create({
        data: { plan: 'free', status: 'active', user: userId },
      });
    }
    return sub;
  },

  isPro(sub: any): boolean {
    return sub?.plan === 'pro' && sub?.status === 'active';
  },

  // ── Stripe Checkout ───────────────────────────────────────────────────────

  async createCheckoutSession(userId: number, userEmail: string, successUrl: string, cancelUrl: string) {
    const stripe = getStripe();
    const priceId = process.env.STRIPE_PRO_PRICE_ID;
    if (!priceId) throw new Error('Missing STRIPE_PRO_PRICE_ID env variable');

    let sub = await this.getOrCreateFree(userId);

    // Get or create Stripe customer
    let customerId = sub.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { strapiUserId: String(userId) },
      });
      customerId = customer.id;
      await strapi.db.query('api::subscription.subscription').update({
        where: { id: sub.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { strapiUserId: String(userId) },
      subscription_data: {
        metadata: { strapiUserId: String(userId) },
      },
    });

    return { url: session.url };
  },

  // ── Stripe Customer Portal ────────────────────────────────────────────────

  async createPortalSession(userId: number, returnUrl: string) {
    const stripe = getStripe();
    const sub = await this.getByUser(userId);

    if (!sub?.stripeCustomerId) {
      throw new Error('No Stripe customer found for this user');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  },

  // ── Stripe Webhook Handler ────────────────────────────────────────────────

  async handleWebhook(rawBody: string | Buffer, signature: string) {
    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('Missing STRIPE_WEBHOOK_SECRET env variable');

    let event: StripeTypes.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      throw new Error(`Webhook signature verification failed: ${err.message}`);
    }

    strapi.log.info(`[Stripe] Event received: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as StripeTypes.Checkout.Session;
        if (session.mode !== 'subscription') break;

        const userId = parseInt(session.metadata?.strapiUserId || '0', 10);
        if (!userId) break;

        const stripeSubscription = await stripe.subscriptions.retrieve(
          session.subscription as string
        );

        await this._upsertSubscription(userId, {
          plan: 'pro',
          status: 'active',
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: stripeSubscription.id,
          currentPeriodEnd: new Date((stripeSubscription as any).current_period_end * 1000),
        });
        break;
      }

      case 'customer.subscription.updated': {
        const stripeSub = event.data.object as StripeTypes.Subscription;
        const userId = parseInt(stripeSub.metadata?.strapiUserId || '0', 10);
        if (!userId) break;

        const status = this._mapStripeStatus(stripeSub.status);
        await this._upsertSubscription(userId, {
          plan: status === 'active' ? 'pro' : 'free',
          status,
          stripeSubscriptionId: stripeSub.id,
          currentPeriodEnd: new Date((stripeSub as any).current_period_end * 1000),
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object as StripeTypes.Subscription;
        const userId = parseInt(stripeSub.metadata?.strapiUserId || '0', 10);
        if (!userId) break;

        await this._upsertSubscription(userId, {
          plan: 'free',
          status: 'canceled',
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as StripeTypes.Invoice;
        const customerId = invoice.customer as string;

        const sub = await strapi.db.query('api::subscription.subscription').findOne({
          where: { stripeCustomerId: customerId },
        });
        if (sub) {
          await strapi.db.query('api::subscription.subscription').update({
            where: { id: sub.id },
            data: { status: 'past_due' },
          });
        }
        break;
      }
    }
  },

  // ── Private helpers ───────────────────────────────────────────────────────

  async _upsertSubscription(userId: number, data: Record<string, any>) {
    const existing = await this.getByUser(userId);
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

  _mapStripeStatus(stripeStatus: string): string {
    const map: Record<string, string> = {
      active:   'active',
      trialing: 'trialing',
      past_due: 'past_due',
      canceled: 'canceled',
      unpaid:   'past_due',
    };
    return map[stripeStatus] || 'canceled';
  },
});
