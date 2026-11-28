import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const PUBLIC_URL = '/lobby';
const GAME_SLUGS = ['snake', 'gomoku', 'xiangqi', 'othello', 'chess', '2048', 'tetris'];

/**
 * 把 src/pages/game/<slug>/index.html 的产物路径归一为 game/<slug>/index.html，
 * 让服务端回退路径与用户 URL 保持不变。
 */
function gameHtmlOutputPath(): Plugin {
  const PREFIX = 'src/pages/game/';
  return {
    name: 'game-html-output-path',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (!fileName.startsWith(PREFIX) || !fileName.endsWith('/index.html')) continue;
        const file = bundle[fileName];
        if (!file || file.type !== 'asset') continue;
        const target = `game/${fileName.slice(PREFIX.length)}`;
        file.fileName = target;
        bundle[target] = file;
        delete bundle[fileName];
      }
    }
  };
}

/** 从 HTML 抽 script/link 的资源 URL（产物是 /lobby/assets/...，dev 是 /src/...）。 */
function extractHtmlAssets(html: string): string[] {
  const scripts = Array.from(html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g), m => m[1]);
  const styles = Array.from(html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/g), m => m[0])
    .filter(tag => /rel=["']stylesheet["']/.test(tag) || /\.css(?:[?#]|$)/.test(tag))
    .map(tag => tag.match(/\bhref=["']([^"']+)["']/)![1]);
  return Array.from(new Set([...scripts, ...styles]))
    .map(url => url.startsWith('/') ? url : `${PUBLIC_URL}/${url}`);
}

/**
 * 资源清单：key = 入口 HTML 缓存路径，value = [HTML, ...JS/CSS]。
 * 转场进度层用它做真实进度；构建期与 dev 都产出 asset-manifest.json。
 */
function entryAssetManifest(): Plugin {
  const devEntries: Array<[string, string]> = [
    [`${PUBLIC_URL}/index.html`, resolve(__dirname, 'index.html')],
    ...GAME_SLUGS.map(slug => [
      `${PUBLIC_URL}/game/${slug}/index.html`,
      resolve(__dirname, `src/pages/game/${slug}/index.html`)
    ] as [string, string])
  ];
  return {
    name: 'lobby-entry-asset-manifest',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== `${PUBLIC_URL}/asset-manifest.json`) return next();
        const manifest: Record<string, string[]> = {};
        for (const [key, file] of devEntries) {
          const assets = extractHtmlAssets(readFileSync(file, 'utf8'))
            .map(url => url.startsWith('/src/') ? `${PUBLIC_URL}${url}` : url);
          manifest[key] = Array.from(new Set([key, ...assets]));
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(manifest));
      });
    },
    generateBundle(_options, bundle) {
      const manifest: Record<string, string[]> = {};
      for (const [fileName, file] of Object.entries(bundle)) {
        if (file.type !== 'asset' || !fileName.endsWith('.html')) continue;
        const key = `${PUBLIC_URL}/${fileName}`;
        manifest[key] = Array.from(new Set([key, ...extractHtmlAssets(String(file.source))]));
      }
      this.emitFile({ type: 'asset', fileName: 'asset-manifest.json', source: JSON.stringify(manifest) });
    }
  };
}

/**
 * Service Worker：网络优先，成功写缓存；失败才回落缓存并通知页面显示离线横幅。
 * /lobby/loading?to= 这类加载路由刷新与游戏深链都映射到该入口的 index.html。
 * 探测请求（lobby_probe）直连网络、不写缓存，避免随机 query 撑爆缓存。
 */
