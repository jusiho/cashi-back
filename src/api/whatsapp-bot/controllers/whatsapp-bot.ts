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
