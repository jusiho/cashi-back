/**
 * WhatsApp Cloud API sender
 * Handles all HTTP calls to the Meta WhatsApp Business API
 */

const WA_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v19.0';
const WA_BASE_URL = `https://graph.facebook.com/${WA_API_VERSION}`;

interface Button {
  id: string;
  title: string;
}

interface ListRow {
  id: string;
  title: string;
  description?: string;
}

interface ListSection {
  title?: string;
  rows: ListRow[];
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.substring(0, n - 1) + '…' : s;
}

async function post(payload: object): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;

  if (!phoneNumberId || !token) {
    throw new Error('Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN env variables');
  }

  const bodyStr = JSON.stringify(payload);
  console.log('[WA SEND]', bodyStr);

  const response = await fetch(`${WA_BASE_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: bodyStr,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WhatsApp API ${response.status}: ${error}`);
  }
}

const sender = {
  /**
   * Send a plain text message
   */
  async sendText(to: string, text: string): Promise<void> {
    await post({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text, preview_url: false },
    });
  },

  /**
   * Send an interactive message with up to 3 quick-reply buttons
   */
  async sendButtons(to: string, bodyText: string, buttons: Button[]): Promise<void> {
    if (buttons.length > 3) {
      throw new Error('WhatsApp button messages support a maximum of 3 buttons');
    }

    await post({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map((btn) => ({
            type: 'reply',
            reply: {
              id: btn.id,
              title: trunc(btn.title, 20),
            },
          })),
        },
      },
    });
  },

  /**
   * Send an interactive list message (up to 10 items per section)
   */
  async sendList(
    to: string,
    bodyText: string,
    buttonLabel: string,
    sections: ListSection[]
  ): Promise<void> {
    await post({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: trunc(buttonLabel, 20),
          sections: sections.map((s) => ({
            title: s.title ? trunc(s.title, 24) : undefined,
            rows: s.rows.map((r) => ({
              id: r.id,
              title: trunc(r.title, 24),
              description: r.description ? trunc(r.description, 72) : undefined,
            })),
          })),
        },
      },
    });
  },
};

export default sender;
