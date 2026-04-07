/**
 * AI Service — OpenAI integration
 *
 * Two modes:
 *   1. parseIntent   → structured intent extraction (for free-text in main menu)
 *   2. askAdvisor    → generative financial advisor with conversation history
 */

import OpenAI from 'openai';

// ─── Types ───────────────────────────────────────────────────────────────────

export type IntentType =
  | 'register_expense'
  | 'register_income'
  | 'view_balance'
  | 'view_summary'
  | 'general_question'
  | 'unknown';

export interface AIIntent {
  intent: IntentType;
  amount?: number;
  category_name?: string;
  account_name?: string;
  description?: string;
  answer?: string; // for general_question: AI answers directly
}

export interface UserContext {
  name: string;
  accounts: Array<{ name: string; balance: number; currency: string }>;
  categories: Array<{ name: string; type: string }>;
}

export interface AdvisorContext extends UserContext {
  recentTransactions: Array<{
    type: string;
    amount: number;
    category: string;
    date: string;
  }>;
  monthlyExpenses: number;
  monthlyIncome: number;
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

// ─── Tool definition for structured output ───────────────────────────────────

const PARSE_INTENT_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'handle_financial_request',
    description: 'Parse the user message and extract the financial intent and data.',
    parameters: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['register_expense', 'register_income', 'view_balance', 'view_summary', 'general_question', 'unknown'],
          description: 'What the user wants to do',
        },
        amount: {
          type: 'number',
          description: 'Transaction amount if mentioned',
        },
        category_name: {
          type: 'string',
          description: 'Category name that best matches from the user\'s categories list',
        },
        account_name: {
          type: 'string',
          description: 'Account name that best matches from the user\'s accounts list',
        },
        description: {
          type: 'string',
          description: 'Short description of the transaction',
        },
        answer: {
          type: 'string',
          description: 'For general_question intent: a friendly, concise answer in Spanish',
        },
      },
      required: ['intent'],
    },
  },
};

// ─── Service factory ─────────────────────────────────────────────────────────

