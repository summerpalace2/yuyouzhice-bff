import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
for (const marker of ['渝游智策', '重庆', '少走路']) if (!html.includes(marker)) throw new Error(`缺少语义标记：${marker}`);
for (const forbidden of ['无锡', '灵山胜境', '江南导游', 'Image binding pending', 'Dashboard']) if (html.includes(forbidden)) throw new Error(`发现禁止标记：${forbidden}`);
const port = 4313;
const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, YUYOUZHICE_MEMORY: '1', PORT: String(port) }, stdio: 'ignore' });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  await wait(180);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json());
  if (!health.ok || !health.adapter.endpoints.includes('/v5/place/text') || !health.adapter.endpoints.includes('/v5/direction/walking')) throw new Error('高德适配器健康检查失败');
  console.log('验收通过：全中文语义、服务启动、高德接口目录登记、旧项目污染标记清零');
} finally { server.kill(); }
