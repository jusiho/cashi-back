/**
 * Subscription controller
 *
 * GET  /api/subscriptions/me        → current user's plan
 * POST /api/subscriptions/checkout  → create Stripe checkout session
 * POST /api/subscriptions/portal    → create Stripe customer portal session
 * POST /api/subscriptions/webhook   → Stripe webhook (public)
 */

import type { Core } from '@strapi/strapi';

declare const strapi: Core.Strapi;

const NEXTJS_URL = process.env.NEXTJS_URL || 'http://localhost:3000';

export default {
  /**
   * GET /api/subscriptions/me
   * Returns the current user's subscription plan info.
   */
  async getMyPlan(ctx) {
    const userId: number = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized();

    const service = strapi.service('api::subscription.subscription');
    const sub = await service.getOrCreateFree(userId);

    ctx.body = {
      plan: sub.plan,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      isPro: service.isPro(sub),
    };
  },

  /**
   * POST /api/subscriptions/checkout
   * Creates a Stripe Checkout session and returns the redirect URL.
   */
  async createCheckout(ctx) {
    const userId: number = ctx.state.user?.id;
    const userEmail: string = ctx.state.user?.email;
    if (!userId) return ctx.unauthorized();

    const service = strapi.service('api::subscription.subscription');
    const sub = await service.getOrCreateFree(userId);

    if (service.isPro(sub)) {
      return ctx.badRequest('Already on Pro plan');
    }

    const { url } = await service.createCheckoutSession(
      userId,
      userEmail,
      `${NEXTJS_URL}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      `${NEXTJS_URL}/pricing`
    );

    ctx.body = { url };
  },

  /**
   * POST /api/subscriptions/portal
   * Creates a Stripe Billing Portal session for managing/canceling subscriptions.
   */
  async createPortal(ctx) {
    const userId: number = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized();

    const { url } = await strapi
      .service('api::subscription.subscription')
      .createPortalSession(userId, `${NEXTJS_URL}/pricing`);

    ctx.body = { url };
  },

  /**
   * POST /api/subscriptions/webhook
   * Receives Stripe webhook events (public, verified by signature).
   */
  async webhook(ctx) {
    const signature = ctx.request.headers['stripe-signature'] as string;
    if (!signature) {
      ctx.status = 400;
      ctx.body = 'Missing stripe-signature header';
      return;
    }

    // Raw body needed for Stripe signature verification
    const rawBody =
      (ctx.request.body as any)[Symbol.for('unparsedBody')] ??
      JSON.stringify(ctx.request.body);

    try {
      await strapi.service('api::subscription.subscription').handleWebhook(rawBody, signature);
      ctx.status = 200;
      ctx.body = { received: true };
    } catch (err) {
      strapi.log.error('[Stripe] Webhook error:', err.message);
      ctx.status = 400;
      ctx.body = err.message;
    }
  },

  /**
   * POST /api/subscriptions/mp/checkout
   * Creates a MercadoPago subscription and returns the checkout URL.
   */
  async mpCheckout(ctx) {
    const userId: number = ctx.state.user?.id;
    const userEmail: string = ctx.state.user?.email;
    if (!userId) return ctx.unauthorized();

    const subService = strapi.service('api::subscription.subscription');
    const sub = await subService.getOrCreateFree(userId);

    if (subService.isPro(sub)) {
      return ctx.badRequest('Already on Pro plan');
    }

    const url = await strapi
      .service('api::subscription.mercadopago')
      .createSubscription(userId, userEmail);

    ctx.body = { url };
  },

  /**
   * POST /api/subscriptions/mp-webhook
   * Receives MercadoPago subscription notifications — public endpoint.
   */
  async mpWebhook(ctx) {
    ctx.status = 200;
    ctx.body = 'OK';

    const body        = ctx.request.body as any;
    const xSignature  = ctx.request.headers['x-signature']  as string || '';
    const xRequestId  = ctx.request.headers['x-request-id'] as string || '';

    // Only process subscription events
    if (body?.type !== 'subscription_preapproval' || !body?.data?.id) {
      return;
    }

    const preapprovalId  = body.data.id as string;
    const notificationId = body.id ? String(body.id) : preapprovalId;

    // Extract ts from x-signature header ("ts=xxx,v1=yyy")
    const tsMatch = xSignature.match(/ts=(\d+)/);
    const ts      = tsMatch?.[1] ?? '';

    const mpService = strapi.service('api::subscription.mercadopago');

    try {
      if (xSignature && ts) {
        mpService.verifyWebhook(xSignature, xRequestId, notificationId, ts);
      }
      await mpService.processWebhook(preapprovalId);
    } catch (err) {
      strapi.log.error('[MP] Webhook error:', err.message);
    }
  },
};