export default ({ strapi }) => {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  return {
    /**
     * Parse a free-form user message into a structured financial intent.
     * Uses GPT-4o-mini with function calling for reliable structured output.
     */
    async parseIntent(userMessage: string, context: UserContext): Promise<AIIntent> {
      if (!process.env.OPENAI_API_KEY) {
        strapi.log.warn('[AI] OPENAI_API_KEY not set, skipping AI parsing');
        return { intent: 'unknown' };
      }

      const accountsText = context.accounts.length
        ? context.accounts.map((a) => `• ${a.name}: ${a.balance.toFixed(2)} ${a.currency}`).join('\n')
        : '• Sin cuentas';

      const categoriesExpense = context.categories
        .filter((c) => c.type === 'expense' || c.type === 'both')
        .map((c) => c.name)
        .join(', ');

      const categoriesIncome = context.categories
        .filter((c) => c.type === 'income' || c.type === 'both')
        .map((c) => c.name)
        .join(', ');

      const systemPrompt = `Eres el asistente financiero de Cashi para ${context.name}.

CUENTAS DEL USUARIO:
${accountsText}

CATEGORÍAS DE GASTO: ${categoriesExpense || 'Comida, Transporte, Salud, Entretenimiento'}
CATEGORÍAS DE INGRESO: ${categoriesIncome || 'Salario, Freelance, Inversiones'}

INSTRUCCIONES:
- Analiza el mensaje y determina qué quiere hacer el usuario.
- Si menciona un gasto, extrae monto, categoría más cercana y cuenta si la menciona.
- Si menciona un ingreso, extrae monto, categoría y cuenta.
- Infiere la categoría aunque no sea exacta (ej: "almuerzo" → "Comida", "uber" → "Transporte").
- Si pregunta por su balance o saldo, usa intent: view_balance.
- Si pregunta por resumen o estadísticas del mes, usa intent: view_summary.
- Para preguntas generales de finanzas personales, responde brevemente en español.
- Si no entiendes o no es financiero, usa intent: unknown.`;

      try {
        const response = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          tools: [PARSE_INTENT_TOOL],
          tool_choice: { type: 'function', function: { name: 'handle_financial_request' } },
          max_tokens: 300,
          temperature: 0.1, // Low temperature for consistent structured output
        });

        const toolCall = response.choices[0]?.message?.tool_calls?.[0];
        if (!toolCall || toolCall.type !== 'function') return { intent: 'unknown' };

        const parsed = JSON.parse(toolCall.function.arguments) as AIIntent;
        strapi.log.debug(`[AI] Parsed intent: ${JSON.stringify(parsed)}`);
        return parsed;
      } catch (err) {
        strapi.log.error('[AI] OpenAI error:', err);
        return { intent: 'unknown' };
      }
    },

    /**
     * Generative financial advisor.
     * Maintains conversation history and has full access to user's financial data.
     * Returns a natural language response in Spanish.
     */
    async askAdvisor(
      userMessage: string,
      context: AdvisorContext,
      history: ChatMessage[]
    ): Promise<string> {
      if (!process.env.OPENAI_API_KEY) {
        return '⚠️ El asesor no está disponible en este momento.';
      }

      const accountsText = context.accounts.length
        ? context.accounts
            .map((a) => `  • ${a.name}: ${a.balance.toFixed(2)} ${a.currency}`)
            .join('\n')
        : '  • Sin cuentas registradas';

      const txText = context.recentTransactions.length
        ? context.recentTransactions
            .map((t) => `  • ${t.date} | ${t.type === 'expense' ? '💸' : '💰'} ${t.type === 'expense' ? '-' : '+'}${t.amount.toFixed(2)} | ${t.category}`)
            .join('\n')
        : '  • Sin transacciones recientes';

      const systemPrompt = `Eres *Cashi*, un asesor financiero personal inteligente y empático que habla por WhatsApp.
Estás hablando con *${context.name}*.

━━━ SITUACIÓN FINANCIERA ACTUAL ━━━
CUENTAS:
${accountsText}

ESTE MES:
  • Total ingresos: ${context.monthlyIncome.toFixed(2)}
  • Total gastos:   ${context.monthlyExpenses.toFixed(2)}
  • Balance neto:   ${(context.monthlyIncome - context.monthlyExpenses).toFixed(2)}

ÚLTIMAS TRANSACCIONES:
${txText}

━━━ INSTRUCCIONES ━━━
- Responde SIEMPRE en español, de forma amigable, clara y concisa.
- Usa formato WhatsApp: *negrita* para énfasis, _cursiva_ para términos.
- Máximo 4-5 oraciones por respuesta. Si el tema es complejo, ve por partes.
- Basa tus consejos en los datos reales del usuario, no en generalidades.
- Puedes hacer preguntas de seguimiento para entender mejor su situación.
- Si detectas un patrón preocupante en los datos (gastos altos, saldo bajo), menciónalo.
- Termina con una sugerencia o pregunta cuando sea relevante.
- NO repitas la información financiera a menos que sea necesaria para la respuesta.
- Si el usuario quiere registrar un gasto/ingreso dile que use los botones del menú principal.`;

      try {
        // Keep last 10 messages (5 exchanges) for context window efficiency
        const trimmedHistory = history.slice(-10);

        const response = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            ...trimmedHistory,
            { role: 'user', content: userMessage },
          ],
          max_tokens: 400,
          temperature: 0.7,
        });

        return response.choices[0]?.message?.content?.trim() ||
          '🤔 No pude generar una respuesta. Por favor intenta de nuevo.';
      } catch (err) {
        strapi.log.error('[AI] Advisor error:', err);
        return '⚠️ El asesor tuvo un problema. Por favor intenta en un momento.';
      }
    },
  };
};
