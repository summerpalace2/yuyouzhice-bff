import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createJavaCoreClient } from './java-core-client.mjs';

const indexSource = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');

function extract(startMarker, endMarker, source = indexSource) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `route markers not found: ${startMarker}`);
  return source.slice(start, end);
}

const agentMethodGuard = extract(
  "  if ((url.pathname === '/api/agent/stream' || url.pathname === '/api/agent/confirm') && req.method !== 'POST')",
  "  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase()))"
);
const agentRoutes = extract(
  "  if (req.method === 'POST' && url.pathname === '/api/agent/stream')",
  "  if (req.method === 'POST' && url.pathname === '/api/chat/proposal')"
);

function createRes() {
  return {
    status: null,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = { ...this.headers, ...headers };
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(chunk = '') {
      this.body += String(chunk || '');
    },
    jsonBody() {
      return this.body ? JSON.parse(this.body) : null;
    }
  };
}

function runRoute({ method = 'POST', pathname = '/api/agent/stream', input = {}, user = { id: 'u-1' },
  session = null, java = {}, pipeImpl } = {}) {
  const res = createRes();
  const sessions = new Map();
  if (session) sessions.set(session.id, session);
  const persisted = [];
  let piped = null;

  const ctx = {
    req: { method, headers: {} },
    res,
    url: new URL(`http://localhost:3000${pathname}`),
    requestSignal: undefined,
    randomUUID: () => 'uuid-test',
    body: async () => input,
    json: (targetRes, status, data) => {
      targetRes.status = status;
      targetRes.headers['content-type'] = 'application/json; charset=utf-8';
      targetRes.body = JSON.stringify(data);
    },
    authUser: async () => user,
    javaTokenFor: () => (user ? 'jwt-u1' : ''),
    restorePlannerSession: async (id) => sessions.get(id) || null,
    sessions,
    persistentStore: { savePlannerDraft: async (draft) => persisted.push(structuredClone(draft)) },
    clone: (v) => structuredClone(v),
    pipeChatStream: pipeImpl || (async (stream, targetRes) => { piped = stream; targetRes.end('data: ok\n\n'); }),
    javaErrorResponse: (targetRes, error, fallback) => {
      targetRes.status = error?.status || 502;
      targetRes.body = JSON.stringify({ ok: false, message: error?.message || fallback });
    },
    javaCore: {
      agentStream: async (args, token) => {
        if (java.onStream) return java.onStream(args, token);
        return { headers: new Map([['content-type', 'text/event-stream']]), body: {} };
      },
      agentConfirm: async (args, token) => {
        if (java.onConfirm) return java.onConfirm(args, token);
        return { ok: true, modified: false };
      }
    }
  };
  vm.createContext(ctx);
  const fn = vm.runInContext(
    `(async () => {\n${agentMethodGuard}\n${agentRoutes}\nreturn false;\n})`,
    ctx
  );
  return fn().then(() => ({ res, sessions, persisted, piped }));
}

test('createJavaCoreClient agentStream and agentConfirm hit Java V1 contracts with capability header', async t => {
  const previous = {
    coreUrl: process.env.CORE_BACKEND_URL,
    legacyUrl: process.env.YUYOUZHICE_JAVA_CORE_URL,
    stub: process.env.YUYOUZHICE_JAVA_TEST_STUB
  };
  process.env.CORE_BACKEND_URL = 'http://java-agent.test';
  process.env.YUYOUZHICE_JAVA_TEST_STUB = '0';
  const { createJavaCoreClient } = await import(`./java-core-client.mjs?agent=${Date.now()}`);

  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ ok: true, modified: true }),
      json: async () => ({ ok: true, modified: true }),
      body: new ReadableStream()
    };
  };
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (previous.coreUrl === undefined) delete process.env.CORE_BACKEND_URL;
    else process.env.CORE_BACKEND_URL = previous.coreUrl;
    if (previous.legacyUrl === undefined) delete process.env.YUYOUZHICE_JAVA_CORE_URL;
    else process.env.YUYOUZHICE_JAVA_CORE_URL = previous.legacyUrl;
    if (previous.stub === undefined) delete process.env.YUYOUZHICE_JAVA_TEST_STUB;
    else process.env.YUYOUZHICE_JAVA_TEST_STUB = previous.stub;
  });

  const client = createJavaCoreClient();
  await client.agentStream({
    message: '明天适合去三峡博物馆吗',
    sessionId: 'chat-1',
    mode: 'deep',
    plannerSessionId: 'java-ps-1',
    sessionAccessToken: 'cap-secret',
    baseRevision: 4,
    activeDay: 2
  }, 'jwt-tok');

  assert.equal(calls[0].url, 'http://java-agent.test/ai/agent/v1/stream');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-plan-session-token'], 'cap-secret');
  assert.equal(calls[0].init.headers.authorization, 'Bearer jwt-tok');
  const sentBody = JSON.parse(calls[0].init.body);
  assert.equal(sentBody.baseRevision, 4);
  assert.equal(sentBody.activeDay, 2);

  const confirmRes = await client.agentConfirm({ confirmId: 'cfg_1', approved: true, sessionId: 'chat-1' }, 'jwt-tok');
  assert.equal(calls[1].url, 'http://java-agent.test/ai/agent/v1/confirm');
  assert.equal(confirmRes.ok, true);
});

