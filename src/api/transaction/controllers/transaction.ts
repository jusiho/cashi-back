import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::transaction.transaction' as any, ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user;
    ctx.query = {
      ...ctx.query,
      filters: {
        ...(ctx.query.filters as object),
        user: { id: user.id },
      },
    };
    return super.find(ctx);
  },

  async create(ctx) {
    const user = ctx.state.user;
    ctx.request.body.data = {
      ...(ctx.request.body.data as object),
      user: user.id,
      date: (ctx.request.body.data as any)?.date || new Date().toISOString(),
    };
    const response = await super.create(ctx);

    // Update account balance after creating transaction
    const data = ctx.request.body.data as any;
    if (data?.account) {
      await strapi.service('api::account.account').updateBalance(data.account, data.type, data.amount);
    }

    return response;
  },

  async update(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;
    const existing = await strapi.service('api::transaction.transaction').findOne(id, { populate: ['user'] });
    if (!existing || (existing.user as any)?.id !== user.id) {
      return ctx.forbidden('No tienes permiso para modificar esta transacción');
    }
    return super.update(ctx);
  },

  async delete(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;
    const existing = await strapi.service('api::transaction.transaction').findOne(id, { populate: ['user', 'account'] });
    if (!existing || (existing.user as any)?.id !== user.id) {
      return ctx.forbidden('No tienes permiso para eliminar esta transacción');
    }

    // Revert account balance
    if (existing.account) {
      const reverseType = existing.type === 'income' ? 'expense' : 'income';
      await strapi.service('api::account.account').updateBalance(
        (existing.account as any).id,
        reverseType,
        existing.amount
      );
    }

    return super.delete(ctx);
  },

  async stats(ctx) {
    const user = ctx.state.user;
    const { startDate, endDate } = ctx.query as any;
    const data = await strapi.service('api::transaction.transaction').getStats(user.id, startDate, endDate);
    return ctx.send({ data });
  },
}));
