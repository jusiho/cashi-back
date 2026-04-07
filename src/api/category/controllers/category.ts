import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::category.category' as any, ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user;
    // Return user's custom categories + default categories
    ctx.query = {
      ...ctx.query,
      filters: {
        $or: [
          { user: { id: user.id } },
          { isDefault: true },
        ],
      },
    };
    return super.find(ctx);
  },

  async create(ctx) {
    ctx.request.body.data = {
      ...(ctx.request.body.data as object),
      user: ctx.state.user.id,
      isDefault: false,
    };
    return super.create(ctx);
  },

  async update(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;
    const existing = await strapi.service('api::category.category').findOne(id);
    if (!existing) return ctx.notFound();
    if (existing.isDefault) return ctx.forbidden('No puedes modificar categorías predeterminadas');
    if ((existing.user as any)?.id !== user.id) return ctx.forbidden('No tienes permiso');
    return super.update(ctx);
  },

  async delete(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;
    const existing = await strapi.service('api::category.category').findOne(id);
    if (!existing) return ctx.notFound();
    if (existing.isDefault) return ctx.forbidden('No puedes eliminar categorías predeterminadas');
    if ((existing.user as any)?.id !== user.id) return ctx.forbidden('No tienes permiso');
    return super.delete(ctx);
  },
}));
