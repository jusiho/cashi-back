/**
 * WhatsApp Webhook Routes
 *
 * These routes are PUBLIC (auth: false) because Meta calls them directly
 * without any Strapi JWT token.
 *
 * Security is handled by:
 *   - GET: matching WHATSAPP_VERIFY_TOKEN env variable
 *   - POST: optional signature verification via X-Hub-Signature-256 header
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/whatsapp/webhook',
      handler: 'whatsapp-bot.verify',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
        // Bypass the users-permissions layer entirely
        tags: ['no-document-service-authorization'],
      },
    },
    {
      method: 'POST',
      path: '/whatsapp/webhook',
      handler: 'whatsapp-bot.receive',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
        tags: ['no-document-service-authorization'],
      },
    },
  ],
};
