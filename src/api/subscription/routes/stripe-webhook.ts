/**
 * Public Stripe webhook route — no auth required
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/subscriptions/webhook',
      handler: 'subscription.webhook',
      config: { auth: false, policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/subscriptions/mp-webhook',
      handler: 'subscription.mpWebhook',
      config: { auth: false, policies: [], middlewares: [] },
    },
  ],
};
