import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::bank.bank' as any, ({ strapi }) => ({
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
    ctx.request.body.data = {
      ...(ctx.request.body.data as object),
      user: ctx.state.user.id,
    };
    return super.create(ctx);
  },

  async update(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;
    const existing = await strapi.service('api::bank.bank').findOne(id, { populate: ['user'] });
    if (!existing || (existing.user as any)?.id !== user.id) {
      return ctx.forbidden('No tienes permiso para modificar este banco');
    }
    return super.update(ctx);
  },

  async delete(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;
    const existing = await strapi.service('api::bank.bank').findOne(id, { populate: ['user'] });
    if (!existing || (existing.user as any)?.id !== user.id) {
      return ctx.forbidden('No tienes permiso para eliminar este banco');
    }
    return super.delete(ctx);
  },
}));
