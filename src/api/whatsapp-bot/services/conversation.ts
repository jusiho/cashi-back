/**
 * WhatsApp Conversation State Machine
 *
 * States:
 *   INIT              → First contact, show welcome + register/login buttons
 *   REGISTER_NAME     → Waiting for user to type their name
 *   REGISTER_EMAIL    → Waiting for user to type their email
 *   REGISTER_CURRENCY → Waiting for currency selection (list)
 *   MAIN_MENU         → Authenticated main menu
 *   ADVISOR           → AI advisor (free text + quick-reply buttons)
 *   EXPENSE_AMOUNT    → Waiting for expense amount (text)
 *   EXPENSE_CATEGORY  → Waiting for category selection (buttons/list)
 *   EXPENSE_ACCOUNT   → Waiting for account selection (buttons/list)
 *   INCOME_AMOUNT     → Waiting for income amount (text)
 *   INCOME_CATEGORY   → Waiting for category selection (buttons/list)
 *   INCOME_ACCOUNT    → Waiting for account selection (buttons/list)
 *
 * Universal escape: sending a menu trigger (hola, menú, inicio…) from
 * any mid-flow state resets the user to MAIN_MENU / ADVISOR.
 */

import sender from './sender';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedMessage {
  type: 'text' | 'button_reply' | 'list_reply' | 'unknown';
  text: string;
  buttonId: string;
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

// ─── Seed data ────────────────────────────────────────────────────────────────

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
  { name: 'Freelance',       icon: '🖥️', color: '#3B82F6', type: 'income'  },
  { name: 'Inversiones',     icon: '📈', color: '#8B5CF6', type: 'income'  },
];

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

/**
 * Parse amount from natural text.
 * Accepts: "50", "50.00", "50,00", "S/.50", "50 soles", "$50", "1500 pesos"
 */
function parseAmount(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(/soles?|pesos?|d[oó]lares?|dollars?|reais?|s\/\.?|bs\.?|\$|€/gi, '')
    .replace(/,/g, '.')
    .replace(/[^0-9.]/g, '');
  const value = parseFloat(cleaned);
  return isNaN(value) || value <= 0 ? null : value;
}

/**
 * Returns the display currency string.
 * Returns empty string for MULTI (multi-currency accounts show each account's own currency).
 */
