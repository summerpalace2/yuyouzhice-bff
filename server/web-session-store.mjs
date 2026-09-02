import { randomBytes } from 'node:crypto';

// YUYOUZHICE_SESSION_TTL_MS is canonical; TOKEN_TTL_MS is legacy compatibility.
const DEFAULT_SESSION_TTL_MS = Math.max(1000, Number(process.env.YUYOUZHICE_SESSION_TTL_MS || process.env.YUYOUZHICE_TOKEN_TTL_MS || 7 * 24 * 60 * 60 * 1000));

function opaqueId(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function now() {
  return Date.now();
}

export function createWebSessionStore({ ttlMs = DEFAULT_SESSION_TTL_MS } = {}) {
  const sessions = new Map();

  function purgeExpired() {
    const current = now();
    for (const [id, session] of sessions) {
      if (!session || session.expiresAt <= current) sessions.delete(id);
    }
  }

  function create({ javaToken, user, tokenExpiresAt, csrfToken = opaqueId(24) } = {}) {
    if (!javaToken || !user?.id) throw new TypeError('Java authentication state is required.');
    purgeExpired();
    const issuedAt = now();
    const configuredExpiry = issuedAt + ttlMs;
    const boundedExpiry = Number.isFinite(tokenExpiresAt) && tokenExpiresAt > issuedAt
      ? Math.min(configuredExpiry, tokenExpiresAt)
      : configuredExpiry;
    const id = opaqueId();
    const session = {
      id,
      javaToken: String(javaToken),
      user: { ...user },
      csrfToken: String(csrfToken),
      issuedAt,
      lastSeenAt: issuedAt,
      expiresAt: boundedExpiry
    };
    sessions.set(id, session);
    return { ...session, user: { ...session.user } };
  }

  function get(id) {
    if (!id) return null;
    const session = sessions.get(String(id));
    if (!session) return null;
    if (session.expiresAt <= now()) {
      sessions.delete(String(id));
      return null;
    }
    session.lastSeenAt = now();
    return { ...session, user: { ...session.user } };
  }

  function update(id, patch = {}) {
    const current = get(id);
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
      id: current.id,
      csrfToken: patch.csrfToken || current.csrfToken,
      user: patch.user ? { ...patch.user } : current.user
    };
    sessions.set(current.id, next);
    return { ...next, user: { ...next.user } };
  }

  function rotate(id, patch = {}) {
    const current = get(id);
    if (!current) return null;
    sessions.delete(current.id);
    return create({
      javaToken: patch.javaToken || current.javaToken,
      user: patch.user || current.user,
      tokenExpiresAt: patch.tokenExpiresAt || current.expiresAt,
      csrfToken: patch.csrfToken || opaqueId(24)
    });
  }

  function destroy(id) {
    if (!id) return false;
    return sessions.delete(String(id));
  }

  function clear() {
    sessions.clear();
  }

  function size() {
    purgeExpired();
    return sessions.size;
  }

  return { create, get, update, rotate, destroy, clear, size, ttlMs };
}
