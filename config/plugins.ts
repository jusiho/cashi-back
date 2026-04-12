import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  graphql: {
    enabled: true,
    config: {
      endpoint: '/graphql',
      shadowCRUD: true,
      playgroundAlways: env('NODE_ENV') === 'development',
      depthLimit: 7,
      amountLimit: 100,
      apolloServer: {
        tracing: false,
      },
    },
  },

  email: {
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host:   env('SMTP_HOST', 'smtp.gmail.com'),
        port:   env.int('SMTP_PORT', 587),
        secure: env.bool('SMTP_SECURE', false), // true para puerto 465
        auth: {
          user: env('SMTP_USER'),
          pass: env('SMTP_PASS'),
        },
      },
      settings: {
        defaultFrom:    env('SMTP_FROM', env('SMTP_USER')),
        defaultReplyTo: env('SMTP_REPLY_TO', env('SMTP_USER')),
      },
    },
  },
});

export default config;
