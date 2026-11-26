import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const PUBLIC_URL = '/lobby';
const GAME_SLUGS = ['snake', 'gomoku', 'xiangqi', 'othello', 'chess', '2048', 'tetris'];

// UI-077 dev 回退：将 /lobby/game/<slug>/* 的 HTML 导航请求重写到对应入口 HTML，
// 使游戏内路由（如 /lobby/game/snake/room/abc）刷新后仍由该游戏的入口接管。
// 生产环境的同名回退在 server/src/index.ts 中实现。
// UI-079：源码入口迁到 src/pages/game/<slug>/，产物路径仍归一为 game/<slug>/index.html，
// 保证服务端回退（public/lobby/game/<slug>/index.html）与用户 URL 不变。
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

// UI-079：按构建产物生成 sw.js，预缓存 8 个 HTML 与全部 chunk。
// HTML 走 stale-while-revalidate（游戏内路由映射到该游戏的 index.html）；静态资源 cache-first。
// /api、/socket.io、/audio、/skins 不在 /lobby/ 下，天然不拦截。
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
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/lobby/')) return;
  if (req.mode === 'navigate') {
    const key = htmlKey(url.pathname);
    event.respondWith(
      caches.match(key).then(cached => {
        const network = fetch(req).then(res => {
          if (res && res.ok) caches.open(CACHE).then(cache => cache.put(key, res.clone()));
          return res;
        }).catch(() => cached || Response.error());
        return cached || network;
      })
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res && res.ok) caches.open(CACHE).then(cache => cache.put(req, res.clone()));
      return res;
    }))
  );
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    }
  };
}

// UI-080：8 个 HTML 共用内联黑幕——在 <head> 里消费标记，不等 React 包；文档 load 后淡出。
function transitionCurtain(): Plugin {
  const CURTAIN_KEY = 'lobby:curtain';
  const snippet = `<script>
(function () {
  try {
    var flag = sessionStorage.getItem('${CURTAIN_KEY}');
    if (!flag || Date.now() - Number(flag) > 10000) return;
    sessionStorage.removeItem('${CURTAIN_KEY}');
    var root = document.documentElement;
    root.classList.add('lobby-curtain-on');
    var done = false;
    var off = function () {
      if (done) return;
      done = true;
      root.classList.add('is-fading');
      setTimeout(function () { root.classList.remove('lobby-curtain-on', 'is-fading'); }, 200);
      window.removeEventListener('load', off);
    };
    window.addEventListener('load', off, { once: true });
    setTimeout(off, 5000);
  } catch (e) {}
})();
</script>
<style>
html.lobby-curtain-on, html.lobby-curtain-on body { background: #000; }
html.lobby-curtain-on::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: #000;
  pointer-events: none;
  transition: opacity 180ms ease;
}
html.lobby-curtain-on.is-fading::before { opacity: 0; }
</style>`;
  return {
    name: 'lobby-transition-curtain',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.includes('</head>')
          ? html.replace('</head>', `${snippet}\n  </head>`)
          : `${snippet}\n${html}`;
      }
    }
  };
}

function gameHtmlFallback(): Plugin {
  return {
    name: 'game-html-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();

        const url = (req.url ?? '').split('?')[0];
        // UI-080：软导航 fetch 预取的是 index.html（Accept 不是 text/html），也要回退到入口 HTML
        const explicitHtml = /^\/lobby\/game\/[^/]+\/index\.html$/.test(url);
        if (!explicitHtml) {
          if (!req.headers.accept?.includes('text/html')) return next();
          // 带扩展名的静态资源（如 /lobby/game/snake/assets/x.js）不改写
          if (/\.[^/]+$/.test(url)) return next();
        }

        const match = url.match(/^\/lobby\/game\/([^/]+)(\/.*)?$/);
        const slug = match?.[1];
        // 未知 slug 不改写，交给 Vite 默认处理（SPA 回退或 404）
        if (!slug || !GAME_SLUGS.includes(slug)) return next();

        req.url = `${PUBLIC_URL}/src/pages/game/${slug}/index.html`;
        next();
      });
    }
  };
}

export default defineConfig({
  base: PUBLIC_URL,
  define: {
    'process.env.PUBLIC_URL': JSON.stringify(PUBLIC_URL)
  },
  plugins: [react(), transitionCurtain(), gameHtmlOutputPath(), gameHtmlFallback(), serviceWorkerPrecache()],
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