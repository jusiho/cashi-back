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
  returnTo?: string;
}

// ─── Default seed data ───────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  { name: 'Comida',          icon: '🍕', color: '#EF4444', type: 'expense' },
  { name: 'Transporte',      icon: '🚗', color: '#3B82F6', type: 'expense' },
  { name: 'Salud',           icon: '🏥', color: '#10B981', type: 'expense' },
  { name: 'Entretenimiento', icon: '🎮', color: '#8B5CF6', type: 'expense' },
  { name: 'Ropa',            icon: '👕', color: '#F59E0B', type: 'expense' },
  { name: 'Hogar',           icon: '🏠', color: '#6B7280', type: 'expense' },
  { name: 'Vida Social',     icon: '🎉', color: '#EC4899', type: 'expense' },
  { name: 'Tecnología',      icon: '💻', color: '#6366F1', type: 'expense' },
  { name: 'Salario',         icon: '💼', color: '#10B981', type: 'income'  },
  { name: 'Freelance',       icon: '💻', color: '#3B82F6', type: 'income'  },
  { name: 'Inversiones',     icon: '📈', color: '#8B5CF6', type: 'income'  },
];

// WhatsApp limita 10 filas por sección — dividimos en dos
// WhatsApp Cloud API: max 10 rows total across all sections
const CURRENCY_SECTIONS = [
  {
    title: 'Selecciona tu moneda',
    rows: [
      { id: 'cur_PEN', title: 'PEN - Sol Peruano',      description: 'Peru' },
      { id: 'cur_USD', title: 'USD - Dolar',             description: 'EE.UU. / Ecuador / Panama' },
      { id: 'cur_COP', title: 'COP - Peso Colombiano',   description: 'Colombia' },
      { id: 'cur_MXN', title: 'MXN - Peso Mexicano',     description: 'Mexico' },
      { id: 'cur_ARS', title: 'ARS - Peso Argentino',    description: 'Argentina' },
      { id: 'cur_BRL', title: 'BRL - Real Brasileno',    description: 'Brasil' },
      { id: 'cur_CLP', title: 'CLP - Peso Chileno',      description: 'Chile' },
      { id: 'cur_BOB', title: 'BOB - Boliviano',         description: 'Bolivia' },
      { id: 'cur_CRC', title: 'CRC - Colon',             description: 'Costa Rica' },
      { id: 'cur_DOP', title: 'DOP - Peso Dominicano',   description: 'Rep. Dominicana' },
    ],
  },
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

  async function sendAdvisorButtons(phoneNumber: string, text: string, type: 'after_tx' | 'general' = 'general') {
    if (type === 'after_tx') {
      await sender.sendButtons(phoneNumber, text, [
        { id: 'btn_expense', title: '💸 Otro gasto'  },
        { id: 'btn_income',  title: '💰 Ingreso'     },
        { id: 'btn_balance', title: '📊 Ver saldo'   },
      ]);
    } else {
      await sender.sendButtons(phoneNumber, text, [
        { id: 'btn_expense', title: '💸 Registrar gasto'   },
        { id: 'btn_income',  title: '💰 Registrar ingreso' },
        { id: 'btn_balance', title: '📊 Ver mi saldo'      },
      ]);
    }
  }

  // ── State handlers ─────────────────────────────────────────────────────────

  async function handleInit(
    session: any,
    phoneNumber: string,
    input: string,
  ) {
    // If session already has a linked user, go straight to AI advisor
    if (session.user) {
      await updateSession(session.id, { state: 'ADVISOR', sessionData: { ...session.sessionData, advisorHistory: [] } });
      await sendAdvisorButtons(
        phoneNumber,
        `👋 ¡Hola de nuevo, *${session.user.username}*! 💰\n\nSoy tu asesor financiero. Puedes escribirme lo que necesites o usar los accesos rápidos:`,
        'general'
      );
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
      `✅ Correo guardado.\n\n💵 ¿Cuál es tu moneda principal?`,
      'Seleccionar moneda',
      CURRENCY_SECTIONS
    );
  }

  async function createUserAndFinish(session: any, phoneNumber: string, data: SessionData) {
    const name = data.name || 'Usuario';
    const currency = data.currency || 'USD';

    let user: any;
    try {
      const role = await strapi.db
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'authenticated' } });

      const tempPassword = Math.random().toString(36).substring(2, 8).toUpperCase() +
        Math.random().toString(36).substring(2, 5) + '1!';

      user = await strapi.plugin('users-permissions').service('user').add({
        username: name,
        email: data.email || `wa_${phoneNumber}@cashi.app`,
        password: tempPassword,
        provider: 'local',
        confirmed: true,
        blocked: false,
        role: role?.id,
        phoneNumber,
        registrationSource: 'whatsapp',
      });

      (data as any)._tempPassword = tempPassword;
    } catch (err) {
      strapi.log.error('[WhatsApp] Error creating user:', err);
      await sender.sendText(phoneNumber, '❌ Hubo un error al crear tu cuenta. Por favor escribe *hola* para intentar de nuevo.');
      return;
    }

    await seedUserData(user.id, currency === 'MULTI' ? 'USD' : currency);

    await updateSession(session.id, { state: 'ADVISOR', sessionData: { ...data, advisorHistory: [] }, user: user.id });

    const webUrl = process.env.NEXTJS_URL;
    const tempPwd = (data as any)._tempPassword;

    await sender.sendText(
      phoneNumber,
      `🎉 *¡Cuenta creada exitosamente!*\n\nBienvenido a *Cashi*, ${name}! 🎊\n\n` +
      (webUrl ? `💻 *Accede también desde la web:*\n🔗 ${webUrl}\n\n` : '') +
      `📧 Email: ${data.email}\n` +
      `🔑 Contraseña temporal: *${tempPwd}*\n\n` +
      `⚠️ _Guarda esta contraseña. Puedes cambiarla en Configuración → Perfil._`
    );
    await sendAdvisorButtons(
      phoneNumber,
      `🤖 Soy tu asesor financiero. Puedes escribirme en lenguaje natural o usar los accesos rápidos:`,
      'general'
    );
  }

  async function handleRegisterCurrency(session: any, phoneNumber: string, buttonId: string) {
    if (!buttonId.startsWith('cur_')) {
      await sender.sendList(phoneNumber, '💵 Por favor selecciona tu moneda:', 'Ver monedas', [
...CURRENCY_SECTIONS,
      ]);
      return;
    }
    const currency = buttonId.replace('cur_', '');
    const data: SessionData = { ...session.sessionData, currency };
    await createUserAndFinish(session, phoneNumber, data);
  }

  const MENU_TRIGGERS = new Set([
    'hola', 'hi', 'hello', 'hey', 'buenas', 'buenos días', 'buenos dias',
    'buenas tardes', 'buenas noches', 'menu', 'menú', 'inicio', 'start',
    'empezar', 'volver', 'regresar', 'opciones', 'ayuda', 'help', '.',
    'ok', 'ок', '👋',
  ]);

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
      await updateSession(session.id, {
        state: 'ADVISOR',
        sessionData: { ...session.sessionData, advisorHistory: [] },
      });
      await sendAdvisorButtons(
        phoneNumber,
        `🤖 *Asesor Financiero Cashi*\n\n¡Hola ${name}! Escríbeme lo que necesites — puedo registrar gastos, analizar tus finanzas y darte consejos.\n\nEjemplos:\n• _"gasté 50 en almuerzo"_\n• _"¿cómo voy este mes?"_\n• _"recibí 1500 de salario"_`,
        'general'
      );
      return;
    }

    // Saludos / palabras de menú → mostrar menú
    if (!input || MENU_TRIGGERS.has(input.trim().toLowerCase())) {
      await sendMainMenu(phoneNumber, name);
      return;
    }

    // Texto libre → pasar a modo asesor IA
    await updateSession(session.id, {
      state: 'ADVISOR',
      sessionData: { ...session.sessionData, advisorHistory: [] },
    });
    await handleAdvisor(session, phoneNumber, input, false);
  }

  async function handleAdvisor(session: any, phoneNumber: string, input: string, isButtonId = false) {
    const name = session.user?.username || 'Usuario';

    // ── Botones de acceso rápido ────────────────────────────────
    if (isButtonId) {
      if (input === 'btn_expense' || input === 'btn_income') {
        const txType = input === 'btn_expense' ? 'expense' : 'income';
        const emoji  = txType === 'expense' ? '💸' : '💰';
        const label  = txType === 'expense' ? 'gastaste' : 'recibiste';
        await updateSession(session.id, {
          state: txType === 'expense' ? 'EXPENSE_AMOUNT' : 'INCOME_AMOUNT',
          sessionData: { ...session.sessionData, transactionType: txType, returnTo: 'ADVISOR' },
        });
        await sender.sendText(phoneNumber, `${emoji} ¿Cuánto ${label}?\n\nEscribe el monto (ej: *50.00*)`);
        return;
      }

      if (input === 'btn_balance') {
        const accounts = await getUserAccounts(session.user.id);
        if (!accounts.length) {
          await sendAdvisorButtons(phoneNumber, '📊 No tienes cuentas registradas aún.', 'general');
        } else {
          const lines = accounts
            .map((a: any) => `🏦 *${a.name}*: ${(a.balance || 0).toFixed(2)} ${a.currency || 'USD'}`)
            .join('\n');
          await sendAdvisorButtons(phoneNumber, `📊 *Tu Saldo Actual*\n\n${lines}`, 'general');
        }
        return;
      }
    }

    // ── Comandos de menú ────────────────────────────────────────
    if (MENU_TRIGGERS.has(input.trim().toLowerCase())) {
      await sendMainMenu(phoneNumber, name);
      return;
    }

    // ── Cargar contexto financiero ──────────────────────────────
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [accounts, categories, recentTx, monthTx] = await Promise.all([
      getUserAccounts(session.user.id),
      strapi.db.query('api::category.category').findMany({ where: { user: session.user.id }, limit: 20 }),
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

    const monthlyExpenses = monthTx.filter((t: any) => t.type === 'expense').reduce((s: number, t: any) => s + (t.amount || 0), 0);
    const monthlyIncome   = monthTx.filter((t: any) => t.type === 'income') .reduce((s: number, t: any) => s + (t.amount || 0), 0);

    const baseContext = {
      name,
      accounts:   accounts.map((a: any) => ({ name: a.name, balance: a.balance || 0, currency: a.currency || 'USD' })),
      categories: categories.map((c: any) => ({ name: c.name, type: c.type })),
    };

    const aiService = strapi.service('api::whatsapp-bot.ai');

    // ── Intentar parsear intent de transacción ──────────────────
    const intent = await aiService.parseIntent(input, baseContext);

    if (intent.intent === 'register_expense' || intent.intent === 'register_income') {
      const txType = intent.intent === 'register_expense' ? 'expense' : 'income';

      if (!intent.amount) {
        // Sin monto → flujo paso a paso
        await updateSession(session.id, {
          state: txType === 'expense' ? 'EXPENSE_AMOUNT' : 'INCOME_AMOUNT',
          sessionData: { ...session.sessionData, transactionType: txType, returnTo: 'ADVISOR' },
        });
        await sender.sendText(phoneNumber, `${txType === 'expense' ? '💸' : '💰'} ¿Cuánto ${txType === 'expense' ? 'gastaste' : 'recibiste'}?`);
        return;
      }

      // Buscar categoría y cuenta
      const matchedCategory = intent.category_name
        ? categories.find((c: any) =>
            c.name.toLowerCase().includes(intent.category_name!.toLowerCase()) ||
            intent.category_name!.toLowerCase().includes(c.name.toLowerCase())
          )
        : null;

      const matchedAccount = intent.account_name
        ? accounts.find((a: any) => a.name.toLowerCase().includes(intent.account_name!.toLowerCase()))
        : accounts[0];

      if (!matchedAccount) {
        await sendAdvisorButtons(phoneNumber, '❌ No tienes cuentas registradas.', 'general');
        return;
      }

      if (!matchedCategory) {
        // Pedir categoría
        const filtered = categories.filter((c: any) => c.type === txType || c.type === 'both');
        await updateSession(session.id, {
          state: txType === 'expense' ? 'EXPENSE_CATEGORY' : 'INCOME_CATEGORY',
          sessionData: {
            ...session.sessionData,
            transactionType: txType,
            amount: intent.amount,
            accountId: matchedAccount.id,
            accountName: matchedAccount.name,
            returnTo: 'ADVISOR',
          },
        });
        await sendCategorySelection(phoneNumber, filtered, txType as 'expense' | 'income', intent.amount, matchedAccount.currency || 'USD');
        return;
      }

      // Registrar directamente
      try {
        await strapi.db.query('api::transaction.transaction').create({
          data: {
            amount:     intent.amount,
            type:       txType,
            description: intent.description || input,
            date:       new Date(),
            account:    matchedAccount.id,
            category:   matchedCategory.id,
            user:       session.user.id,
            whatsappMessageId: `wa_ai_${Date.now()}`,
          },
        });
        const delta      = txType === 'expense' ? -intent.amount : intent.amount;
        const newBalance = (matchedAccount.balance || 0) + delta;
        await strapi.db.query('api::account.account').update({ where: { id: matchedAccount.id }, data: { balance: newBalance } });

        const sign    = txType === 'expense' ? '-' : '+';
        const emoji   = txType === 'expense' ? '💸' : '💰';
        const currency = matchedAccount.currency || 'USD';

        await sendAdvisorButtons(
          phoneNumber,
          `✅ *${txType === 'expense' ? 'Gasto' : 'Ingreso'} registrado!*\n\n` +
          `${emoji} ${sign}${intent.amount.toFixed(2)} ${currency}\n` +
          `📂 ${matchedCategory.name}\n` +
          `🏦 ${matchedAccount.name}\n` +
          (intent.description ? `📝 ${intent.description}\n` : '') +
          `\n💳 Nuevo saldo: *${newBalance.toFixed(2)} ${currency}*`,
          'after_tx'
        );
      } catch (err) {
        strapi.log.error('[Advisor] Error saving transaction:', err);
        await sendAdvisorButtons(phoneNumber, '❌ Error al guardar. Intenta de nuevo.', 'general');
      }
      return;
    }

    if (intent.intent === 'view_balance') {
      const lines = accounts.length
        ? accounts.map((a: any) => `🏦 *${a.name}*: ${(a.balance || 0).toFixed(2)} ${a.currency || 'USD'}`).join('\n')
        : 'Sin cuentas registradas.';
      await sendAdvisorButtons(phoneNumber, `📊 *Tu Saldo Actual*\n\n${lines}`, 'general');
      return;
    }

    if (intent.intent === 'view_summary') {
      const month = now.toLocaleString('es-MX', { month: 'long' });
      await sendAdvisorButtons(
        phoneNumber,
        `📊 *Resumen de ${month}*\n\n` +
        `💰 Ingresos: *${monthlyIncome.toFixed(2)}*\n` +
        `💸 Gastos: *${monthlyExpenses.toFixed(2)}*\n` +
        `📈 Balance: *${(monthlyIncome - monthlyExpenses).toFixed(2)}*\n\n` +
        `📝 ${monthTx.length} transacciones este mes`,
        'general'
      );
      return;
    }

    // ── Consejo conversacional ──────────────────────────────────
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = session.sessionData?.advisorHistory || [];

    const advisorContext = {
      ...baseContext,
      recentTransactions: recentTx.map((t: any) => ({
        type:     t.type,
        amount:   t.amount || 0,
        category: t.category?.name || 'Sin categoría',
        date:     new Date(t.date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
      })),
      monthlyExpenses,
      monthlyIncome,
    };

    const response = await aiService.askAdvisor(input, advisorContext, history);

    const updatedHistory = [
      ...history,
      { role: 'user' as const,      content: input    },
      { role: 'assistant' as const, content: response },
    ].slice(-10);

    await updateSession(session.id, {
      sessionData: { ...session.sessionData, advisorHistory: updatedHistory },
    });

    await sendAdvisorButtons(phoneNumber, response, 'general');
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
      // Re-enviar la lista de categorías
      const type = session.sessionData?.transactionType as 'expense' | 'income';
      const amount = session.sessionData?.amount || 0;
      const currency = session.sessionData?.currency || 'USD';
      const cats = await getUserCategories(session.user.id, type);
      await sendCategorySelection(phoneNumber, cats, type, amount, currency);
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
      // Re-enviar la lista de cuentas
      const categoryName = session.sessionData?.categoryName || 'Categoría';
      const accounts = await getUserAccounts(session.user.id);
      await sendAccountSelection(phoneNumber, accounts, categoryName);
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
    const returnTo = data.returnTo as string | undefined;
    if (returnTo === 'ADVISOR') {
      await updateSession(session.id, {
        state: 'ADVISOR',
        sessionData: { currency: data.currency, advisorHistory: session.sessionData?.advisorHistory || [] },
      });
      await sendAdvisorButtons(phoneNumber, '¿En qué más te puedo ayudar?', 'after_tx');
    } else {
      await updateSession(session.id, { state: 'MAIN_MENU', sessionData: { currency: data.currency } });
      await sendMainMenu(phoneNumber, session.user.username);
    }
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
            return await handleInit(session, phoneNumber, input);

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
            return await handleAdvisor(session, phoneNumber, input, msgType !== 'text');

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
