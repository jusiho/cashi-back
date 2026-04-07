import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::transaction.transaction' as any, ({ strapi }) => ({
  async getStats(userId: number, startDate?: string, endDate?: string) {
    const baseFilters: any = { user: { id: userId } };

    if (startDate || endDate) {
      baseFilters.date = {};
      if (startDate) baseFilters.date.$gte = startDate;
      if (endDate) baseFilters.date.$lte = endDate;
    }

    const [incomeTransactions, expenseTransactions, allTransactions] = await Promise.all([
      strapi.entityService.findMany('api::transaction.transaction', {
        filters: { ...baseFilters, type: 'income' },
      }),
      strapi.entityService.findMany('api::transaction.transaction', {
        filters: { ...baseFilters, type: 'expense' },
      }),
      strapi.entityService.findMany('api::transaction.transaction', {
        filters: baseFilters,
        populate: ['category'],
        sort: { date: 'desc' },
        limit: 10,
      }),
    ]);

    const totalIncome = incomeTransactions.reduce((sum, t) => sum + (t.amount as number), 0);
    const totalExpenses = expenseTransactions.reduce((sum, t) => sum + (t.amount as number), 0);
    const netBalance = totalIncome - totalExpenses;

    // Group expenses by category
    const expensesByCategory: Record<string, number> = {};
    expenseTransactions.forEach((t) => {
      const catName = (t as any).category?.name || 'Sin categoría';
      expensesByCategory[catName] = (expensesByCategory[catName] || 0) + (t.amount as number);
    });

    return {
      totalIncome,
      totalExpenses,
      netBalance,
      expensesByCategory,
      recentTransactions: allTransactions,
      transactionCount: incomeTransactions.length + expenseTransactions.length,
    };
  },

  async createFromWhatsApp(userId: number, messageData: {
    amount: number;
    description: string;
    whatsappMessageId: string;
    accountId?: number;
  }) {
    const { amount, description, whatsappMessageId, accountId } = messageData;

    const transaction = await strapi.entityService.create('api::transaction.transaction', {
      data: {
        amount,
        description,
        type: 'expense',
        date: new Date().toISOString(),
        whatsappMessageId,
        user: userId,
        account: accountId,
      },
    });

    if (accountId) {
      await strapi.service('api::account.account').updateBalance(accountId, 'expense', amount);
    }

    return transaction;
  },
}));
