/**
 * Authenticated subscription routes
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/subscriptions/me',
      handler: 'subscription.getMyPlan',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/subscriptions/checkout',
      handler: 'subscription.createCheckout',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/subscriptions/portal',
      handler: 'subscription.createPortal',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/subscriptions/mp/checkout',
      handler: 'subscription.mpCheckout',
      config: { policies: [], middlewares: [] },
    },
  ],
};
