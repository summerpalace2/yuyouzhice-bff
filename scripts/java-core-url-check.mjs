import {
  DEPLOYED_JAVA_CORE_URL,
  LOCAL_JAVA_CORE_URL,
  resolveJavaCoreUrl
} from '../server/java-core-client.mjs';

function expect(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
}

expect(resolveJavaCoreUrl({}), LOCAL_JAVA_CORE_URL, '默认本地 Java 地址错误');
expect(resolveJavaCoreUrl({ NODE_ENV: 'production' }), DEPLOYED_JAVA_CORE_URL, '生产环境 Java 地址错误');
expect(resolveJavaCoreUrl({ ZEABUR_SERVICE_ID: 'service-id' }), DEPLOYED_JAVA_CORE_URL, 'Zeabur 环境 Java 地址错误');
expect(resolveJavaCoreUrl({ CORE_BACKEND_URL: 'https://staging.example.com/' }), 'https://staging.example.com', '显式 Java 地址没有优先');

console.log('Java Core 环境地址验收通过：本地 8080、部署 Zeabur、显式环境变量覆盖。');
