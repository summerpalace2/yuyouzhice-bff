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

  function persistedState(draftState = plannerDrafts, workspaceState = tripWorkspaces) {
    return {
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
      plannerDrafts: Object.fromEntries(draftState),
      tripWorkspaces: Object.fromEntries(workspaceState)
    };
  }

  async function writeNow() {
    await writeState(persistedState());
  }

  function enqueueWrite(operation) {
    // Keep surfacing this write's error to its caller, but let a later write
    // recover the queue instead of inheriting a permanently rejected promise.
    writeQueue = writeQueue.catch(() => {}).then(operation);
    return writeQueue;
  }

  function persist() {
    return enqueueWrite(writeNow);
  }

  function createPlannerDraft(session) {
    const id = String(session?.id || '').trim();
    if (!id) return null;
    return structuredClone({
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
      // Proposal state is only a BFF restart snapshot; Java owns proposal validity.
      chatProposal: session.chatProposal || null,
      plannerConversationContext: session.plannerConversationContext || null,
      chatEpoch: session.chatEpoch || null,
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
    });
  }

  function createTripWorkspace({ userId, formalTripId, workspace, expectedRevision, expectedEpoch, reset = false } = {}, workspaces) {
    const owner = String(userId || '').trim();
    const tripId = String(formalTripId || '').trim();
    if (!owner || !tripId) return null;
    const source = workspace && typeof workspace === 'object' ? structuredClone(workspace) : {};
    const key = `${owner}:${tripId}`;
    const previous = workspaces.get(key);
    const current = previous || {};
    const revision = Number(current.workspaceRevision || 0);
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision)
        || expectedRevision !== revision || !expectedEpoch || expectedEpoch !== current.chatEpoch)) {
      const error = new Error('对话工作区已更新，请重新打开行程后再保存。');
      error.status = 409; error.code = 'TRIP_WORKSPACE_CONFLICT';
      error.workspace = Object.keys(current).length ? structuredClone(current) : null;
      throw error;
    }
    const messages = reset ? [] : Array.isArray(source.chatMessages)
      ? source.chatMessages.slice(-160).map((message) => ({
        role: message?.role === 'user' ? 'user' : 'assistant',
        content: String(message?.content || '').slice(0, 12000),
        pending: false,
        error: message?.error ? String(message.error).slice(0, 500) : undefined
      })).filter((message) => message.content || message.error)
      : (Array.isArray(current.chatMessages) ? current.chatMessages : []);
    const value = {
      ownerUserId: owner,
      formalTripId: tripId,
      workspaceRevision: revision + (reset || source.chatMessages !== undefined || source.chatMode !== undefined || !current.chatEpoch ? 1 : 0),
      chatMessages: messages,
      chatMode: source.chatMode === undefined
        ? (current.chatMode === 'agent' ? 'agent' : (current.chatMode === 'planner' ? 'planner' : 'chat'))
        : (source.chatMode === 'agent' ? 'agent' : (source.chatMode === 'planner' ? 'planner' : 'chat')),
      chatEpoch: source.chatEpoch === undefined ? (current.chatEpoch || null) : (String(source.chatEpoch || '').slice(0,64) || null),
      plannerConversationContext: source.plannerConversationContext === undefined
        ? (current.plannerConversationContext || null)
        : (source.plannerConversationContext && typeof source.plannerConversationContext === 'object'
          ? structuredClone(source.plannerConversationContext)
          : null),
      itineraryMemorySnapshot: source.itineraryMemorySnapshot === undefined
        ? (current.itineraryMemorySnapshot || null)
        : (source.itineraryMemorySnapshot && typeof source.itineraryMemorySnapshot === 'object'
          ? structuredClone(source.itineraryMemorySnapshot)
          : null),
      updatedAt: new Date().toISOString()
    };
    workspaces.set(key, value);
    return structuredClone(value);
  }

  function mutatePlannerStateAndPersist(mutate) {
    return enqueueWrite(async () => {
      const draftState = new Map(plannerDrafts);
      const workspaceState = new Map(tripWorkspaces);
      const result = mutate(draftState, workspaceState);
      // Getters continue reading committed Maps while this candidate snapshot
      // is written. Commit both maps only after the atomic rename succeeds.
      await writeState(persistedState(draftState, workspaceState));
      plannerDrafts.clear();
      for (const [key, value] of draftState) plannerDrafts.set(key, value);
      tripWorkspaces.clear();
      for (const [key, value] of workspaceState) tripWorkspaces.set(key, value);
      return result;
    });
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
    saveTripWorkspace({ userId, formalTripId, workspace, expectedRevision, expectedEpoch, reset = false } = {}) {
      const input = { userId, formalTripId, workspace, expectedRevision, expectedEpoch, reset };
      if (!String(userId || '').trim() || !String(formalTripId || '').trim()) return Promise.resolve(null);
      return mutatePlannerStateAndPersist((_drafts, workspaces) => {
        return createTripWorkspace(input, workspaces);
      });
    },
    deleteTripWorkspace(userId, formalTripId) {
      const owner = String(userId || '').trim();
      const tripId = String(formalTripId || '').trim();
      if (!owner || !tripId) return Promise.resolve();
      const key = `${owner}:${tripId}`;
      return mutatePlannerStateAndPersist((_drafts, workspaces) => {
        workspaces.delete(key);
      });
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
      const draft = createPlannerDraft(session);
      if (!draft) return Promise.resolve();
      return mutatePlannerStateAndPersist((draftState) => {
        draftState.set(draft.id, draft);
      });
    },
    savePlannerOpenState(session) {
      const owner = String(session?.userId || '').trim();
      const formalTripId = String(session?.formalTripId || '').trim();
      if (!owner || !formalTripId || !String(session?.id || '').trim()) {
        throw new Error('规划行程打开状态缺少有效会话或工作区归属。');
      }
      // Open is one local transaction: neither synchronous getter can observe
      // one half while the combined JSON snapshot is waiting for rename. Read
      // continuity fields at the queue head, after prior writes commit, so an
      // earlier queued chat PUT cannot be overwritten by a stale Open snapshot.
      return mutatePlannerStateAndPersist((drafts, workspaces) => {
        const workspaceKey = `${owner}:${formalTripId}`;
        const currentWorkspace = workspaces.get(workspaceKey);
        if (currentWorkspace) {
          session.plannerConversationContext = currentWorkspace.plannerConversationContext || null;
          session.chatEpoch = currentWorkspace.chatEpoch || session.chatEpoch || null;
        }
        const workspaceWrite = {
          userId: owner,
          formalTripId,
          workspace: {
            plannerConversationContext: session.plannerConversationContext || null,
            chatEpoch: session.chatEpoch || null,
            itineraryMemorySnapshot: session.itineraryMemorySnapshot || null
          }
        };
        const draft = createPlannerDraft(session);
        if (!draft) {
          throw new Error('规划行程打开状态缺少有效会话或工作区归属。');
        }
        if (String(draft.userId || '').trim() !== String(workspaceWrite.userId).trim()
            || String(draft.formalTripId || '').trim() !== String(workspaceWrite.formalTripId).trim()
            || String(workspaceWrite.userId).trim() !== owner
            || String(workspaceWrite.formalTripId).trim() !== formalTripId) {
          throw new Error('规划行程打开状态的会话与工作区归属不一致。');
        }
        drafts.set(draft.id, draft);
        const workspace = createTripWorkspace(workspaceWrite, workspaces);
        return { draft: structuredClone(draft), workspace };
      });
    },
    deletePlannerDraft(sessionId) {
      const id = String(sessionId || '');
      return mutatePlannerStateAndPersist((draftState) => {
        draftState.delete(id);
      });
    },
    clearPlannerDrafts() {
      return mutatePlannerStateAndPersist((draftState) => {
        draftState.clear();
      });
    },
    persist,
    async flush() { await writeQueue; }
  };
}