function displayCurrency(currency?: string): string {
  if (!currency || currency === 'MULTI') return '';
  return ` ${currency}`;
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
    const existing = await strapi.db.query('api::category.category').count({ where: { user: userId } });
    if (existing === 0) {
      for (const cat of DEFAULT_CATEGORIES) {
        await strapi.db.query('api::category.category').create({
          data: { ...cat, isDefault: true, user: userId },
        });
      }
    }
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
      `💰 *Cashi* — ¿Qué hacemos, ${name}?`,
      [
        { id: 'btn_expense', title: '💸 Registrar gasto'   },
        { id: 'btn_income',  title: '💰 Registrar ingreso' },
        { id: 'btn_advisor', title: '🤖 Hablar con IA'     },
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
    const cur = displayCurrency(currency);
    const header = `${emoji} Monto: *${amount.toFixed(2)}${cur}*\n\n¿En qué categoría?`;

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
    categoryName: string,
    amount: number,
    currency: string
  ) {
    const cur = displayCurrency(currency);
    const header = `📂 *${categoryName}* · ${amount.toFixed(2)}${cur}\n\n¿Desde qué cuenta?`;

    if (accounts.length <= 3) {
      await sender.sendButtons(
        phoneNumber,
        header,
        accounts.map((a) => ({
          id: `acc_${a.id}`,
          title: a.name,
        }))
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

  // ── Transaction save (shared between step-by-step and advisor flows) ────────

  async function saveTransaction(
    session: any,
    phoneNumber: string,
    data: SessionData,
    description: string | null
  ) {
    const type = data.transactionType!;
    const isExpense = type === 'expense';

    try {
      await strapi.db.query('api::transaction.transaction').create({
        data: {
          amount:     data.amount,
          type,
          description: description || `${isExpense ? 'Gasto' : 'Ingreso'} vía WhatsApp`,
          date:        new Date(),
          account:     data.accountId,
          category:    data.categoryId,
          user:        session.user.id,
          whatsappMessageId: `wa_${Date.now()}`,
        },
      });

      const account = await strapi.db.query('api::account.account').findOne({ where: { id: data.accountId } });
      const delta      = isExpense ? -(data.amount!) : data.amount!;
      const newBalance = (account.balance || 0) + delta;

      await strapi.db.query('api::account.account').update({
        where: { id: data.accountId },
        data:  { balance: newBalance },
      });

      const currency = account.currency || data.currency || 'USD';
      const cur      = displayCurrency(currency);
      const sign     = isExpense ? '-' : '+';
      const emoji    = isExpense ? '💸' : '💰';
      const label    = isExpense ? 'Gasto' : 'Ingreso';

      await sendAdvisorButtons(
        phoneNumber,
        `✅ *${label} registrado!*\n\n` +
        `${emoji} ${sign}${data.amount!.toFixed(2)}${cur}\n` +
        `📂 ${data.categoryName}\n` +
        `🏦 ${data.accountName}` +
        (description ? `\n📝 ${description}` : '') +
        `\n\n💳 Saldo: *${newBalance.toFixed(2)}${cur}*\n\n` +
        `_Escribe cualquier cosa o usa los botones:_`,
        'after_tx'
      );
    } catch (err) {
      strapi.log.error('[WhatsApp] Error saving transaction:', err);
      await sender.sendText(phoneNumber, '❌ Error al registrar. Por favor intenta de nuevo.');
    }

    // Return to advisor or main menu
    const returnTo = data.returnTo as string | undefined;
    if (returnTo === 'ADVISOR') {
      await updateSession(session.id, {
        state: 'ADVISOR',
        sessionData: { currency: data.currency, advisorHistory: session.sessionData?.advisorHistory || [] },
      });
    } else {
      await updateSession(session.id, { state: 'ADVISOR', sessionData: { currency: data.currency, advisorHistory: [] } });
    }
  }

  // ── State handlers ─────────────────────────────────────────────────────────

  async function handleInit(session: any, phoneNumber: string, input: string) {
    if (session.user) {
      await updateSession(session.id, { state: 'ADVISOR', sessionData: { ...session.sessionData, advisorHistory: [] } });
      await sendAdvisorButtons(
        phoneNumber,
        `👋 ¡Hola de nuevo, *${session.user.username}*! 💰\n\nSoy tu asesor financiero. Escríbeme lo que necesites o usa los accesos rápidos:`,
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
      await sender.sendText(phoneNumber, '❌ No encontramos una cuenta con este número.\n\n¿Deseas registrarte?');
      await sendWelcome(phoneNumber);
      return;
    }

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
    await sender.sendText(phoneNumber, `¡Hola *${name}*! 😊\n\n¿Cuál es tu correo electrónico?\n\nEjemplo: _correo@gmail.com_`);
  }

  async function handleRegisterEmail(session: any, phoneNumber: string, email: string) {
    email = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await sender.sendText(phoneNumber, '❌ Correo inválido. Por favor ingresa un correo válido:\n\nEjemplo: _correo@gmail.com_');
      return;
    }

    const existing = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email } });
    if (existing) {
      await sender.sendText(phoneNumber, `❌ El correo *${email}* ya está registrado.\n\nIngresa otro correo o escribe *cancelar* para volver al inicio.`);
      return;
    }

    const data: SessionData = { ...session.sessionData, email };
    await updateSession(session.id, { state: 'REGISTER_CURRENCY', sessionData: data });
    await sender.sendList(phoneNumber, `✅ Correo guardado.\n\n💵 ¿Cuál es tu moneda principal?`, 'Seleccionar moneda', CURRENCY_SECTIONS);
  }

  async function createUserAndFinish(session: any, phoneNumber: string, data: SessionData) {
    const name     = data.name || 'Usuario';
    const currency = data.currency || 'USD';

    let user: any;
    try {
      const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } });
      const tempPassword = Math.random().toString(36).substring(2, 8).toUpperCase() +
        Math.random().toString(36).substring(2, 5) + '1!';

      user = await strapi.plugin('users-permissions').service('user').add({
        username:           name,
        email:              data.email || `wa_${phoneNumber}@cashi.app`,
        password:           tempPassword,
        provider:           'local',
        confirmed:          true,
        blocked:            false,
        role:               role?.id,
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

    const webUrl  = process.env.NEXTJS_URL;
    const tempPwd = (data as any)._tempPassword;

    await sender.sendText(
      phoneNumber,
      `🎉 *¡Cuenta creada exitosamente!*\n\nBienvenido a *Cashi*, ${name}! 🎊\n\n` +
      (webUrl ? `💻 Accede también desde la web:\n🔗 ${webUrl}\n\n` : '') +
      `📧 Email: ${data.email}\n` +
      `🔑 Contraseña temporal: *${tempPwd}*\n\n` +
      `⚠️ _Guarda esta contraseña. Puedes cambiarla en Configuración._`
    );
    await sendAdvisorButtons(
      phoneNumber,
      `🤖 Soy tu asesor financiero. Escríbeme en lenguaje natural o usa los accesos rápidos:`,
      'general'
    );
  }

  async function handleRegisterCurrency(session: any, phoneNumber: string, buttonId: string) {
    if (!buttonId.startsWith('cur_')) {
      await sender.sendList(phoneNumber, '💵 Por favor selecciona tu moneda:', 'Ver monedas', CURRENCY_SECTIONS);
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
    'ok', 'ок', '👋', 'cancelar', 'salir', 'cancel',
  ]);

  const GREETING_TRIGGERS = new Set([
    'hola', 'hi', 'hello', 'hey', 'buenas', 'buenos días', 'buenos dias',
    'buenas tardes', 'buenas noches', 'qué tal', 'que tal', 'como estas',
    'cómo estás', 'good morning', 'good afternoon', '👋',
  ]);

  async function handleMainMenu(session: any, phoneNumber: string, input: string) {
    const name   = session.user?.username || 'Usuario';
    const txType = input === 'btn_expense' ? 'expense' : input === 'btn_income' ? 'income' : null;

    if (txType) {
      const emoji    = txType === 'expense' ? '💸' : '💰';
      const label    = txType === 'expense' ? 'Gasto' : 'Ingreso';
      const newState = txType === 'expense' ? 'EXPENSE_AMOUNT' : 'INCOME_AMOUNT';

      await updateSession(session.id, {
        state:       newState,
        sessionData: { ...session.sessionData, transactionType: txType },
      });
      await sender.sendText(phoneNumber, `${emoji} *Registrar ${label}*\n\n¿Cuánto ${txType === 'expense' ? 'gastaste' : 'recibiste'}?\n\nEscribe el monto (ej: *50*, *150.00*)`);
      return;
    }

    if (input === 'btn_advisor') {
      await updateSession(session.id, { state: 'ADVISOR', sessionData: { ...session.sessionData, advisorHistory: [] } });
      await sendAdvisorButtons(
        phoneNumber,
        `🤖 *Asesor Financiero*\n\n¡Hola ${name}! Escríbeme lo que necesites:\n\n• _"gasté 50 en almuerzo"_\n• _"¿cómo voy este mes?"_\n• _"recibí 1500 de salario"_`,
        'general'
      );
      return;
    }

    if (!input || MENU_TRIGGERS.has(input.trim().toLowerCase())) {
      await sendMainMenu(phoneNumber, name);
      return;
    }

    // Texto libre → modo asesor
    await updateSession(session.id, { state: 'ADVISOR', sessionData: { ...session.sessionData, advisorHistory: [] } });
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
          state:       txType === 'expense' ? 'EXPENSE_AMOUNT' : 'INCOME_AMOUNT',
          sessionData: { ...session.sessionData, transactionType: txType, returnTo: 'ADVISOR' },
        });
        await sender.sendText(phoneNumber, `${emoji} ¿Cuánto ${label}?\n\nEscribe el monto (ej: *50*, *150.00*)`);
        return;
      }

      if (input === 'btn_balance') {
        const accounts = await getUserAccounts(session.user.id);
        const webUrl   = process.env.NEXTJS_URL || 'https://cashi.la';
        if (!accounts.length) {
          await sendAdvisorButtons(phoneNumber, '📊 No tienes cuentas registradas aún.', 'general');
        } else {
          const lines = accounts
            .map((a: any) => `🏦 *${a.name}*: ${(a.balance || 0).toFixed(2)} ${a.currency || ''}`.trim())
            .join('\n');
          await sender.sendCtaUrl(
            phoneNumber,
            `📊 *Tu Saldo Actual*\n\n${lines}\n\n_Ver el detalle completo en la app:_`,
            '📱 Ir al Dashboard',
            `${webUrl}/dashboard`
          );
        }
        return;
      }
    }

    // ── Saludos / menú ──────────────────────────────────────────
    const trimmed = input.trim().toLowerCase();
    if (MENU_TRIGGERS.has(trimmed)) {
      await sendMainMenu(phoneNumber, name);
      return;
    }

    // Saludo conversacional breve → respuesta cálida sin cargar contexto financiero
    if (GREETING_TRIGGERS.has(trimmed)) {
      await sendAdvisorButtons(
        phoneNumber,
        `¡Hola, ${name}! 😊💚\n\nTodo bien por aquí. ¿En qué te puedo ayudar hoy con tus finanzas?\n\nPuedes escribirme directamente lo que quieras, por ejemplo:\n• _"gasté 80 en comida"_\n• _"¿cómo voy este mes?"_`,
        'general'
      );
      return;
    }

    // ── Cargar contexto financiero ──────────────────────────────
    const now          = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [accounts, categories, recentTx, monthTx] = await Promise.all([
      getUserAccounts(session.user.id),
      strapi.db.query('api::category.category').findMany({ where: { user: session.user.id }, limit: 20 }),
      strapi.db.query('api::transaction.transaction').findMany({
        where:    { user: session.user.id },
        orderBy:  { date: 'desc' },
        limit:    10,
        populate: ['category', 'account'],
      }),
      strapi.db.query('api::transaction.transaction').findMany({
        where: { user: session.user.id, date: { $gte: startOfMonth } },
        limit: 200,
      }),
    ]);

    const monthlyExpenses = monthTx.filter((t: any) => t.type === 'expense').reduce((s: number, t: any) => s + (t.amount || 0), 0);
    const monthlyIncome   = monthTx.filter((t: any) => t.type === 'income').reduce((s: number, t: any)  => s + (t.amount || 0), 0);

    const baseContext = {
      name,
      accounts:   accounts.map((a: any) => ({ name: a.name, balance: a.balance || 0, currency: a.currency || 'USD' })),
      categories: categories.map((c: any) => ({ name: c.name, type: c.type })),
    };

    const aiService = strapi.service('api::whatsapp-bot.ai');

    // ── Parsear intent ──────────────────────────────────────────
    const intent = await aiService.parseIntent(input, baseContext);

    if (intent.intent === 'register_expense' || intent.intent === 'register_income') {
      const txType = intent.intent === 'register_expense' ? 'expense' : 'income';

      if (!intent.amount) {
        await updateSession(session.id, {
          state:       txType === 'expense' ? 'EXPENSE_AMOUNT' : 'INCOME_AMOUNT',
          sessionData: { ...session.sessionData, transactionType: txType, returnTo: 'ADVISOR' },
        });
        await sender.sendText(phoneNumber, `${txType === 'expense' ? '💸' : '💰'} ¿Cuánto ${txType === 'expense' ? 'gastaste' : 'recibiste'}?`);
        return;
      }

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
        const filtered = categories.filter((c: any) => c.type === txType || c.type === 'both');
        await updateSession(session.id, {
          state: txType === 'expense' ? 'EXPENSE_CATEGORY' : 'INCOME_CATEGORY',
          sessionData: {
            ...session.sessionData,
            transactionType: txType,
            amount:          intent.amount,
            accountId:       matchedAccount.id,
            accountName:     matchedAccount.name,
            returnTo:        'ADVISOR',
          },
        });
        await sendCategorySelection(phoneNumber, filtered, txType as 'expense' | 'income', intent.amount, matchedAccount.currency || '');
        return;
      }

      // Registrar directamente
      try {
        await strapi.db.query('api::transaction.transaction').create({
          data: {
            amount:      intent.amount,
            type:        txType,
            description: intent.description || input,
            date:        new Date(),
            account:     matchedAccount.id,
            category:    matchedCategory.id,
            user:        session.user.id,
            whatsappMessageId: `wa_ai_${Date.now()}`,
          },
        });
        const delta      = txType === 'expense' ? -intent.amount : intent.amount;
        const newBalance = (matchedAccount.balance || 0) + delta;
        await strapi.db.query('api::account.account').update({ where: { id: matchedAccount.id }, data: { balance: newBalance } });

        const sign     = txType === 'expense' ? '-' : '+';
        const emoji    = txType === 'expense' ? '💸' : '💰';
        const currency = matchedAccount.currency || '';
        const cur      = displayCurrency(currency);

        await sendAdvisorButtons(
          phoneNumber,
          `✅ *${txType === 'expense' ? 'Gasto' : 'Ingreso'} registrado!*\n\n` +
          `${emoji} ${sign}${intent.amount.toFixed(2)}${cur}\n` +
          `📂 ${matchedCategory.name}\n` +
          `🏦 ${matchedAccount.name}\n` +
          (intent.description ? `📝 ${intent.description}\n` : '') +
          `\n💳 Saldo: *${newBalance.toFixed(2)}${cur}*`,
          'after_tx'
        );
      } catch (err) {
        strapi.log.error('[Advisor] Error saving transaction:', err);
        await sendAdvisorButtons(phoneNumber, '❌ Error al guardar. Intenta de nuevo.', 'general');
      }
      return;
    }

    if (intent.intent === 'view_balance') {
      const webUrl = process.env.NEXTJS_URL || 'https://cashi.la';
      const lines  = accounts.length
        ? accounts.map((a: any) => `🏦 *${a.name}*: ${(a.balance || 0).toFixed(2)} ${a.currency || ''}`.trim()).join('\n')
        : 'Sin cuentas registradas.';
      await sender.sendCtaUrl(
        phoneNumber,
        `📊 *Tu Saldo Actual*\n\n${lines}\n\n_Ver detalle completo en la app:_`,
        '📱 Ir al Dashboard',
        `${webUrl}/dashboard`
      );
      return;
    }

    if (intent.intent === 'view_summary') {
      const webUrl      = process.env.NEXTJS_URL || 'https://cashi.la';
      const month       = now.toLocaleString('es-MX', { month: 'long' });
      const balance     = monthlyIncome - monthlyExpenses;
      const balanceSign = balance >= 0 ? '+' : '';
      await sender.sendCtaUrl(
        phoneNumber,
        `📊 *Resumen de ${month}*\n\n` +
        `💰 Ingresos: *${monthlyIncome.toFixed(2)}*\n` +
        `💸 Gastos: *${monthlyExpenses.toFixed(2)}*\n` +
        `📈 Balance: *${balanceSign}${balance.toFixed(2)}*\n\n` +
        `📝 ${monthTx.length} transacciones este mes\n\n` +
        `_Ver análisis completo en la app:_`,
        '📊 Ver mis finanzas',
        `${webUrl}/transactions`
      );
      return;
    }

    // intent === 'general_question': AI ya tiene la respuesta en intent.answer
    if (intent.intent === 'general_question' && intent.answer) {
      await sendAdvisorButtons(phoneNumber, intent.answer, 'general');
      return;
    }

    // ── Respuesta conversacional completa ───────────────────────
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
    // Universal escape
    if (MENU_TRIGGERS.has(text.trim().toLowerCase())) {
      await updateSession(session.id, {
        state:       'ADVISOR',
        sessionData: { currency: session.sessionData?.currency, advisorHistory: [] },
      });
      await sendAdvisorButtons(
        phoneNumber,
        `¿En qué te puedo ayudar, ${session.user?.username || 'Usuario'}?`,
        'general'
      );
      return;
    }

    const amount = parseAmount(text);
    if (!amount) {
      await sender.sendText(
        phoneNumber,
        '❌ No entendí el monto. Escribe solo el número:\n\n*Ejemplos:* 50 · 150.50 · 1500\n\n_O escribe *menú* para cancelar._'
      );
      return;
    }

    const type     = session.sessionData?.transactionType as 'expense' | 'income';
    const data: SessionData = { ...session.sessionData, amount };

    // Resolve currency from first account (avoid showing MULTI)
    let currency = data.currency || 'USD';
    if (currency === 'MULTI') {
      const accounts = await getUserAccounts(session.user.id);
      currency = accounts[0]?.currency || 'USD';
    }

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
    // Universal escape
    if (session.sessionData && MENU_TRIGGERS.has(input.trim().toLowerCase())) {
      await updateSession(session.id, { state: 'ADVISOR', sessionData: { currency: session.sessionData?.currency, advisorHistory: [] } });
      await sendAdvisorButtons(phoneNumber, '¿En qué te puedo ayudar?', 'general');
      return;
    }

    if (!input.startsWith('cat_')) {
      const type     = session.sessionData?.transactionType as 'expense' | 'income';
      const amount   = session.sessionData?.amount || 0;
      const currency = session.sessionData?.currency || 'USD';
      const cats     = await getUserCategories(session.user.id, type);
      await sendCategorySelection(phoneNumber, cats, type, amount, currency);
      return;
    }

    const categoryId = parseInt(input.replace('cat_', ''), 10);
    const category   = await strapi.db.query('api::category.category').findOne({ where: { id: categoryId } });

    const data: SessionData = {
      ...session.sessionData,
      categoryId,
      categoryName: category?.name || 'Sin categoría',
    };

    const type     = data.transactionType!;
    const newState = type === 'expense' ? 'EXPENSE_ACCOUNT' : 'INCOME_ACCOUNT';
    await updateSession(session.id, { state: newState, sessionData: data });

    const accounts = await getUserAccounts(session.user.id);
    if (accounts.length === 0) {
      await sender.sendText(phoneNumber, '❌ No tienes cuentas. Ve a la app web para crear una cuenta.');
      await updateSession(session.id, { state: 'ADVISOR', sessionData: { currency: data.currency, advisorHistory: [] } });
      await sendAdvisorButtons(phoneNumber, '¿En qué más te puedo ayudar?', 'general');
      return;
    }

    // If only one account → skip selection and save directly
    if (accounts.length === 1) {
      const acc = accounts[0];
      const finalData: SessionData = { ...data, accountId: acc.id, accountName: acc.name };
      await updateSession(session.id, { sessionData: finalData });
      await saveTransaction(session, phoneNumber, finalData, null);
      return;
    }

    await sendAccountSelection(phoneNumber, accounts, data.categoryName!, data.amount!, data.currency!);
  }

  async function handleAccount(session: any, phoneNumber: string, input: string) {
    // Universal escape
    if (MENU_TRIGGERS.has(input.trim().toLowerCase())) {
      await updateSession(session.id, { state: 'ADVISOR', sessionData: { currency: session.sessionData?.currency, advisorHistory: [] } });
      await sendAdvisorButtons(phoneNumber, '¿En qué te puedo ayudar?', 'general');
      return;
    }

    if (!input.startsWith('acc_')) {
      const categoryName = session.sessionData?.categoryName || 'Categoría';
      const accounts     = await getUserAccounts(session.user.id);
      await sendAccountSelection(phoneNumber, accounts, categoryName, session.sessionData?.amount || 0, session.sessionData?.currency || '');
      return;
    }

    const accountId = parseInt(input.replace('acc_', ''), 10);
    const account   = await strapi.db.query('api::account.account').findOne({ where: { id: accountId } });

    const data: SessionData = {
      ...session.sessionData,
      accountId,
      accountName: account?.name || 'Sin cuenta',
    };

    // Save immediately — no extra notes step
    await saveTransaction(session, phoneNumber, data, null);
  }

  // ── Main entry point ───────────────────────────────────────────────────────

  return {
    async handle(phoneNumber: string, message: ParsedMessage): Promise<void> {
      let session = await getSession(phoneNumber);
      if (!session) {
        session = await createSession(phoneNumber);
      } else {
        await updateSession(session.id, {});
      }

      const { type: msgType, text: msgText, buttonId } = message;
      const input = msgType === 'text' ? msgText : buttonId;
      const state: string = session.state;

      strapi.log.debug(`[WhatsApp] phone=${phoneNumber} state=${state} input="${input}"`);

      // ── Universal escape: any mid-flow state → go to Advisor/Menu ──────────
      const isMidFlow = ['EXPENSE_AMOUNT','INCOME_AMOUNT','EXPENSE_CATEGORY','INCOME_CATEGORY','EXPENSE_ACCOUNT','INCOME_ACCOUNT'].includes(state);

      if (msgType === 'text' && session.user && isMidFlow && MENU_TRIGGERS.has(msgText.trim().toLowerCase())) {
        await updateSession(session.id, {
          state:       'ADVISOR',
          sessionData: { currency: session.sessionData?.currency, advisorHistory: [] },
        });
        await sendAdvisorButtons(
          phoneNumber,
          `¿En qué te puedo ayudar, ${session.user.username}? 💚`,
          'general'
        );
        return;
      }

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
              await sender.sendText(phoneNumber, `¿Cuánto ${label}? Escribe el monto (ej: *50*, *150.00*)`);
              return;
            }
            return await handleAmount(session, phoneNumber, msgText);

          case 'EXPENSE_CATEGORY':
          case 'INCOME_CATEGORY':
            return await handleCategory(session, phoneNumber, input);

          case 'EXPENSE_ACCOUNT':
          case 'INCOME_ACCOUNT':
            return await handleAccount(session, phoneNumber, input);

          default:
            // Estado desconocido → reset a Advisor
            strapi.log.warn(`[WhatsApp] Unknown state: ${state}, resetting`);
            if (session.user) {
              await updateSession(session.id, { state: 'ADVISOR', sessionData: { advisorHistory: [] } });
              await sendAdvisorButtons(phoneNumber, '¿En qué te puedo ayudar?', 'general');
            } else {
              await updateSession(session.id, { state: 'INIT', sessionData: {} });
              await sendWelcome(phoneNumber);
            }
        }
      } catch (err) {
        strapi.log.error('[WhatsApp] Unhandled error in conversation handler:', err);
        await sender.sendText(phoneNumber, '⚠️ Ocurrió un error. Escribe *hola* para continuar.');
      }
    },
  };
};
