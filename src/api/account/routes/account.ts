import { factories } from '@strapi/strapi';

export default {
  routes: [
    // ── Custom routes (must come before core to avoid conflict) ──
    {
      method: 'GET',
      path: '/accounts/summary',
      handler: 'account.summary',
      config: { policies: [], middlewares: [] },
    },
    // ── Core CRUD routes ──
    {
      method: 'GET',
      path: '/accounts',
      handler: 'account.find',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'GET',
      path: '/accounts/:id',
      handler: 'account.findOne',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/accounts',
      handler: 'account.create',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'PUT',
      path: '/accounts/:id',
      handler: 'account.update',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'DELETE',
      path: '/accounts/:id',
      handler: 'account.delete',
      config: { policies: [], middlewares: [] },
    },
  ],
};
