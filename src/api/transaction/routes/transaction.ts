import { factories } from '@strapi/strapi';

export default {
  routes: [
    // ── Custom routes (must come before core to avoid conflict) ──
    {
      method: 'GET',
      path: '/transactions/stats',
      handler: 'transaction.stats',
      config: { policies: [], middlewares: [] },
    },
    // ── Core CRUD routes ──
    {
      method: 'GET',
      path: '/transactions',
      handler: 'transaction.find',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'GET',
      path: '/transactions/:id',
      handler: 'transaction.findOne',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/transactions',
      handler: 'transaction.create',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'PUT',
      path: '/transactions/:id',
      handler: 'transaction.update',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'DELETE',
      path: '/transactions/:id',
      handler: 'transaction.delete',
      config: { policies: [], middlewares: [] },
    },
  ],
};
