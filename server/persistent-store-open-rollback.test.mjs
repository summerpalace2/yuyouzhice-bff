import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';
import { createPersistentStore } from './persistent-store.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function withRenameStub(implementation, action) {
  const renameMock = mock.method(fs, 'rename', implementation);
  syncBuiltinESMExports();
  try {
    return await action();
  } finally {
    renameMock.mock.restore();
    syncBuiltinESMExports();
  }
}

test('sync getters expose only committed planner state while rename is pending or fails', async () => {
  const originalSecret = process.env.YUYOUZHICE_AUTH_SECRET;
  process.env.YUYOUZHICE_AUTH_SECRET = '0123456789abcdef0123456789abcdef';
  const root = await mkdtemp(path.join(os.tmpdir(), 'yuyou-open-staged-'));
  const filePath = path.join(root, 'store.json');
  const originalRename = fs.rename;
  try {
    const store = await createPersistentStore({ filePath, enabled: true });
    const owner = 'user-1';
    const tripId = 'trip-1';
    const oldWorkspace = await store.saveTripWorkspace({ userId: owner, formalTripId: tripId,
      workspace: { chatMessages: [{ role: 'user', content: 'committed' }] } });

    const renameStarted = deferred();
    const releaseRename = deferred();
    await withRenameStub(async (...args) => {
      renameStarted.resolve();
      await releaseRename.promise;
      return originalRename(...args);
    }, async () => {
      const pending = store.saveTripWorkspace({ userId: owner, formalTripId: tripId,
        workspace: { chatMessages: [{ role: 'user', content: 'candidate' }] } });
      await renameStarted.promise;
      assert.deepEqual(store.getTripWorkspace(owner, tripId), oldWorkspace,
        'workspace getter must not reveal a candidate awaiting rename');
      releaseRename.resolve();
      await pending;
    });
    assert.equal(store.getTripWorkspace(owner, tripId).chatMessages[0].content, 'candidate');

    const beforeFailure = store.getTripWorkspace(owner, tripId);
    const failedRenameStarted = deferred();
    const failRename = deferred();
    await withRenameStub(async () => {
      failedRenameStarted.resolve();
      await failRename.promise;
      throw Object.assign(new Error('injected rename failure'), { code: 'EIO' });
    }, async () => {
      const pending = store.saveTripWorkspace({ userId: owner, formalTripId: tripId,
        workspace: { chatMessages: [{ role: 'user', content: 'failed-candidate' }] } });
      await failedRenameStarted.promise;
      assert.deepEqual(store.getTripWorkspace(owner, tripId), beforeFailure,
        'workspace getter must not reveal a candidate during a write that will fail');
      failRename.resolve();
      await assert.rejects(pending, error => error.code === 'EIO');
    });
    assert.deepEqual(store.getTripWorkspace(owner, tripId), beforeFailure);

    const deleteWorkspaceStarted = deferred();
    const releaseWorkspaceDelete = deferred();
    await withRenameStub(async (...args) => {
      deleteWorkspaceStarted.resolve();
      await releaseWorkspaceDelete.promise;
      return originalRename(...args);
    }, async () => {
      const pending = store.deleteTripWorkspace(owner, tripId);
      await deleteWorkspaceStarted.promise;
      assert.deepEqual(store.getTripWorkspace(owner, tripId), beforeFailure,
        'workspace deletion must not hide the committed value before rename');
      releaseWorkspaceDelete.resolve();
      await pending;
    });
    assert.equal(store.getTripWorkspace(owner, tripId), null);
    await store.saveTripWorkspace({ userId: owner, formalTripId: tripId,
      workspace: { chatMessages: [{ role: 'user', content: 'reinstated' }] } });

    const draftRenameStarted = deferred();
    const releaseDraftRename = deferred();
    await withRenameStub(async (...args) => {
      draftRenameStarted.resolve();
      await releaseDraftRename.promise;
      return originalRename(...args);
    }, async () => {
      const pending = store.savePlannerDraft({ id: 'session-1', trip: { title: 'candidate' } });
      await draftRenameStarted.promise;
      assert.equal(store.getPlannerDraft('session-1'), null,
        'draft getter must not reveal a candidate awaiting rename');
      releaseDraftRename.resolve();
      await pending;
    });
    assert.equal(store.getPlannerDraft('session-1').trip.title, 'candidate');
    await store.saveTripWorkspace({ userId: owner, formalTripId: tripId,
      workspace: { chatMessages: [{ role: 'user', content: 'prior atomic' }], chatMode: 'chat',
        chatEpoch: 'prior-atomic-epoch', plannerConversationContext: { turn: 'prior-atomic-context' },
        itineraryMemorySnapshot: { source: 'prior-atomic' } } });

    const draftBeforeAtomicOpen = store.getPlannerDraft('session-1');
    const workspaceBeforeAtomicOpen = store.getTripWorkspace(owner, tripId);
    const atomicRenameStarted = deferred();
    const releaseAtomicRename = deferred();
    await withRenameStub(async (...args) => {
      atomicRenameStarted.resolve();
      await releaseAtomicRename.promise;
      return originalRename(...args);
    }, async () => {
      const pending = store.savePlannerOpenState({
        id: 'session-1', userId: owner, deviceId: 'device-1', formalTripId: tripId,
        javaSessionId: 'java-session-1', trip: { title: 'atomic-candidate' }, syncRevision: 3,
        chatEpoch: 'stale-candidate-epoch', plannerConversationContext: { turn: 'stale-candidate-context' },
        itineraryMemorySnapshot: { source: 'new-open-session' }
      });
      await atomicRenameStarted.promise;
      assert.deepEqual(store.getPlannerDraft('session-1'), draftBeforeAtomicOpen,
        'Open draft getter must retain the last committed value while combined rename is pending');
      assert.deepEqual(store.getTripWorkspace(owner, tripId), workspaceBeforeAtomicOpen,
        'Open workspace getter must retain the last committed value while combined rename is pending');
      releaseAtomicRename.resolve();
      await pending;
    });
    assert.equal(store.getPlannerDraft('session-1').trip.title, 'atomic-candidate');
    assert.equal(store.getPlannerDraft('session-1').chatEpoch, 'prior-atomic-epoch');
    assert.deepEqual(store.getPlannerDraft('session-1').plannerConversationContext, { turn: 'prior-atomic-context' });
    assert.equal(store.getTripWorkspace(owner, tripId).chatMessages[0].content, 'prior atomic');
    assert.equal(store.getTripWorkspace(owner, tripId).chatEpoch, 'prior-atomic-epoch');
    assert.deepEqual(store.getTripWorkspace(owner, tripId).plannerConversationContext, { turn: 'prior-atomic-context' });
    assert.deepEqual(store.getTripWorkspace(owner, tripId).itineraryMemorySnapshot, { source: 'new-open-session' });

    const committedDraft = store.getPlannerDraft('session-1');
    const failedDraftRenameStarted = deferred();
    const failDraftRename = deferred();
    await withRenameStub(async () => {
      failedDraftRenameStarted.resolve();
      await failDraftRename.promise;
      throw Object.assign(new Error('injected draft rename failure'), { code: 'EIO' });
    }, async () => {
      const pending = store.savePlannerDraft({ id: 'session-1', trip: { title: 'failed-candidate' } });
      await failedDraftRenameStarted.promise;
      assert.deepEqual(store.getPlannerDraft('session-1'), committedDraft,
        'draft getter must keep the committed value while an update is pending');
      failDraftRename.resolve();
      await assert.rejects(pending, error => error.code === 'EIO');
    });
    assert.deepEqual(store.getPlannerDraft('session-1'), committedDraft);

    const draftBeforeDelete = store.getPlannerDraft('session-1');
    const deleteRenameStarted = deferred();
    const releaseDeleteRename = deferred();
    await withRenameStub(async (...args) => {
      deleteRenameStarted.resolve();
      await releaseDeleteRename.promise;
      return originalRename(...args);
    }, async () => {
      const pending = store.deletePlannerDraft('session-1');
      await deleteRenameStarted.promise;
      assert.deepEqual(store.getPlannerDraft('session-1'), draftBeforeDelete,
        'draft deletion must not hide the committed value before rename');
      releaseDeleteRename.resolve();
      await pending;
    });
    assert.equal(store.getPlannerDraft('session-1'), null);

    await store.savePlannerDraft({ id: 'session-2', trip: { title: 'clear-candidate' } });
    const draftBeforeClear = store.getPlannerDraft('session-2');
    const clearRenameStarted = deferred();
    const releaseClearRename = deferred();
    await withRenameStub(async (...args) => {
      clearRenameStarted.resolve();
      await releaseClearRename.promise;
      return originalRename(...args);
    }, async () => {
      const pending = store.clearPlannerDrafts();
      await clearRenameStarted.promise;
      assert.deepEqual(store.getPlannerDraft('session-2'), draftBeforeClear,
        'clear must not remove committed drafts until its rename succeeds');
      releaseClearRename.resolve();
      await pending;
    });
    assert.equal(store.getPlannerDraft('session-2'), null);
  } finally {
    await rm(root, { recursive: true, force: true });
    if (originalSecret === undefined) delete process.env.YUYOUZHICE_AUTH_SECRET;
    else process.env.YUYOUZHICE_AUTH_SECRET = originalSecret;
  }
});

