/**
 * OTP Service — WhatsApp login codes
 *
 * Generates a 6-digit code, stores it in the whatsapp-session
 * and sends it via WhatsApp free-text message.
 * Code expires in 10 minutes.
 */

import sender from './sender';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default ({ strapi }) => ({

  async requestOtp(phoneNumber: string): Promise<{ ok: boolean; error?: string }> {
    // Find or create session
    let session = await strapi.db.query('api::whatsapp-bot.whatsapp-session').findOne({
      where: { phoneNumber },
      populate: ['user'],
    });

    if (!session) {
      session = await strapi.db.query('api::whatsapp-bot.whatsapp-session').create({
        data: {
          phoneNumber,
          state: 'INIT',
          sessionData: {},
          lastActivity: new Date(),
        },
      });
    }

    const code = generateCode();
    const expiry = new Date(Date.now() + OTP_TTL_MS).toISOString();

    await strapi.db.query('api::whatsapp-bot.whatsapp-session').update({
      where: { id: session.id },
      data: {
        sessionData: {
          ...(session.sessionData || {}),
          otp: code,
          otpExpiry: expiry,
        },
        lastActivity: new Date(),
      },
    });

    try {
      await sender.sendText(
        phoneNumber,
        `🔐 *Tu código de verificación Cashi es:*\n\n` +
        `*${code}*\n\n` +
        `⏱ Válido por 10 minutos. No lo compartas con nadie.`
      );
    } catch (err: any) {
      strapi.log.error('[OTP] Error sending WhatsApp message:', err.message);
      return { ok: false, error: 'No se pudo enviar el código por WhatsApp. Verifica que el número sea correcto.' };
    }

    return { ok: true };
  },

  async verifyOtp(phoneNumber: string, code: string): Promise<{
    ok: boolean;
    jwt?: string;
    user?: any;
    needsRegistration?: boolean;
    error?: string;
  }> {
    const session = await strapi.db.query('api::whatsapp-bot.whatsapp-session').findOne({
      where: { phoneNumber },
      populate: ['user'],
    });

    if (!session) {
      return { ok: false, error: 'Número no encontrado. Solicita un nuevo código.' };
    }

    const { otp, otpExpiry } = session.sessionData || {};

    if (!otp || !otpExpiry) {
      return { ok: false, error: 'No hay código activo. Solicita uno nuevo.' };
    }

    if (new Date() > new Date(otpExpiry)) {
      return { ok: false, error: 'El código expiró. Solicita uno nuevo.' };
    }

    if (code.trim() !== otp) {
      return { ok: false, error: 'Código incorrecto.' };
    }

    // Clear OTP after use
    await strapi.db.query('api::whatsapp-bot.whatsapp-session').update({
      where: { id: session.id },
      data: {
        sessionData: { ...session.sessionData, otp: null, otpExpiry: null },
        lastActivity: new Date(),
      },
    });

    // No user linked → needs registration
    if (!session.user) {
      return { ok: true, needsRegistration: true };
    }

    // Generate JWT for the linked user
    const jwt = await strapi
      .plugin('users-permissions')
      .service('jwt')
      .issue({ id: session.user.id });

    return { ok: true, jwt, user: session.user };
  },
});
