import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::goal.goal' as any, ({ strapi }) => ({
  async find(ctx) {
    ctx.query = { ...ctx.query, filters: { ...(ctx.query.filters as object), user: { id: ctx.state.user.id } } };
    return super.find(ctx);
  },
  async create(ctx) {
    ctx.request.body.data = { ...(ctx.request.body.data as object), user: ctx.state.user.id };
    return super.create(ctx);
  },
  async update(ctx) {
    const existing = await strapi.service('api::goal.goal' as any).findOne(ctx.params.id, { populate: ['user'] });
    if (!existing || (existing.user as any)?.id !== ctx.state.user.id) return ctx.forbidden();
    return super.update(ctx);
  },
  async delete(ctx) {
    const existing = await strapi.service('api::goal.goal' as any).findOne(ctx.params.id, { populate: ['user'] });
    if (!existing || (existing.user as any)?.id !== ctx.state.user.id) return ctx.forbidden();
    return super.delete(ctx);
  },
}));
