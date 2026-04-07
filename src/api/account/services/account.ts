import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::account.account' as any, ({ strapi }) => ({
  async updateBalance(accountId: number, type: string, amount: number) {
    const account = await strapi.entityService.findOne('api::account.account', accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);

    let newBalance = account.balance as number;
    if (type === 'income') {
      newBalance += amount;
    } else if (type === 'expense') {
      newBalance -= amount;
    }

    await strapi.entityService.update('api::account.account', accountId, {
      data: { balance: newBalance },
    });
  },

  async getUserAccountsSummary(userId: number) {
    const accounts = await strapi.entityService.findMany('api::account.account', {
      filters: { user: { id: userId }, isActive: true },
      populate: ['bank'],
    });

    const totalBalance = accounts.reduce((sum, acc) => sum + (acc.balance as number), 0);
    const totalCredit = accounts
      .filter((acc) => acc.type === 'credit')
      .reduce((sum, acc) => sum + (acc.balance as number), 0);

    return { accounts, totalBalance, totalCredit, count: accounts.length };
  },
}));
