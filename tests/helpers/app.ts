import { buildApp, type AppOptions } from '../../server/app.js';
import type { LibraryRepository } from '../../server/repositories/library-repository.js';
import type { Authentication } from '../../server/auth/service.js';

const authentication: Authentication = {
  authenticate: async () => ({ id: '11111111-1111-4111-8111-111111111111', username: 'fixture', lastLoginAt: null }),
  register: async () => { throw new Error('Use the authentication integration tests.'); },
  login: async () => { throw new Error('Use the authentication integration tests.'); },
  recover: async () => { throw new Error('Use the authentication integration tests.'); },
  changePassword: async () => { throw new Error('Use the authentication integration tests.'); },
  logout: async () => {},
};

/** Explicit test dependencies: no environment, driver, network or real database. */
export async function buildTestApp({ repository, ...options }: Pick<AppOptions, 'serveStatic'> & Partial<Pick<AppOptions, 'health'>> & { repository: LibraryRepository }) {
  const app = await buildApp({
    ...options, repositoryForUser: () => repository, authentication,
    health: options.health ?? { storage: 'postgres' },
  });
  // These tests exercise library contracts. Auth tests use buildApp directly, with no injected headers or identity.
  app.addHook('onRequest', async request => { request.headers['x-requested-with'] = 'KindleHighlights'; });
  return app;
}