test('workspace and draft map mutations roll back on rename failure and later queued writes recover', async () => {
  const originalSecret = process.env.YUYOUZHICE_AUTH_SECRET;
  process.env.YUYOUZHICE_AUTH_SECRET = '0123456789abcdef0123456789abcdef';
  const root = await mkdtemp(path.join(os.tmpdir(), 'yuyou-open-rollback-'));
  const filePath = path.join(root, 'store.json');
  try {
    const store = await createPersistentStore({ filePath, enabled: true });
    const owner = 'user-1';
    const tripId = 'trip-1';
    const prior = await store.saveTripWorkspace({ userId: owner, formalTripId: tripId,
      workspace: { chatMessages: [{ role: 'user', content: 'existing' }], chatEpoch: 'epoch-1' } });

    // A directory at the destination makes the real atomic rename fail on
    // supported filesystems while leaving the temporary file writable.
    await rm(filePath);
    await mkdir(filePath);
    const overlapping = await Promise.allSettled([
      store.saveTripWorkspace({ userId: owner, formalTripId: tripId,
        workspace: { chatMessages: [{ role: 'user', content: 'failed-first' }] } }),
      store.saveTripWorkspace({ userId: owner, formalTripId: tripId,
        workspace: { chatMessages: [{ role: 'user', content: 'failed-second' }] } })
    ]);
    assert.deepEqual(overlapping.map(result => result.status), ['rejected', 'rejected']);
    for (const result of overlapping) {
      assert.ok(['EISDIR', 'EPERM', 'EEXIST', 'ENOTEMPTY'].includes(result.reason?.code),
        `expected target-rename filesystem failure, got ${result.reason?.code}: ${result.reason?.message}`);
    }
    assert.deepEqual(store.getTripWorkspace(owner, tripId), prior,
      'same-key queued failures must roll back to the committed workspace, not each other');

    await assert.rejects(store.savePlannerDraft({
      id: 'java-session-1', userId: owner, formalTripId: tripId, trip: { title: 'opened' }, syncRevision: 2
    }), error => ['EISDIR', 'EPERM', 'EEXIST', 'ENOTEMPTY'].includes(error?.code));
    assert.equal(store.getPlannerDraft('java-session-1'), null,
      'failed Open draft persistence must not leave a draft in memory');
    await assert.rejects(store.savePlannerOpenState({
      id: 'java-session-atomic', userId: owner, formalTripId: tripId,
      javaSessionId: 'java-session-atomic', trip: { title: 'atomic opened' }, syncRevision: 2,
      chatEpoch: 'epoch-atomic', itineraryMemorySnapshot: { source: 'atomic-open' }
    }), error => ['EISDIR', 'EPERM', 'EEXIST', 'ENOTEMPTY'].includes(error?.code));
    assert.equal(store.getPlannerDraft('java-session-atomic'), null,
      'failed atomic Open persistence must not leave a draft in memory');
    assert.deepEqual(store.getTripWorkspace(owner, tripId), prior,
      'failed atomic Open persistence must retain the prior workspace');

    await rm(filePath, { recursive: true });
    const recovered = await store.savePlannerOpenState({
      id: 'java-session-atomic', userId: owner, formalTripId: tripId,
      javaSessionId: 'java-session-atomic', trip: { title: 'after-recovery' }, syncRevision: 2,
      chatEpoch: 'epoch-atomic', itineraryMemorySnapshot: { source: 'atomic-open' }
    });
    const persisted = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(recovered.workspace.chatMessages[0].content, 'existing');
    assert.equal(store.getTripWorkspace(owner, tripId).chatMessages[0].content, 'existing');
    assert.equal(store.getPlannerDraft('java-session-atomic').trip.title, 'after-recovery');
    assert.equal(persisted.tripWorkspaces[`${owner}:${tripId}`].chatMessages[0].content, 'existing');
    assert.equal(persisted.plannerDrafts['java-session-atomic'].trip.title, 'after-recovery');
  } finally {
    await rm(root, { recursive: true, force: true });
    if (originalSecret === undefined) delete process.env.YUYOUZHICE_AUTH_SECRET;
    else process.env.YUYOUZHICE_AUTH_SECRET = originalSecret;
  }
});

