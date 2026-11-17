import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendRoot = path.join(repoRoot, 'frontend');
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), 'utf8');
const readFrontend = (...parts) => readFileSync(path.join(frontendRoot, ...parts), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const frontendPackage = JSON.parse(readFrontend('package.json'));
const lock = JSON.parse(readFrontend('package-lock.json'));
const readme = readFrontend('README.md');
const app = readFrontend('web', 'app.js');
const router = readFrontend('web', 'src', 'app-core', 'router.js');
const bootstrap = readFrontend('web', 'src', 'app-core', 'bootstrap.js');
const navigation = readFrontend('web', 'src', 'app-core', 'navigation-handler.js');

assert.equal(
  packageJson.scripts?.['test:architecture'],
  'node quality/frontend-architecture-check.mjs',
  '架构门禁必须指向仓库跟踪的质量脚本'
);
assert.equal(frontendPackage.scripts?.build, 'vite build --config vite.config.ts web', '构建入口必须使用部署中的 web 源码');
assert.equal(lock.lockfileVersion, 3, '前端必须携带 npm v7+ lockfile');
assert.equal(lock.packages?.['']?.name, frontendPackage.name, 'package-lock 必须对应当前前端包');
assert.match(readme, /`web\/` 是当前 Web UI 的权威源码/, 'README 必须明确 web/ 是部署权威源码');
assert.match(readme, /发布 `web\/dist\/`/, 'README 必须明确生产构建输出目录');

assert.match(app, /from ['"]\.\/src\/app-core\/router\.js['"]/, '组合根必须复用唯一页面注册表');
assert.doesNotMatch(app, /export\s+const\s+views\s*=\s*\{/, '组合根不能重新定义第二份页面注册表');
assert.match(app, /from ['"]\.\/src\/app-core\/navigation-handler\.js['"]/, '组合根必须将导航委派给 app-core');
assert.match(app, /from ['"]\.\/src\/app-core\/bootstrap\.js['"]/, '组合根必须将启动顺序委派给 app-core');
assert.ok(
  bootstrap.indexOf('await restoreAuthSession();') >= 0 &&
    bootstrap.indexOf('await restoreAuthSession();') < bootstrap.indexOf('render();'),
  '首次完整渲染必须发生在会话恢复之后'
);

const routeKeys = [...router.matchAll(/^\s*['"]?([a-z][a-z-]*)['"]?\s*:\s*[A-Za-z_$]/gm)].map((match) => match[1]);
assert.ok(routeKeys.length >= 10, '唯一页面注册表缺少预期页面');
assert.equal(new Set(routeKeys).size, routeKeys.length, '页面注册表存在重复 key');
assert.doesNotMatch(navigation, /from ['"][^'"]*features\//, '通用导航协调器不能反向依赖 feature 实现');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(absolute) : entry.name.endsWith('.js') ? [absolute] : [];
  });
}

const featureRoot = path.join(frontendRoot, 'web', 'src', 'features');
const featureFiles = sourceFiles(featureRoot);
const rootImport = /from\s+['"][^'"]*(?:^|\/)app\.js['"]/m;
const circularEntrypoints = featureFiles
  .filter((file) => rootImport.test(readFileSync(file, 'utf8')))
  .map((file) => path.relative(frontendRoot, file).replaceAll(path.sep, '/'));
assert.deepEqual(circularEntrypoints, [], 'feature 模块不能反向导入应用组合根');

console.log(
  `前端架构门禁通过：${routeKeys.length} 个页面注册、启动恢复顺序、app-core/feature 依赖方向、npm 锁文件与部署构建入口均有效。`
);