function serviceWorkerPrecache(): Plugin {
  return {
    name: 'lobby-sw-precache',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const urls = Object.values(bundle)
        .filter(file =>
          (file.type === 'asset' && /\.(html|css)$/.test(file.fileName)) ||
          (file.type === 'chunk' && file.fileName.endsWith('.js'))
        )
        .map(file => `${PUBLIC_URL}/${file.fileName}`);
      urls.push(`${PUBLIC_URL}/asset-manifest.json`);
      const source = `const DATA = ${JSON.stringify({ version: Date.now(), urls })};
const CACHE = 'lobby-' + DATA.version;
const SHELL = new Set(DATA.urls);
function htmlKey(pathname) {
  const m = pathname.match(/^\\/lobby\\/game\\/([^/]+)/);
  return m ? '/lobby/game/' + m[1] + '/index.html' : '/lobby/index.html';
}
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll([...SHELL]))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
function offlineNotice() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (clients) {
      return Promise.all(clients.map(function (client) {
        return client.postMessage({ type: 'lobby:offline-cache' });
      }));
    })
    .catch(function () { return undefined; });
}
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API 一律不缓存（数据必须新鲜）
  if (url.pathname.startsWith('/api/')) return;
  // 静态资源与页面同策略：皮肤图 / 音频 / 后台上传图都进缓存，离线也能画
  const isAsset = url.pathname.startsWith('/skins/')
    || url.pathname.startsWith('/audio/')
    || url.pathname.startsWith('/uploads/');
  if (!isAsset && !url.pathname.startsWith('/lobby/')) return;
  if (url.searchParams.has('lobby_probe')) return;
  const key = req.mode === 'navigate' ? htmlKey(url.pathname) : req;
  const network = fetch(req).then(function (res) {
    if (!res || !res.ok) throw new Error('network response not ok');
    const copy = res.clone();
    return caches.open(CACHE)
      .then(function (cache) { return cache.put(key, copy); })
      .catch(function () { return undefined; })
      .then(function () { return res; });
  });
  event.respondWith(network.catch(function () {
    return offlineNotice().then(function () {
      return caches.match(key).then(function (cached) { return cached || Response.error(); });
    });
  }));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    }
  };
}

/**
 * UI-091 首帧渐变：向 8 个 HTML 注入主题变量、常驻渐变层与 loading 刷新脚本。
 * 渐变层用负 safe-area inset 保证 iOS 首帧就覆盖安全区；转场遮罩已移除。
 */
function lobbyEntryHead(): Plugin {
  const style = `<style>
:root {
  --lobby-brand-from: #667eea;
  --lobby-brand-to: #764ba2;
  --lobby-page-gradient: linear-gradient(135deg, var(--lobby-brand-from, #667eea) 0%, var(--lobby-brand-to, #764ba2) 100%);
}
/* UI-096 首帧高度：与 CSS bundle 同值，CSS 到位前也不跳变 */
html, body, #root { height: 100vh; height: 100dvh; }
@media (display-mode: standalone) { html, body, #root { height: 100vh; } }
/* 根元素纯色兜底（不可见），渐变层用负安全区 inset 首帧铺满 */
html { background-color: var(--lobby-brand-from, #667eea); }
html::before {
  content: '';
  position: fixed;
  top: calc(-1 * env(safe-area-inset-top, 0px));
  right: calc(-1 * env(safe-area-inset-right, 0px));
  bottom: calc(-1 * env(safe-area-inset-bottom, 0px));
  left: calc(-1 * env(safe-area-inset-left, 0px));
  z-index: 0;
  background: var(--lobby-page-gradient);
  pointer-events: none;
}
#root { position: relative; z-index: 1; }
</style>`;
  const script = `<script>
(function () {
  if (location.pathname === '/lobby/loading') {
    var to = new URLSearchParams(location.search).get('to');
    if (to && to.indexOf('/lobby/') === 0) location.replace(to);
  }
})();
</script>`;
  return {
    name: 'lobby-entry-head',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const withStyle = html.includes('</head>')
          ? html.replace('</head>', `${style}\n  </head>`)
          : `${style}\n${html}`;
        return withStyle.includes('</head>')
          ? withStyle.replace('</head>', `${script}\n  </head>`)
          : `${script}\n${withStyle}`;
      }
    }
  };
}

/** dev 回退：游戏内路由与预取的 index.html 请求都交给对应游戏入口。 */
function gameHtmlFallback(): Plugin {
  return {
    name: 'game-html-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const url = (req.url ?? '').split('?')[0];
        const explicitHtml = /^\/lobby\/game\/[^/]+\/index\.html$/.test(url);
        if (!explicitHtml) {
          if (!req.headers.accept?.includes('text/html')) return next();
          if (/\.[^/]+$/.test(url)) return next();
        }
        const match = url.match(/^\/lobby\/game\/([^/]+)(\/.*)?$/);
        const slug = match?.[1];
        if (!slug || !GAME_SLUGS.includes(slug)) return next();
        req.url = `${PUBLIC_URL}/src/pages/game/${slug}/index.html`;
        next();
      });
    }
  };
}

export default defineConfig({
  base: PUBLIC_URL,
  define: { 'process.env.PUBLIC_URL': JSON.stringify(PUBLIC_URL) },
  plugins: [
    react(),
    lobbyEntryHead(),
    gameHtmlOutputPath(),
    entryAssetManifest(),
    gameHtmlFallback(),
    serviceWorkerPrecache()
  ],
  build: {
    outDir: 'lobby',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        snake: resolve(__dirname, 'src/pages/game/snake/index.html'),
        gomoku: resolve(__dirname, 'src/pages/game/gomoku/index.html'),
        xiangqi: resolve(__dirname, 'src/pages/game/xiangqi/index.html'),
        othello: resolve(__dirname, 'src/pages/game/othello/index.html'),
        chess: resolve(__dirname, 'src/pages/game/chess/index.html'),
        '2048': resolve(__dirname, 'src/pages/game/2048/index.html'),
        tetris: resolve(__dirname, 'src/pages/game/tetris/index.html')
      }
    }
  },
  server: {
    port: 5173,
    allowedHosts: ["max.local", "game.jiayou.work","max.local:5173"],
    proxy: {
      '/api': {
        target: 'http://100.125.39.89:8087',
        changeOrigin: true
      },
      // 语音包音频由后端从 server/public/audio 静态托管，dev 下必须转发，否则 /audio/* 打到 Vite
      '/audio': {
        target: 'http://100.125.39.89:8087',
        changeOrigin: true
      },
      // 皮肤图同理：server/public/skins/<pack>/<game>/...
      '/skins': {
        target: 'http://100.125.39.89:8087',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://100.125.39.89:8087', // socket.io 后端
        ws: true,                        // ⚠️ 关键：启用 WebSocket
        changeOrigin: true,
      }
    }
  }
});