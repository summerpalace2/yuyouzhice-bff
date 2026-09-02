/**
 * persistent-store.mjs
 *
 * Core responsibility: persist account-scoped feedback and validate protected
 * runtime configuration. Java Core Backend owns users, Trips, history, and
 * typed Preferences; the legacy JSON fields remain read-only migration shape.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const STORE_VERSION = 1;

function emptyState() {
  return {
    version: STORE_VERSION,
    nextTripId: 1,
    users: [],
    tripsByUser: {},
    historyByUser: {},
    preferencesByUser: {},
    preferenceHistoryByUser: {},
    feedbackByUser: {},
    plannerDrafts: {},
    // BFF-owned UI continuity only. Java remains the authority for formal
    // Trips and account-level memories/preferences.
    tripWorkspaces: {}
  };
}

function protectSecret(value, secret) {
  if (!value || !secret) return '';
  const key = createHash('sha256').update(String(secret)).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function revealSecret(value, secret) {
  if (!value || !secret) return '';
  try {
    const [ivText, tagText, encryptedText] = String(value).split('.');
    if (!ivText || !tagText || !encryptedText) return '';
    const key = createHash('sha256').update(String(secret)).digest();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    return '';
  }
}

export async function createPersistentStore({ rootDir, filePath, enabled = true } = {}) {
  const configuredPath = filePath || path.join('data', 'yuyouzhice.json');
  const absolutePath = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(rootDir || process.cwd(), configuredPath);
  let state = emptyState();

  if (enabled) {
    try {
      state = JSON.parse(await readFile(absolutePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`无法读取持久化数据：${error.message}`);
    }
  }

  if (!state || state.version !== STORE_VERSION || !Array.isArray(state.users)) {
    throw new Error(`持久化数据版本不受支持：${absolutePath}`);
  }

  // This is a protected persistent-store configuration guard only. The
  // current Web session, Cookie, and CSRF implementations use independent
  // random values and do not use this value for signing or encryption.
  const configuredAuthSecret = String(process.env.YUYOUZHICE_AUTH_SECRET || '').trim();
  if (configuredAuthSecret && configuredAuthSecret.length < 32) throw new Error('YUYOUZHICE_AUTH_SECRET 至少需要 32 个字符。');
  if (enabled && configuredAuthSecret.length < 32) {
    throw new Error('持久化模式必须通过受保护配置设置 YUYOUZHICE_AUTH_SECRET（至少 32 个字符）。');
  }
  // Legacy JSON files may contain authSecret. It is deliberately ignored: the
  // signing key is configuration-only and must never be recovered from data.
  const hasLegacyAuthSecret = Object.prototype.hasOwnProperty.call(state, 'authSecret');
  const authSecret = configuredAuthSecret.length >= 32
    ? configuredAuthSecret
    : randomBytes(32).toString('base64url');
  const feedbackByUser = new Map(Object.entries(state.feedbackByUser || {}).map(([userId, values]) => [userId, Array.isArray(values) ? values : []]));
  // Planner drafts are server-side compatibility records. Java remains the
  // authority for the actual Planner Session and formal Trip state.
  const plannerDrafts = new Map(Object.entries(state.plannerDrafts || {}).map(([sessionId, value]) => [sessionId, value]));
  const tripWorkspaces = new Map(Object.entries(state.tripWorkspaces || {}).map(([workspaceId, value]) => [workspaceId, value]));
  let writeQueue = Promise.resolve();

  async function writeState(nextState) {
    if (!enabled) return;
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const tempPath = `${absolutePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
    await rename(tempPath, absolutePath);
  }

  async function writeNow() {
    await writeState({
      version: STORE_VERSION,
      nextTripId: 1,
      // These fields are retained as an explicit migration-compatible shape,
      // but Node never restores or mutates their Java-owned contents.
      users: [],
      tripsByUser: {},
      historyByUser: {},
      preferencesByUser: {},
      preferenceHistoryByUser: {},
      feedbackByUser: Object.fromEntries(feedbackByUser),
      plannerDrafts: Object.fromEntries(plannerDrafts),
      tripWorkspaces: Object.fromEntries(tripWorkspaces)
    });
  }

  function persist() {
    writeQueue = writeQueue.then(writeNow);
    return writeQueue;
  }

  if (enabled && hasLegacyAuthSecret) {
    // Remove only the forbidden embedded signing key while preserving the
    // read-only legacy migration payload until an explicit migration writes it.
    const cleaned = { ...state };
    delete cleaned.authSecret;
    await writeState(cleaned);
  }

  return {
    enabled,
    filePath: absolutePath,
    // Retained for compatibility with the existing store shape; no current
    // authentication path consumes this configuration guard as crypto.
    authSecret,
    storageLabel: enabled ? '持久化 JSON 存储（反馈与 BFF 规划会话映射；Java 负责账号/行程/偏好）' : '内存测试存储（仅反馈）',
    feedbackByUser,
    tripWorkspaces,
    getTripWorkspace(userId, formalTripId) {
      const owner = String(userId || '').trim();
      const tripId = String(formalTripId || '').trim();
      if (!owner || !tripId) return null;
      const value = tripWorkspaces.get(`${owner}:${tripId}`);
      return value ? structuredClone(value) : null;
    },
    saveTripWorkspace({ userId, formalTripId, workspace } = {}) {
      const owner = String(userId || '').trim();
      const tripId = String(formalTripId || '').trim();
      if (!owner || !tripId) return Promise.resolve(null);
      const source = workspace && typeof workspace === 'object' ? workspace : {};
      const previous = tripWorkspaces.get(`${owner}:${tripId}`) || {};
      const messages = Array.isArray(source.chatMessages)
        ? source.chatMessages.slice(-160).map((message) => ({
          role: message?.role === 'user' ? 'user' : 'assistant',
          content: String(message?.content || '').slice(0, 12000),
          pending: false,
          error: message?.error ? String(message.error).slice(0, 500) : undefined
        })).filter((message) => message.content || message.error)
        : (Array.isArray(previous.chatMessages) ? previous.chatMessages : []);
      const value = {
        ownerUserId: owner,
        formalTripId: tripId,
        chatMessages: messages,
        chatMode: source.chatMode === undefined
          ? (previous.chatMode === 'planner' ? 'planner' : 'chat')
          : (source.chatMode === 'planner' ? 'planner' : 'chat'),
        plannerConversationContext: source.plannerConversationContext === undefined
          ? (previous.plannerConversationContext || null)
          : (source.plannerConversationContext && typeof source.plannerConversationContext === 'object'
            ? structuredClone(source.plannerConversationContext)
            : null),
        itineraryMemorySnapshot: source.itineraryMemorySnapshot === undefined
          ? (previous.itineraryMemorySnapshot || null)
          : (source.itineraryMemorySnapshot && typeof source.itineraryMemorySnapshot === 'object'
            ? structuredClone(source.itineraryMemorySnapshot)
            : null),
        updatedAt: new Date().toISOString()
      };
      tripWorkspaces.set(`${owner}:${tripId}`, value);
      return persist().then(() => structuredClone(value));
    },
    deleteTripWorkspace(userId, formalTripId) {
      const owner = String(userId || '').trim();
      const tripId = String(formalTripId || '').trim();
      if (!owner || !tripId) return Promise.resolve();
      tripWorkspaces.delete(`${owner}:${tripId}`);
      return persist();
    },
    getPlannerDraft(sessionId) {
      const value = plannerDrafts.get(String(sessionId || ''));
      if (!value) return null;
      const draft = structuredClone(value);
      draft.sessionAccessToken = revealSecret(draft.sessionAccessTokenEncrypted, authSecret);
      delete draft.sessionAccessTokenEncrypted;
      return draft;
    },
    savePlannerDraft(session) {
      const id = String(session?.id || '').trim();
      if (!id) return Promise.resolve();
      plannerDrafts.set(id, structuredClone({
        id,
        input: session.input || '',
        trip: session.trip || null,
        shadow: null,
        candidateSource: session.candidateSource || null,
        candidateAppliedPreferences: session.candidateAppliedPreferences || [],
        constraints: session.constraints || {},
        preferencesApplied: session.preferencesApplied || [],
        createdAt: session.createdAt || new Date().toISOString(),
        updatedAt: session.updatedAt || new Date().toISOString(),
        syncRevision: Number(session.syncRevision || 1),
        replanHistory: session.replanHistory || [],
        feedback: [],
        userId: session.userId || null,
        deviceId: session.deviceId || null,
        formalTripId: session.formalTripId || null,
        // Proposal contents are non-secret UI/session state. Java remains
        // authoritative for proposal validity; this snapshot only restores
        // the pending preview after a BFF restart.
        chatProposal: session.chatProposal || null,
        plannerConversationContext: session.plannerConversationContext || null,
        itineraryMemorySnapshot: session.itineraryMemorySnapshot || null,
        javaSessionId: session.javaSessionId || null,
        sessionAccessTokenEncrypted: protectSecret(session.sessionAccessToken || '', authSecret),
        legacyMode: Boolean(session.legacyMode),
        adjustmentCapability: session.adjustmentCapability || 'LEGACY',
        plannerVersion: session.plannerVersion || null,
        policyVersion: session.policyVersion || null,
        routeDataStatus: session.routeDataStatus || null,
        explanationSource: session.explanationSource || null,
        degraded: Boolean(session.degraded),
        degradationReasons: session.degradationReasons || []
      }));
      return persist();
    },
    deletePlannerDraft(sessionId) {
      plannerDrafts.delete(String(sessionId || ''));
      return persist();
    },
    clearPlannerDrafts() {
      plannerDrafts.clear();
      return persist();
    },
    persist,
    async flush() { await writeQueue; }
  };
}
