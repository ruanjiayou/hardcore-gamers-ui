import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('UI-083 请求优先缓存', () => {
  test('SW 先请求网络，失败才回落缓存', () => {
    const config = read('vite.config.ts');
    const sw = config.slice(
      config.indexOf('const source = `const DATA'),
      config.indexOf("fileName: 'sw.js'")
    );
    const fetchAt = sw.indexOf('fetch(req)');
    const cacheAt = sw.indexOf('caches.match(');
    expect(fetchAt).toBeGreaterThan(-1);
    expect(cacheAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeLessThan(cacheAt);
    // 旧策略：缓存优先 + 后台更新，已作废
    expect(sw).not.toContain('return cached || network');
  });

  test('HTML 深链仍映射到入口 HTML 的缓存 key', () => {
    const sw = read('vite.config.ts');
    expect(sw).toContain('function htmlKey(');
    expect(sw).toContain("'/lobby/game/' + m[1] + '/index.html'");
  });

  test('缓存兜底时通知页面', () => {
    const sw = read('vite.config.ts');
    expect(sw).toContain('postMessage');
  });
});

describe('UI-083 离线提示', () => {
  test('AppBootstrap 监听 online/offline 并显示横幅', () => {
    const code = read('src/bootstrap/AppBootstrap.tsx');
    expect(code).toContain("addEventListener('offline'");
    expect(code).toContain("addEventListener('online'");
    expect(code).toContain('app-offline-banner');
  });

  test('横幅样式已定义', () => {
    expect(read('src/styles/index.css')).toContain('.app-offline-banner');
  });

  test('挂载后主动探测服务可达性（随机 query 绕过旧 SW 缓存）', () => {
    const code = read('src/bootstrap/AppBootstrap.tsx');
    expect(code).toContain('lobby_probe');
    expect(code).toContain("cache: 'no-store'");
    expect(code).toContain('Date.now()');
    // 探测失败必须置离线态，成功要清除
    expect(code).toMatch(/setOffline\(true\)[\s\S]{0,200}setOffline\(false\)|setOffline\(false\)[\s\S]{0,200}setOffline\(true\)/);
  });
});