test('createJavaCoreClient agentConfirm preserves top-level modified/tool/data without stripping by unwrapEnvelope', async t => {
  process.env.CORE_BACKEND_URL = 'http://java-agent.test';
  process.env.YUYOUZHICE_JAVA_TEST_STUB = '0';
  const { createJavaCoreClient } = await import(`./java-core-client.mjs?confirm=${Date.now()}`);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      confirmId: 'cfg_save_9',
      approved: true,
      modified: true,
      tool: 'confirm_save_formal_trip',
      message: '正式行程已保存',
      data: { ok: true, saved: true, tripId: 'trip-formal-9', currentVersion: 1 }
    })
  });
  t.after(() => { globalThis.fetch = oldFetch; });
  const client = createJavaCoreClient();
  const res = await client.agentConfirm({ confirmId: 'cfg_save_9', approved: true, sessionId: 's1' }, 'jwt');
  assert.equal(res.modified, true);
  assert.equal(res.tool, 'confirm_save_formal_trip');
  assert.equal(res.data.saved, true);
  assert.equal(res.data.tripId, 'trip-formal-9');
});

test('BFF /api/agent/stream enforces POST, resolves server capability, and does not expose capability to client', async () => {
  const { res: getRes } = await runRoute({ method: 'GET', pathname: '/api/agent/stream' });
  assert.equal(getRes.status, 405);

  const { res: emptyRes } = await runRoute({ method: 'POST', pathname: '/api/agent/stream', input: { message: '   ' } });
  assert.equal(emptyRes.status, 400);

  let captured = null;
  const { res } = await runRoute({
    method: 'POST',
    pathname: '/api/agent/stream',
    input: { message: '把第二天换轻松点', sessionId: 'chat-9', plannerSessionId: 'web-ps-1' },
    session: {
      id: 'web-ps-1',
      javaSessionId: 'java-ps-99',
      sessionAccessToken: 'cap-hidden',
      formalTripId: 'trip-99',
      syncRevision: 6,
      chatEpoch: 'ep-7',
      trip: { version: 6 }
    },
    java: {
      onStream: async (args, token) => {
        captured = { args, token };
        return { headers: new Map([['content-type', 'text/event-stream']]), body: {} };
      }
    }
  });
  assert.equal(res.status, 200);
  assert.equal(captured.token, 'jwt-u1');
  assert.equal(captured.args.plannerSessionId, 'java-ps-99');
  assert.equal(captured.args.sessionAccessToken, 'cap-hidden');
  assert.equal(captured.args.sessionId, 'epoch-ep-7');
  assert.equal(captured.args.baseRevision, 6);
  assert.equal(res.headers['x-agent-owner'], 'java-authenticated');
});

test('BFF /api/agent/confirm validates confirmId and syncs cached BFF planner draft on applied mutation', async () => {
  const { res: missing } = await runRoute({ method: 'POST', pathname: '/api/agent/confirm', input: {} });
  assert.equal(missing.status, 400);

  let confirmArgs = null;
  const { res, sessions, persisted } = await runRoute({
    method: 'POST',
    pathname: '/api/agent/confirm',
    input: { confirmId: 'cfg_9', approved: true, sessionId: 'chat-9', plannerSessionId: 'web-ps-1' },
    session: {
      id: 'web-ps-1',
      javaSessionId: 'java-ps-99',
      syncRevision: 6,
      chatEpoch: 'ep-7',
      trip: { version: 6, days: [] }
    },
    java: {
      onConfirm: async (args) => {
        confirmArgs = args;
        return {
          ok: true,
          modified: true,
          data: { applied: true, currentVersion: 7, trip: { version: 7, days: [{ day: 1 }] } }
        };
      }
    }
  });
  assert.equal(res.status, 200);
  assert.equal(confirmArgs.confirmId, 'cfg_9');
  assert.equal(confirmArgs.sessionId, 'epoch-ep-7');
  assert.equal(sessions.get('web-ps-1').syncRevision, 7);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].syncRevision, 7);
});

test('pipeChatStream does not truncate split-chunk event:done before trailing data and terminator arrive', async () => {
  const pipeSource = extract(
    'async function pipeChatStream(stream, res, requestSignal) {',
    '\nasync function body(req)'
  );
  const chunks = [
    Buffer.from('event:message\ndata:{"event":"message","message":"hi"}\n\n', 'utf8'),
    Buffer.from('event:done\n', 'utf8'),
    Buffer.from('data:{"event":"done","message":"complete"}\n', 'utf8'),
    Buffer.from('\n', 'utf8')
  ];
  const webBody = new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(c);
      ctrl.close();
    }
  });
  const res = new EventEmitter();
  res.writableEnded = false;
  res.writableFinished = false;
  res.destroyed = false;
  let written = '';
  res.write = (chunk) => {
    written += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    return true;
  };
  res.end = () => {
    res.writableEnded = true;
    res.writableFinished = true;
  };

  const ctx = {
    Readable,
    CHAT_PROXY_TIMEOUT_MS: 5000,
    writeChatSse: (targetRes, event, data) => targetRes.write(`event: ${event}\ndata: ${String(data)}\n\n`),
    setTimeout,
    clearTimeout,
    AbortController,
    Buffer,
    console
  };
  vm.createContext(ctx);
  await vm.runInContext(
    `${pipeSource}\npipeChatStream`,
    ctx
  )({ body: webBody, abort() {}, cleanup() {} }, res, undefined);

  assert.match(written, /event:done\ndata:\{"event":"done","message":"complete"\}\n\n/);
  assert.doesNotMatch(written, /Java 对话流提前断开/);
});
