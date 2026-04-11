/**
 * WhatsApp Webhook Controller
 *
 * GET  /api/whatsapp/webhook  → Meta webhook verification (hub.challenge)
 * POST /api/whatsapp/webhook  → Receive incoming messages from WhatsApp
 */

import type { Core } from '@strapi/strapi';
import type { ParsedMessage } from '../services/conversation';

declare const strapi: Core.Strapi;

export default {
  /**
   * POST /api/auth/whatsapp/request
   * { phone } → sends OTP via WhatsApp
   */
  async requestOtp(ctx) {
    const { phone } = ctx.request.body as { phone?: string };
    if (!phone) return ctx.badRequest('phone is required');

    const otpService = strapi.service('api::whatsapp-bot.otp');
    const result = await otpService.requestOtp(phone.trim());

    if (!result.ok) {
      return ctx.badRequest(result.error);
    }

    ctx.body = { ok: true };
  },

  /**
   * POST /api/auth/whatsapp/verify
   * { phone, code } → verifies OTP, returns JWT + user
   */
  async verifyOtp(ctx) {
    const { phone, code } = ctx.request.body as { phone?: string; code?: string };
    if (!phone || !code) return ctx.badRequest('phone and code are required');

    const otpService = strapi.service('api::whatsapp-bot.otp');
    const result = await otpService.verifyOtp(phone.trim(), code.trim());

    if (!result.ok) {
      return ctx.badRequest(result.error);
    }

    ctx.body = result;
  },

  /**
   * GET /api/whatsapp/me
   * Returns the WhatsApp session linked to the current user.
   */
  async getMySession(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized();

    const session = await strapi.db.query('api::whatsapp-bot.whatsapp-session').findOne({
      where: { user: userId },
    });

    ctx.body = {
      linked: !!session,
      phoneNumber: session?.phoneNumber ?? null,
      lastActivity: session?.lastActivity ?? null,
    };
  },

  /**
   * DELETE /api/whatsapp/me
   * Unlinks (resets) the WhatsApp session for the current user.
   */
  async unlinkSession(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized();

    const session = await strapi.db.query('api::whatsapp-bot.whatsapp-session').findOne({
      where: { user: userId },
    });

    if (!session) {
      ctx.body = { ok: true, message: 'No había sesión vinculada.' };
      return;
    }

    // Reset session: remove user link and go back to INIT
    await strapi.db.query('api::whatsapp-bot.whatsapp-session').update({
      where: { id: session.id },
      data: { user: null, state: 'INIT', sessionData: {} },
    });

    ctx.body = { ok: true };
  },

  /**
   * Meta webhook verification.
   * Meta sends a GET request with hub.mode, hub.verify_token, and hub.challenge.
   * We must return hub.challenge if the verify token matches.
   */
  async verify(ctx) {
    const {
      'hub.mode': mode,
      'hub.verify_token': token,
      'hub.challenge': challenge,
    } = ctx.query as Record<string, string>;

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      ctx.status = 200;
      ctx.body = challenge;
      return;
    }

    ctx.status = 403;
    ctx.body = 'Forbidden';
  },

  /**
   * Receive incoming WhatsApp messages.
   * Meta sends a POST with the full webhook payload.
   * We must return 200 immediately, then process asynchronously.
   */
  async receive(ctx) {
    // Always acknowledge immediately — Meta retries if we don't respond within 20s
    ctx.status = 200;
    ctx.body = 'OK';

    const body = ctx.request.body as any;

    // Validate it's a WhatsApp Business Account event
    if (body?.object !== 'whatsapp_business_account') return;

    const changes = body.entry?.[0]?.changes;
    if (!Array.isArray(changes)) return;

    for (const change of changes) {
      const value = change?.value;
      if (!value?.messages?.length) continue; // Ignore status updates, read receipts, etc.

      for (const msg of value.messages) {
        const phoneNumber: string = msg.from;
        if (!phoneNumber) continue;

        const parsed = parseMessage(msg);
        if (parsed.type === 'unknown') {
          strapi.log.debug(`[WhatsApp] Unsupported message type: ${msg.type} from ${phoneNumber}`);
          continue;
        }

        // Process message (fire-and-forget; errors are caught inside the service)
        strapi
          .service('api::whatsapp-bot.conversation')
          .handle(phoneNumber, parsed)
          .catch((err) => {
            strapi.log.error('[WhatsApp] Failed to handle message:', err);
          });
      }
    }
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseMessage(msg: any): ParsedMessage {
  if (msg.type === 'text') {
    return {
      type: 'text',
      text: msg.text?.body?.trim() || '',
      buttonId: '',
    };
  }

  if (msg.type === 'interactive') {
    const interactive = msg.interactive;

    if (interactive?.type === 'button_reply') {
      return {
        type: 'button_reply',
        text: interactive.button_reply?.title || '',
        buttonId: interactive.button_reply?.id || '',
      };
    }

    if (interactive?.type === 'list_reply') {
      return {
        type: 'list_reply',
        text: interactive.list_reply?.title || '',
        buttonId: interactive.list_reply?.id || '',
      };
    }
  }

  return { type: 'unknown', text: '', buttonId: '' };
}