test('Open reads the workspace committed by an earlier queued PUT before building its draft', async () => {
  const originalSecret = process.env.YUYOUZHICE_AUTH_SECRET;
  process.env.YUYOUZHICE_AUTH_SECRET = '0123456789abcdef0123456789abcdef';
  const root = await mkdtemp(path.join(os.tmpdir(), 'yuyou-open-queue-rebase-'));
  const filePath = path.join(root, 'store.json');
  const originalRename = fs.rename;
  try {
    const store = await createPersistentStore({ filePath, enabled: true });
    const owner = 'user-queue';
    const tripId = 'trip-queue';
    await store.saveTripWorkspace({ userId: owner, formalTripId: tripId,
      workspace: { chatMessages: [{ role: 'user', content: 'old message' }], chatMode: 'chat',
        chatEpoch: 'old-epoch', plannerConversationContext: { turn: 'old-context' },
        itineraryMemorySnapshot: { source: 'old' } } });

    const renameStarted = deferred();
    const releaseRename = deferred();
    let renameCalls = 0;
    await withRenameStub(async (...args) => {
      renameCalls += 1;
      if (renameCalls === 1) {
        renameStarted.resolve();
        await releaseRename.promise;
      }
      return originalRename(...args);
    }, async () => {
      const put = store.saveTripWorkspace({ userId: owner, formalTripId: tripId,
        workspace: { chatMessages: [{ role: 'user', content: 'latest PUT message' }], chatMode: 'planner',
          chatEpoch: 'latest-epoch', plannerConversationContext: { turn: 'latest-context' },
          itineraryMemorySnapshot: { source: 'latest-remote-snapshot' } } });
      await renameStarted.promise;
      const openedSession = {
        id: 'open-session', userId: owner, deviceId: 'device', formalTripId: tripId,
        javaSessionId: 'java-open-session', trip: { title: 'opened trip' }, syncRevision: 2,
        chatEpoch: 'stale-open-epoch', plannerConversationContext: { turn: 'stale-open-context' },
        itineraryMemorySnapshot: { source: 'new-open-session' }
      };
      const open = store.savePlannerOpenState(openedSession);
      assert.equal(store.getPlannerDraft(openedSession.id), null,
        'Open draft remains invisible while an earlier PUT occupies the write queue');
      releaseRename.resolve();
      await Promise.all([put, open]);
    });

    const draft = store.getPlannerDraft('open-session');
    const workspace = store.getTripWorkspace(owner, tripId);
    assert.equal(draft.chatEpoch, 'latest-epoch');
    assert.deepEqual(draft.plannerConversationContext, { turn: 'latest-context' });
    assert.deepEqual(draft.itineraryMemorySnapshot, { source: 'new-open-session' });
    assert.equal(workspace.chatEpoch, 'latest-epoch');
    assert.deepEqual(workspace.plannerConversationContext, { turn: 'latest-context' });
    assert.deepEqual(workspace.itineraryMemorySnapshot, { source: 'new-open-session' });
    assert.equal(workspace.chatMode, 'planner');
    assert.equal(workspace.chatMessages[0].content, 'latest PUT message');
  } finally {
    await rm(root, { recursive: true, force: true });
    if (originalSecret === undefined) delete process.env.YUYOUZHICE_AUTH_SECRET;
    else process.env.YUYOUZHICE_AUTH_SECRET = originalSecret;
  }
});
