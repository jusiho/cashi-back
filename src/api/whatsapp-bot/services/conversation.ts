/**
 * WhatsApp Conversation State Machine
 *
 * States:
 *   INIT              → First contact, show welcome + register/login buttons
 *   REGISTER_NAME     → Waiting for user to type their name
 *   REGISTER_EMAIL    → Waiting for user to type their email
 *   REGISTER_CURRENCY → Waiting for currency selection (list)
 *   MAIN_MENU         → Authenticated main menu
 *   EXPENSE_AMOUNT    → Waiting for expense amount (text)
 *   EXPENSE_CATEGORY  → Waiting for category selection (buttons/list)
 *   EXPENSE_ACCOUNT   → Waiting for account selection (buttons/list)
 *   EXPENSE_NOTES     → Waiting for description text (type "no" to skip)
 *   INCOME_AMOUNT     → Waiting for income amount (text)
 *   INCOME_CATEGORY   → Waiting for category selection (buttons/list)
 *   INCOME_ACCOUNT    → Waiting for account selection (buttons/list)
 *   INCOME_NOTES      → Waiting for description text (type "no" to skip)
 */

import sender from './sender';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedMessage {
  type: 'text' | 'button_reply' | 'list_reply' | 'unknown';
  text: string;      // populated when type === 'text'
  buttonId: string;  // populated when type === 'button_reply' | 'list_reply'
}

interface SessionData {
  name?: string;
  email?: string;
  currency?: string;
  amount?: number;
  categoryId?: number;
  categoryName?: string;
  accountId?: number;
  accountName?: string;
  transactionType?: 'expense' | 'income';
  advisorHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// ─── Default seed data ───────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  { name: 'Comida',          icon: '🍕', color: '#EF4444', type: 'expense' },
  { name: 'Transporte',      icon: '🚗', color: '#3B82F6', type: 'expense' },
  { name: 'Salud',           icon: '🏥', color: '#10B981', type: 'expense' },
  { name: 'Entretenimiento', icon: '🎮', color: '#8B5CF6', type: 'expense' },
  { name: 'Ropa',            icon: '👕', color: '#F59E0B', type: 'expense' },
  { name: 'Hogar',           icon: '🏠', color: '#6B7280', type: 'expense' },
  { name: 'Salario',         icon: '💼', color: '#10B981', type: 'income'  },
  { name: 'Freelance',       icon: '💻', color: '#3B82F6', type: 'income'  },
  { name: 'Inversiones',     icon: '📈', color: '#8B5CF6', type: 'income'  },
];

