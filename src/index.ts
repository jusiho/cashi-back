import type { Core } from '@strapi/strapi';

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await grantAuthenticatedPermissions(strapi);
  },
};

/**
 * Ensures the "authenticated" role can access all custom API actions.
 * Runs on every startup — safe to re-run, skips already-granted permissions.
 */
async function grantAuthenticatedPermissions(strapi: Core.Strapi) {
  // Actions that must be accessible by authenticated users
  const requiredActions = [
    'api::account.account.summary',
    'api::transaction.transaction.stats',
  ];

  try {
    // Find the authenticated role
    const authenticatedRole = await (strapi.db as any)
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'authenticated' } });

    if (!authenticatedRole) {
      strapi.log.warn('[bootstrap] Could not find authenticated role');
      return;
    }

    // Get existing permissions for this role
    const existingPerms = await (strapi.db as any)
      .query('plugin::users-permissions.permission')
      .findMany({ where: { role: { id: authenticatedRole.id } } });

    const existingActions = new Set((existingPerms as any[]).map((p: any) => p.action));

    for (const action of requiredActions) {
      if (!existingActions.has(action)) {
        await (strapi.db as any)
          .query('plugin::users-permissions.permission')
          .create({ data: { action, role: authenticatedRole.id } });
        strapi.log.info(`[bootstrap] Granted permission: ${action}`);
      }
    }
  } catch (err) {
    strapi.log.warn('[bootstrap] Failed to set permissions:', err);
  }
}
