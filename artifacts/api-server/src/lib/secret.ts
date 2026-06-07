/**
 * Single source of truth for the app secret used to sign JWTs (auth, OAuth state)
 * and to derive encryption keys for secrets at rest (Google Drive credentials /
 * refresh tokens). Fails fast at startup if SESSION_SECRET is missing so we never
 * silently fall back to a predictable, forgeable key.
 */
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length === 0) {
  throw new Error(
    "SESSION_SECRET is required but not set. Refusing to start with an insecure default — " +
      "set SESSION_SECRET in the environment before running the API server.",
  );
}

export const APP_SECRET: string = SESSION_SECRET;