const CURRENCIES = [
  { id: 'cur_USD', title: '🇺🇸 Dólar (USD)',      description: 'United States Dollar' },
  { id: 'cur_EUR', title: '🇪🇺 Euro (EUR)',         description: 'Euro' },
  { id: 'cur_PEN', title: '🇵🇪 Sol (PEN)',          description: 'Nuevo Sol Peruano' },
  { id: 'cur_COP', title: '🇨🇴 Peso (COP)',         description: 'Peso Colombiano' },
  { id: 'cur_MXN', title: '🇲🇽 Peso (MXN)',         description: 'Peso Mexicano' },
  { id: 'cur_ARS', title: '🇦🇷 Peso (ARS)',         description: 'Peso Argentino' },
  { id: 'cur_BRL', title: '🇧🇷 Real (BRL)',         description: 'Real Brasileño' },
  { id: 'cur_CLP', title: '🇨🇱 Peso (CLP)',         description: 'Peso Chileno' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseAmount(text: string): number | null {
  const normalized = text.trim().replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const value = parseFloat(normalized);
  return isNaN(value) || value <= 0 ? null : value;
}

function isSkip(text: string): boolean {
  return ['no', 'n', 'skip', 'saltar', '-'].includes(text.trim().toLowerCase());
}

// ─── Service factory ─────────────────────────────────────────────────────────

export default ({ strapi }) => {

  // ── DB helpers ─────────────────────────────────────────────────────────────

  async function getSession(phoneNumber: string) {
    return strapi.db.query('api::whatsapp-bot.whatsapp-session').findOne({
      where: { phoneNumber },
      populate: ['user'],
    });
  }

  async function createSession(phoneNumber: string) {
    return strapi.db.query('api::whatsapp-bot.whatsapp-session').create({
      data: {
        phoneNumber,
        state: 'INIT',
        sessionData: {},
        lastActivity: new Date(),
      },
    });
  }

  async function updateSession(
    sessionId: number,
    data: { state?: string; sessionData?: SessionData; user?: number }
  ) {
    return strapi.db.query('api::whatsapp-bot.whatsapp-session').update({
      where: { id: sessionId },
      data: { ...data, lastActivity: new Date() },
    });
  }

  async function getUserAccounts(userId: number) {
    return strapi.db.query('api::account.account').findMany({
      where: { user: userId, isActive: true },
      limit: 10,
    });
  }

  async function getUserCategories(userId: number, type: 'expense' | 'income') {
    return strapi.db.query('api::category.category').findMany({
      where: { user: userId, type: { $in: [type, 'both'] } },
      limit: 10,
    });
  }

  async function seedUserData(userId: number, currency: string) {
    // Default categories
    const existing = await strapi.db.query('api::category.category').count({ where: { user: userId } });
    if (existing === 0) {
      for (const cat of DEFAULT_CATEGORIES) {
        await strapi.db.query('api::category.category').create({
          data: { ...cat, isDefault: true, user: userId },
        });
      }
    }

    // Default cash account
    const accountCount = await strapi.db.query('api::account.account').count({ where: { user: userId } });
    if (accountCount === 0) {
      await strapi.db.query('api::account.account').create({
        data: {
          name: 'Efectivo',
          type: 'cash',
          balance: 0,
          currency,
          color: '#10B981',
          isActive: true,
          user: userId,
        },
      });
    }
  }

  // ── Message senders ────────────────────────────────────────────────────────

  async function sendWelcome(phoneNumber: string) {
    await sender.sendButtons(
      phoneNumber,
      '👋 ¡Hola! Soy *Cashi* 💰\n\nTu asistente de finanzas personales por WhatsApp.\n\n¿Qué deseas hacer?',
      [
        { id: 'btn_register', title: '🆕 Registrarme' },
        { id: 'btn_login',    title: '🔐 Ya tengo cuenta' },
      ]
    );
  }

  async function sendMainMenu(phoneNumber: string, name: string) {
    await sender.sendButtons(
      phoneNumber,
      `💰 *Cashi* — ¿Qué deseas hacer, ${name}?`,
      [
        { id: 'btn_expense', title: '💸 Gasto'    },
        { id: 'btn_income',  title: '💰 Ingreso'  },
        { id: 'btn_advisor', title: '🤖 Asesor IA' },
      ]
    );
  }

  async function sendCategorySelection(
    phoneNumber: string,
    categories: any[],
    type: 'expense' | 'income',
    amount: number,
    currency: string
  ) {
    const emoji = type === 'expense' ? '💸' : '💰';
    const header = `${emoji} Monto: *${amount.toFixed(2)} ${currency}*\n\n¿En qué categoría?`;

    if (categories.length <= 3) {
      await sender.sendButtons(
        phoneNumber,
        header,
        categories.map((c) => ({ id: `cat_${c.id}`, title: `${c.icon || '📂'} ${c.name}` }))
      );
    } else {
      await sender.sendList(phoneNumber, header, 'Ver categorías', [
        {
          title: 'Categorías',
          rows: categories.map((c) => ({ id: `cat_${c.id}`, title: `${c.icon || '📂'} ${c.name}` })),
        },
      ]);
    }
  }

  async function sendAccountSelection(
    phoneNumber: string,
    accounts: any[],
    categoryName: string
  ) {
    const header = `📂 Categoría: *${categoryName}*\n\n¿Desde qué cuenta?`;

    if (accounts.length <= 3) {
      await sender.sendButtons(
        phoneNumber,
        header,
        accounts.map((a) => ({ id: `acc_${a.id}`, title: a.name }))
      );
    } else {
      await sender.sendList(phoneNumber, header, 'Ver cuentas', [
        {
          title: 'Cuentas',
          rows: accounts.map((a) => ({
            id: `acc_${a.id}`,
            title: a.name,
            description: `${a.currency || 'USD'} ${(a.balance || 0).toFixed(2)}`,
          })),
        },
      ]);
    }
  }

  // ── State handlers ─────────────────────────────────────────────────────────

  async function handleInit(
    session: any,
    phoneNumber: string,
    input: string,
    msgType: string
  ) {
    // If session already has a linked user, go straight to main menu
    if (session.user) {
      await updateSession(session.id, { state: 'MAIN_MENU' });
      await sendMainMenu(phoneNumber, session.user.username);
      return;
    }

    if (input === 'btn_register') {
      await updateSession(session.id, { state: 'REGISTER_NAME' });
      await sender.sendText(phoneNumber, '¿Cuál es tu nombre? ✍️');
      return;
    }

    if (input === 'btn_login') {
      await sender.sendText(
        phoneNumber,
        '❌ No encontramos una cuenta con este número.\n\n¿Deseas registrarte?'
      );
      await sendWelcome(phoneNumber);
      return;
    }

    // First contact or any other message → show welcome
    await sendWelcome(phoneNumber);
  }

  async function handleRegisterName(session: any, phoneNumber: string, name: string) {
    name = name.trim();
    if (name.length < 2) {
      await sender.sendText(phoneNumber, 'Por favor ingresa un nombre válido (mínimo 2 caracteres):');
      return;
    }

    const data: SessionData = { ...session.sessionData, name };
    await updateSession(session.id, { state: 'REGISTER_EMAIL', sessionData: data });

    await sender.sendText(
      phoneNumber,
      `¡Hola *${name}*! 😊\n\n¿Cuál es tu correo electrónico?\n\nEjemplo: _correo@gmail.com_`
    );
  }

  async function handleRegisterEmail(session: any, phoneNumber: string, email: string) {
    email = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      await sender.sendText(
        phoneNumber,
        '❌ Correo inválido. Por favor ingresa un correo válido:\n\nEjemplo: _correo@gmail.com_'
      );
      return;
    }

    // Check if email already exists
    const existing = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { email } });

    if (existing) {
      await sender.sendText(
        phoneNumber,
        `❌ El correo *${email}* ya está registrado.\n\nIngresa otro correo o escribe *cancelar* para volver al inicio.`
      );
      return;
    }

    const data: SessionData = { ...session.sessionData, email };
    await updateSession(session.id, { state: 'REGISTER_CURRENCY', sessionData: data });

    await sender.sendList(
      phoneNumber,
      `✅ Correo guardado.\n\n¿Cuál es tu moneda principal?`,
      'Seleccionar moneda',
      [{ title: 'Monedas disponibles', rows: CURRENCIES }]
    );
  }

  async function handleRegisterCurrency(session: any, phoneNumber: string, buttonId: string) {
    if (!buttonId.startsWith('cur_')) {
      await sender.sendText(phoneNumber, 'Por favor selecciona una moneda de la lista.');
      return;
    }

    const currency = buttonId.replace('cur_', '');
    const data: SessionData = { ...session.sessionData, currency };
    const name = data.name || 'Usuario';

    // Create Strapi user
    let user: any;
    try {
      const role = await strapi.db
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'authenticated' } });

      user = await strapi.plugin('users-permissions').service('user').add({
        username: name,
        email: data.email || `wa_${phoneNumber}@cashi.app`,
        password: Math.random().toString(36).substring(2, 10) + 'Aa1!',
        provider: 'local',
        confirmed: true,
        blocked: false,
        role: role?.id,
      });
    } catch (err) {
      strapi.log.error('[WhatsApp] Error creating user:', err);
      await sender.sendText(
        phoneNumber,
        '❌ Hubo un error al crear tu cuenta. Por favor escribe *hola* para intentar de nuevo.'
      );
      return;
    }

    await seedUserData(user.id, currency);

    await updateSession(session.id, {
      state: 'MAIN_MENU',
      sessionData: data,
      user: user.id,
    });

    await sender.sendText(
      phoneNumber,
      `🎉 *¡Cuenta creada exitosamente!*\n\nBienvenido a *Cashi*, ${name}! 🎊\n\nYa puedes gestionar tus finanzas desde WhatsApp.`
    );
    await sendMainMenu(phoneNumber, name);
  }

  async function handleMainMenu(session: any, phoneNumber: string, input: string) {
    const name = session.user?.username || 'Usuario';
    const txType = input === 'btn_expense' ? 'expense' : input === 'btn_income' ? 'income' : null;

    if (txType) {
      const emoji = txType === 'expense' ? '💸' : '💰';
      const label = txType === 'expense' ? 'Gasto' : 'Ingreso';
      const newState = txType === 'expense' ? 'EXPENSE_AMOUNT' : 'INCOME_AMOUNT';

      await updateSession(session.id, {
        state: newState,
        sessionData: { ...session.sessionData, transactionType: txType },
      });

      await sender.sendText(
        phoneNumber,
        `${emoji} *Registrar ${label}*\n\n¿Cuánto ${txType === 'expense' ? 'gastaste' : 'recibiste'}?\n\nEscribe el monto (ej: *50.00*)`
      );
      return;
    }

    if (input === 'btn_advisor') {
      // Check if user has Pro plan
      const subService = strapi.service('api::subscription.subscription');
      const sub = await subService.getOrCreateFree(session.user.id);

      if (!subService.isPro(sub)) {
        await sender.sendButtons(
          phoneNumber,
          `🔒 *El Asesor IA es exclusivo del plan Pro*\n\nActualiza tu plan en la app web para acceder a:\n• Asesor financiero IA\n• Transacciones ilimitadas\n• Reportes avanzados\n• Exportar CSV`,
          [{ id: 'btn_expense', title: '💸 Registrar gasto' }]
        );
        return;
      }

      await updateSession(session.id, {
        state: 'ADVISOR',
        sessionData: { ...session.sessionData, advisorHistory: [] },
      });
      await sender.sendText(
        phoneNumber,
        `🤖 *Asesor Financiero Cashi*\n\n¡Hola ${name}! Soy tu asesor financiero personal.\n\nPuedes preguntarme cualquier cosa sobre tus finanzas:\n• _"¿cómo voy este mes?"_\n• _"¿en qué gasto más?"_\n• _"¿puedo ahorrar más?"_\n\nEscribe *salir* para volver al menú.`
      );
      return;
    }

    // Unknown text input → try AI parsing
    if (input && input.length > 1) {
      await handleAIMessage(session, phoneNumber, input);
      return;
    }

    await sendMainMenu(phoneNumber, name);
  }

  async function handleAdvisor(session: any, phoneNumber: string, userMessage: string) {
    const name = session.user?.username || 'Usuario';

    // Exit commands
    if (['salir', 'volver', 'menu', 'menú', 'exit'].includes(userMessage.trim().toLowerCase())) {
      await updateSession(session.id, {
        state: 'MAIN_MENU',
        sessionData: { ...session.sessionData, advisorHistory: [] },
      });
      await sender.sendText(phoneNumber, '👋 Volviendo al menú principal...');
      await sendMainMenu(phoneNumber, name);
      return;
    }

    await sender.sendText(phoneNumber, '🤔 _Analizando..._');

    // Build financial context
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [accounts, categories, recentTx, monthTx] = await Promise.all([
      getUserAccounts(session.user.id),
      strapi.db.query('api::category.category').findMany({
        where: { user: session.user.id },
        limit: 20,
      }),
      strapi.db.query('api::transaction.transaction').findMany({
        where: { user: session.user.id },
        orderBy: { date: 'desc' },
        limit: 10,
        populate: ['category', 'account'],
      }),
      strapi.db.query('api::transaction.transaction').findMany({
        where: { user: session.user.id, date: { $gte: startOfMonth } },
        limit: 200,
      }),
    ]);

    const monthlyExpenses = monthTx
      .filter((t: any) => t.type === 'expense')
      .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

    const monthlyIncome = monthTx
      .filter((t: any) => t.type === 'income')
      .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

    const context = {
      name,
      accounts: accounts.map((a: any) => ({
        name: a.name,
        balance: a.balance || 0,
        currency: a.currency || 'USD',
      })),
      categories: categories.map((c: any) => ({ name: c.name, type: c.type })),
      recentTransactions: recentTx.map((t: any) => ({
        type: t.type,
        amount: t.amount || 0,
        category: t.category?.name || 'Sin categoría',
        date: new Date(t.date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
      })),
      monthlyExpenses,
      monthlyIncome,
    };

    // Get conversation history from session
    const history: Array<{ role: 'user' | 'assistant'; content: string }> =
      session.sessionData?.advisorHistory || [];

    const aiService = strapi.service('api::whatsapp-bot.ai');
    const response = await aiService.askAdvisor(userMessage, context, history);

    // Update history (keep last 10 messages)
    const updatedHistory = [
      ...history,
      { role: 'user' as const, content: userMessage },
      { role: 'assistant' as const, content: response },
    ].slice(-10);

    await updateSession(session.id, {
      sessionData: { ...session.sessionData, advisorHistory: updatedHistory },
    });

    await sender.sendText(phoneNumber, response);
    await sender.sendText(phoneNumber, '_Escribe *salir* para volver al menú principal._');
  }

  async function handleAIMessage(session: any, phoneNumber: string, userMessage: string) {
    const name = session.user?.username || 'Usuario';

    // Build context for the AI
    const [accounts, categories] = await Promise.all([
      getUserAccounts(session.user.id),
      strapi.db.query('api::category.category').findMany({
        where: { user: session.user.id },
        limit: 20,
      }),
    ]);

    const context = {
      name,
      accounts: accounts.map((a: any) => ({
        name: a.name,
        balance: a.balance || 0,
        currency: a.currency || 'USD',
      })),
      categories: categories.map((c: any) => ({ name: c.name, type: c.type })),
    };

    await sender.sendText(phoneNumber, '🤔 _Procesando..._');

    const aiService = strapi.service('api::whatsapp-bot.ai');
    const intent = await aiService.parseIntent(userMessage, context);

    switch (intent.intent) {
      case 'register_expense':
      case 'register_income': {
        const txType = intent.intent === 'register_expense' ? 'expense' : 'income';

        if (!intent.amount) {
          // AI understood the type but no amount — start normal flow
          await updateSession(session.id, {
            state: txType === 'expense' ? 'EXPENSE_AMOUNT' : 'INCOME_AMOUNT',
            sessionData: { ...session.sessionData, transactionType: txType },
          });
          const emoji = txType === 'expense' ? '💸' : '💰';
          await sender.sendText(phoneNumber, `${emoji} ¿Cuánto ${txType === 'expense' ? 'gastaste' : 'recibiste'}?`);
          return;
        }

        // AI got amount — find matching category and account
        const matchedCategory = intent.category_name
          ? categories.find((c: any) =>
              c.name.toLowerCase().includes(intent.category_name!.toLowerCase()) ||
              intent.category_name!.toLowerCase().includes(c.name.toLowerCase())
            )
          : null;

        const matchedAccount = intent.account_name
          ? accounts.find((a: any) =>
              a.name.toLowerCase().includes(intent.account_name!.toLowerCase()) ||
              intent.account_name!.toLowerCase().includes(a.name.toLowerCase())
            )
          : accounts[0]; // default to first account

        if (!matchedAccount) {
          await sender.sendText(phoneNumber, '❌ No tienes cuentas registradas.');
          await sendMainMenu(phoneNumber, name);
          return;
        }

        // Save transaction data and ask for confirmation or missing info
        const data = {
          ...session.sessionData,
          transactionType: txType,
          amount: intent.amount,
          categoryId: matchedCategory?.id || null,
          categoryName: matchedCategory?.name || intent.category_name || 'Sin categoría',
          accountId: matchedAccount.id,
          accountName: matchedAccount.name,
        };

        if (!matchedCategory) {
          // Ask for category
          await updateSession(session.id, {
            state: txType === 'expense' ? 'EXPENSE_CATEGORY' : 'INCOME_CATEGORY',
            sessionData: data,
          });
          const typeFilter = txType as 'expense' | 'income';
          const filteredCats = categories.filter(
            (c: any) => c.type === typeFilter || c.type === 'both'
          );
          await sendCategorySelection(
            phoneNumber,
            filteredCats,
            typeFilter,
            intent.amount,
            matchedAccount.currency || 'USD'
          );
          return;
        }

        // All data ready — save directly
        try {
          await strapi.db.query('api::transaction.transaction').create({
            data: {
              amount: intent.amount,
              type: txType,
              description: intent.description || userMessage,
              date: new Date(),
              account: matchedAccount.id,
              category: matchedCategory?.id,
              user: session.user.id,
              whatsappMessageId: `wa_ai_${Date.now()}`,
            },
          });

          const balanceDelta = txType === 'expense' ? -intent.amount : intent.amount;
          const newBalance = (matchedAccount.balance || 0) + balanceDelta;
          await strapi.db.query('api::account.account').update({
            where: { id: matchedAccount.id },
            data: { balance: newBalance },
          });

          const sign = txType === 'expense' ? '-' : '+';
          const emoji = txType === 'expense' ? '💸' : '💰';
          const currency = matchedAccount.currency || 'USD';

          await sender.sendText(
            phoneNumber,
            `✅ *${txType === 'expense' ? 'Gasto' : 'Ingreso'} registrado!*\n\n` +
            `${emoji} ${sign}${intent.amount.toFixed(2)} ${currency}\n` +
            `📂 ${data.categoryName}\n` +
            `🏦 ${matchedAccount.name}\n` +
            (intent.description ? `📝 ${intent.description}\n` : '') +
            `\n💳 Nuevo saldo: *${newBalance.toFixed(2)} ${currency}*`
          );
        } catch (err) {
          strapi.log.error('[AI] Error saving transaction:', err);
          await sender.sendText(phoneNumber, '❌ Error al guardar. Por favor intenta de nuevo.');
        }

        await updateSession(session.id, { state: 'MAIN_MENU', sessionData: {} });
        await sendMainMenu(phoneNumber, name);
        break;
      }

      case 'view_balance': {
        if (accounts.length === 0) {
          await sender.sendText(phoneNumber, '📊 No tienes cuentas registradas aún.');
        } else {
          const lines = accounts
            .map((a: any) => `🏦 *${a.name}*: ${(a.balance || 0).toFixed(2)} ${a.currency || 'USD'}`)
            .join('\n');
          await sender.sendText(phoneNumber, `📊 *Tu Balance*\n\n${lines}`);
        }
        await sendMainMenu(phoneNumber, name);
        break;
      }

      case 'view_summary': {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const transactions = await strapi.db.query('api::transaction.transaction').findMany({
          where: {
            user: session.user.id,
            date: { $gte: startOfMonth },
          },
          limit: 200,
        });

        const totalExpenses = transactions
          .filter((t: any) => t.type === 'expense')
          .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

        const totalIncome = transactions
          .filter((t: any) => t.type === 'income')
          .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

        const month = now.toLocaleString('es-MX', { month: 'long' });
        await sender.sendText(
          phoneNumber,
          `📊 *Resumen de ${month}*\n\n` +
          `💰 Ingresos: *${totalIncome.toFixed(2)}*\n` +
          `💸 Gastos: *${totalExpenses.toFixed(2)}*\n` +
          `📈 Balance: *${(totalIncome - totalExpenses).toFixed(2)}*\n\n` +
          `📝 ${transactions.length} transacciones este mes`
        );
        await sendMainMenu(phoneNumber, name);
        break;
      }

      case 'general_question': {
        if (intent.answer) {
          await sender.sendText(phoneNumber, `🤖 ${intent.answer}`);
        } else {
          await sender.sendText(phoneNumber, '🤔 No tengo respuesta para eso. ¿En qué más puedo ayudarte?');
        }
        await sendMainMenu(phoneNumber, name);
        break;
      }

      default:
        await sender.sendText(
          phoneNumber,
          '🤔 No entendí bien. Puedes decirme cosas como:\n\n• _"gasté 50 en almuerzo"_\n• _"recibí 1500 de salario"_\n• _"¿cuánto gasté este mes?"_'
        );
        await sendMainMenu(phoneNumber, name);
    }
  }

  async function handleAmount(session: any, phoneNumber: string, text: string) {
    const amount = parseAmount(text);
    if (!amount) {
      await sender.sendText(
        phoneNumber,
        '❌ Monto inválido. Escribe solo el número (ej: *50.00*)'
      );
      return;
    }

    const type = session.sessionData?.transactionType as 'expense' | 'income';
    const data: SessionData = { ...session.sessionData, amount };
    const currency = data.currency || 'USD';

    let categories = await getUserCategories(session.user.id, type);
    if (categories.length === 0) {
      await seedUserData(session.user.id, currency);
      categories = await getUserCategories(session.user.id, type);
    }

    const newState = type === 'expense' ? 'EXPENSE_CATEGORY' : 'INCOME_CATEGORY';
    await updateSession(session.id, { state: newState, sessionData: data });
    await sendCategorySelection(phoneNumber, categories, type, amount, currency);
  }

  async function handleCategory(session: any, phoneNumber: string, input: string) {
    if (!input.startsWith('cat_')) {
      await sender.sendText(phoneNumber, 'Por favor selecciona una categoría de la lista.');
      return;
    }

    const categoryId = parseInt(input.replace('cat_', ''), 10);
    const category = await strapi.db
      .query('api::category.category')
      .findOne({ where: { id: categoryId } });

    const data: SessionData = {
      ...session.sessionData,
      categoryId,
      categoryName: category?.name || 'Sin categoría',
    };

    const type = data.transactionType!;
    const newState = type === 'expense' ? 'EXPENSE_ACCOUNT' : 'INCOME_ACCOUNT';
    await updateSession(session.id, { state: newState, sessionData: data });

    const accounts = await getUserAccounts(session.user.id);
    if (accounts.length === 0) {
      await sender.sendText(
        phoneNumber,
        '❌ No tienes cuentas registradas. Ve a la app web para crear una cuenta y luego vuelve aquí.'
      );
      await updateSession(session.id, { state: 'MAIN_MENU' });
      await sendMainMenu(phoneNumber, session.user.username);
      return;
    }

    await sendAccountSelection(phoneNumber, accounts, data.categoryName!);
  }

  async function handleAccount(session: any, phoneNumber: string, input: string) {
    if (!input.startsWith('acc_')) {
      await sender.sendText(phoneNumber, 'Por favor selecciona una cuenta de la lista.');
      return;
    }

    const accountId = parseInt(input.replace('acc_', ''), 10);
    const account = await strapi.db
      .query('api::account.account')
      .findOne({ where: { id: accountId } });

    const data: SessionData = {
      ...session.sessionData,
      accountId,
      accountName: account?.name || 'Sin cuenta',
    };

    const type = data.transactionType!;
    const newState = type === 'expense' ? 'EXPENSE_NOTES' : 'INCOME_NOTES';
    await updateSession(session.id, { state: newState, sessionData: data });

    await sender.sendText(
      phoneNumber,
      `🏦 Cuenta: *${account?.name}*\n\n¿Descripción? Escribe una nota breve o envía *no* para continuar:`
    );
  }

  async function handleNotes(session: any, phoneNumber: string, text: string) {
    const data: SessionData = { ...session.sessionData };
    const notes = isSkip(text) ? null : text.trim();
    const type = data.transactionType!;
    const isExpense = type === 'expense';

    try {
      // Create transaction
      await strapi.db.query('api::transaction.transaction').create({
        data: {
          amount: data.amount,
          type,
          description: notes || `${isExpense ? 'Gasto' : 'Ingreso'} vía WhatsApp`,
          date: new Date(),
          account: data.accountId,
          category: data.categoryId,
          user: session.user.id,
          whatsappMessageId: `wa_${Date.now()}`,
        },
      });

      // Update account balance
      const account = await strapi.db
        .query('api::account.account')
        .findOne({ where: { id: data.accountId } });

      const balanceDelta = isExpense ? -(data.amount!) : data.amount!;
      const newBalance = (account.balance || 0) + balanceDelta;

      await strapi.db.query('api::account.account').update({
        where: { id: data.accountId },
        data: { balance: newBalance },
      });

      const currency = account.currency || data.currency || 'USD';
      const sign = isExpense ? '-' : '+';
      const emoji = isExpense ? '💸' : '💰';
      const label = isExpense ? 'Gasto' : 'Ingreso';

      await sender.sendText(
        phoneNumber,
        `✅ *${label} registrado!*\n\n` +
        `${emoji} ${sign}${data.amount!.toFixed(2)} ${currency}\n` +
        `📂 ${data.categoryName}\n` +
        `🏦 ${data.accountName}` +
        (notes ? `\n📝 ${notes}` : '') +
        `\n\n💳 Saldo actual: *${newBalance.toFixed(2)} ${currency}*`
      );
    } catch (err) {
      strapi.log.error('[WhatsApp] Error saving transaction:', err);
      await sender.sendText(
        phoneNumber,
        '❌ Error al registrar. Por favor intenta de nuevo.'
      );
    }

    // Reset to main menu
    await updateSession(session.id, {
      state: 'MAIN_MENU',
      sessionData: { currency: data.currency },
    });
    await sendMainMenu(phoneNumber, session.user.username);
  }

  // ── Main entry point ───────────────────────────────────────────────────────

  return {
    async handle(phoneNumber: string, message: ParsedMessage): Promise<void> {
      // Get or create session
      let session = await getSession(phoneNumber);
      if (!session) {
        session = await createSession(phoneNumber);
      } else {
        await updateSession(session.id, {});
      }

      const { type: msgType, text: msgText, buttonId } = message;
      // Unified input: for text messages use the text, for button/list replies use the ID
      const input = msgType === 'text' ? msgText : buttonId;
      const state: string = session.state;

      strapi.log.debug(`[WhatsApp] phone=${phoneNumber} state=${state} input="${input}"`);

      try {
        switch (state) {
          case 'INIT':
            return await handleInit(session, phoneNumber, input, msgType);

          case 'REGISTER_NAME':
            if (msgType !== 'text') {
              await sender.sendText(phoneNumber, '¿Cuál es tu nombre? ✍️');
              return;
            }
            return await handleRegisterName(session, phoneNumber, msgText);

          case 'REGISTER_EMAIL':
            if (msgType !== 'text') {
              await sender.sendText(phoneNumber, '¿Cuál es tu correo electrónico?\n\nEjemplo: _correo@gmail.com_');
              return;
            }
            if (msgText.trim().toLowerCase() === 'cancelar') {
              await updateSession(session.id, { state: 'INIT', sessionData: {} });
              return await sendWelcome(phoneNumber);
            }
            return await handleRegisterEmail(session, phoneNumber, msgText);

          case 'REGISTER_CURRENCY':
            return await handleRegisterCurrency(session, phoneNumber, input);

          case 'MAIN_MENU':
            return await handleMainMenu(session, phoneNumber, input);

          case 'ADVISOR':
            if (msgType !== 'text') {
              await sender.sendText(phoneNumber, '✍️ Escríbeme tu consulta o *salir* para volver al menú.');
              return;
            }
            return await handleAdvisor(session, phoneNumber, msgText);

          case 'EXPENSE_AMOUNT':
          case 'INCOME_AMOUNT':
            if (msgType !== 'text') {
              const label = state === 'EXPENSE_AMOUNT' ? 'gastaste' : 'recibiste';
              await sender.sendText(phoneNumber, `¿Cuánto ${label}? Escribe el monto (ej: *50.00*)`);
              return;
            }
            return await handleAmount(session, phoneNumber, msgText);

          case 'EXPENSE_CATEGORY':
          case 'INCOME_CATEGORY':
            return await handleCategory(session, phoneNumber, input);

          case 'EXPENSE_ACCOUNT':
          case 'INCOME_ACCOUNT':
            return await handleAccount(session, phoneNumber, input);

          case 'EXPENSE_NOTES':
          case 'INCOME_NOTES':
            if (msgType !== 'text') {
              await sender.sendText(
                phoneNumber,
                '¿Descripción? Escribe una nota breve o envía *no* para continuar:'
              );
              return;
            }
            return await handleNotes(session, phoneNumber, msgText);

          default:
            strapi.log.warn(`[WhatsApp] Unknown state: ${state}, resetting to MAIN_MENU`);
            await updateSession(session.id, { state: 'MAIN_MENU' });
            if (session.user) {
              await sendMainMenu(phoneNumber, session.user.username);
            } else {
              await sendWelcome(phoneNumber);
            }
        }
      } catch (err) {
        strapi.log.error('[WhatsApp] Unhandled error in conversation handler:', err);
        await sender
          .sendText(phoneNumber, '⚠️ Ocurrió un error. Por favor escribe *hola* para reiniciar.')
          .catch(() => {});
      }
    },
  };
};
