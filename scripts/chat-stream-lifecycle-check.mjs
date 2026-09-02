import { createServer } from 'node:http';

const javaPort = 4326;
const bffPort = 4327;
const upstreamClosed = new Promise((resolve) => {
  globalThis.resolveUpstreamClosed = resolve;
});

const java = createServer((req, res) => {
  if (!req.url?.startsWith('/ai/chat/stream')) {
    res.writeHead(404).end();
    return;
  }
  const message = new URL(req.url, `http://${req.headers.host}`).searchParams.get('message') || '';
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
  res.flushHeaders();
  res.on('close', () => {
    if (message === 'abort-check') globalThis.resolveUpstreamClosed();
  });

  if (message === 'stall-check' || message === 'abort-check') return;
  if (message === 'early-close-check') {
    res.write('event: text\ndata: partial\n\n');
    res.destroy();
    return;
  }
  res.end('event: done\ndata: complete\n\n');
});

process.env.CORE_BACKEND_URL = `http://127.0.0.1:${javaPort}`;
process.env.YUYOUZHICE_JAVA_STREAM_TIMEOUT_MS = '1000';
process.env.PORT = String(bffPort);
const { createAppServer } = await import('../server/index.mjs');

await new Promise((resolve) => java.listen(javaPort, '127.0.0.1', resolve));
const bff = createAppServer({ port: bffPort });
const base = `http://127.0.0.1:${bffPort}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  await wait(50);

  const stalled = await fetch(`${base}/api/chat/stream?message=stall-check`, {
    headers: { accept: 'text/event-stream' }
  });
  const stalledText = await stalled.text();
  if (!stalledText.includes('event: error') || !stalledText.includes('BFF 对话流等待超时') || !stalledText.includes('event: done')) {
    throw new Error(`停滞流未按时结束：${stalledText}`);
  }

  const early = await fetch(`${base}/api/chat/stream?message=early-close-check`, {
    headers: { accept: 'text/event-stream' }
  });
  const earlyText = await early.text();
  if (!earlyText.includes('event: error') || !earlyText.includes('event: done')) {
    throw new Error(`上游提前断开未转换为 error/done：${earlyText}`);
  }

  const abortController = new AbortController();
  const pending = fetch(`${base}/api/chat/stream?message=abort-check`, {
    headers: { accept: 'text/event-stream' },
    signal: abortController.signal
  });
  await wait(100);
  abortController.abort();
  try { await pending; } catch (error) {
    if (error?.name !== 'AbortError') throw error;
  }
  await Promise.race([
    upstreamClosed,
    wait(2000).then(() => { throw new Error('浏览器取消未传递到 Java 上游。'); })
  ]);

  console.log('聊天流生命周期检查通过：停滞超时、上游断开、客户端取消均可终止。');
} finally {
  bff.close();
  java.close();
}
