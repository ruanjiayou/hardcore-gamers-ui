// vite.config.ts
import { defineConfig } from "file:///Users/jiayou/projects/hardcore-gamers/lobby/node_modules/vite/dist/node/index.js";
import react from "file:///Users/jiayou/projects/hardcore-gamers/lobby/node_modules/@vitejs/plugin-react/dist/index.js";
import { resolve } from "node:path";
var __vite_injected_original_dirname = "/Users/jiayou/projects/hardcore-gamers/lobby";
var PUBLIC_URL = "/lobby";
var GAME_SLUGS = ["snake", "gomoku", "xiangqi", "othello", "chess", "2048", "tetris"];
function gameHtmlOutputPath() {
  const PREFIX = "src/pages/game/";
  return {
    name: "game-html-output-path",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (!fileName.startsWith(PREFIX) || !fileName.endsWith("/index.html")) continue;
        const file = bundle[fileName];
        if (!file || file.type !== "asset") continue;
        const target = `game/${fileName.slice(PREFIX.length)}`;
        file.fileName = target;
        bundle[target] = file;
        delete bundle[fileName];
      }
    }
  };
}
function serviceWorkerPrecache() {
  return {
    name: "lobby-sw-precache",
    enforce: "post",
    generateBundle(_options, bundle) {
      const urls = Object.values(bundle).filter(
        (file) => file.type === "asset" && /\.(html|css)$/.test(file.fileName) || file.type === "chunk" && file.fileName.endsWith(".js")
      ).map((file) => `${PUBLIC_URL}/${file.fileName}`);
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
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    }
  };
}
function transitionCurtain() {
  const CURTAIN_KEY = "lobby:curtain";
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
    name: "lobby-transition-curtain",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.includes("</head>") ? html.replace("</head>", `${snippet}
  </head>`) : `${snippet}
${html}`;
      }
    }
  };
}
function gameHtmlFallback() {
  return {
    name: "game-html-fallback",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const url = (req.url ?? "").split("?")[0];
        const explicitHtml = /^\/lobby\/game\/[^/]+\/index\.html$/.test(url);
        if (!explicitHtml) {
          if (!req.headers.accept?.includes("text/html")) return next();
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
var vite_config_default = defineConfig({
  base: PUBLIC_URL,
  define: {
    "process.env.PUBLIC_URL": JSON.stringify(PUBLIC_URL)
  },
  plugins: [react(), transitionCurtain(), gameHtmlOutputPath(), gameHtmlFallback(), serviceWorkerPrecache()],
  build: {
    outDir: "lobby",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__vite_injected_original_dirname, "index.html"),
        snake: resolve(__vite_injected_original_dirname, "src/pages/game/snake/index.html"),
        gomoku: resolve(__vite_injected_original_dirname, "src/pages/game/gomoku/index.html"),
        xiangqi: resolve(__vite_injected_original_dirname, "src/pages/game/xiangqi/index.html"),
        othello: resolve(__vite_injected_original_dirname, "src/pages/game/othello/index.html"),
        chess: resolve(__vite_injected_original_dirname, "src/pages/game/chess/index.html"),
        "2048": resolve(__vite_injected_original_dirname, "src/pages/game/2048/index.html"),
        tetris: resolve(__vite_injected_original_dirname, "src/pages/game/tetris/index.html")
      }
    }
  },
  server: {
    port: 5173,
    allowedHosts: ["max.local", "game.jiayou.work", "max.local:5173"],
    proxy: {
      "/api": {
        target: "http://100.125.39.89:8087",
        changeOrigin: true
      },
      // 语音包音频由后端从 server/public/audio 静态托管，dev 下必须转发，否则 /audio/* 打到 Vite
      "/audio": {
        target: "http://100.125.39.89:8087",
        changeOrigin: true
      },
      // 皮肤图同理：server/public/skins/<pack>/<game>/...
      "/skins": {
        target: "http://100.125.39.89:8087",
        changeOrigin: true
      },
      "/socket.io": {
        target: "http://100.125.39.89:8087",
        // socket.io 后端
        ws: true,
        // ⚠️ 关键：启用 WebSocket
        changeOrigin: true
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvamlheW91L3Byb2plY3RzL2hhcmRjb3JlLWdhbWVycy9sb2JieVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL2ppYXlvdS9wcm9qZWN0cy9oYXJkY29yZS1nYW1lcnMvbG9iYnkvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL2ppYXlvdS9wcm9qZWN0cy9oYXJkY29yZS1nYW1lcnMvbG9iYnkvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcsIHR5cGUgUGx1Z2luIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuaW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmNvbnN0IFBVQkxJQ19VUkwgPSAnL2xvYmJ5JztcbmNvbnN0IEdBTUVfU0xVR1MgPSBbJ3NuYWtlJywgJ2dvbW9rdScsICd4aWFuZ3FpJywgJ290aGVsbG8nLCAnY2hlc3MnLCAnMjA0OCcsICd0ZXRyaXMnXTtcblxuLy8gVUktMDc3IGRldiBcdTU2REVcdTkwMDBcdUZGMUFcdTVDMDYgL2xvYmJ5L2dhbWUvPHNsdWc+LyogXHU3Njg0IEhUTUwgXHU1QkZDXHU4MjJBXHU4QkY3XHU2QzQyXHU5MUNEXHU1MTk5XHU1MjMwXHU1QkY5XHU1RTk0XHU1MTY1XHU1M0UzIEhUTUxcdUZGMENcbi8vIFx1NEY3Rlx1NkUzOFx1NjIwRlx1NTE4NVx1OERFRlx1NzUzMVx1RkYwOFx1NTk4MiAvbG9iYnkvZ2FtZS9zbmFrZS9yb29tL2FiY1x1RkYwOVx1NTIzN1x1NjVCMFx1NTQwRVx1NEVDRFx1NzUzMVx1OEJFNVx1NkUzOFx1NjIwRlx1NzY4NFx1NTE2NVx1NTNFM1x1NjNBNVx1N0JBMVx1MzAwMlxuLy8gXHU3NTFGXHU0RUE3XHU3M0FGXHU1ODgzXHU3Njg0XHU1NDBDXHU1NDBEXHU1NkRFXHU5MDAwXHU1NzI4IHNlcnZlci9zcmMvaW5kZXgudHMgXHU0RTJEXHU1QjlFXHU3M0IwXHUzMDAyXG4vLyBVSS0wNzlcdUZGMUFcdTZFOTBcdTc4MDFcdTUxNjVcdTUzRTNcdThGQzFcdTUyMzAgc3JjL3BhZ2VzL2dhbWUvPHNsdWc+L1x1RkYwQ1x1NEVBN1x1NzI2OVx1OERFRlx1NUY4NFx1NEVDRFx1NUY1Mlx1NEUwMFx1NEUzQSBnYW1lLzxzbHVnPi9pbmRleC5odG1sXHVGRjBDXG4vLyBcdTRGRERcdThCQzFcdTY3MERcdTUyQTFcdTdBRUZcdTU2REVcdTkwMDBcdUZGMDhwdWJsaWMvbG9iYnkvZ2FtZS88c2x1Zz4vaW5kZXguaHRtbFx1RkYwOVx1NEUwRVx1NzUyOFx1NjIzNyBVUkwgXHU0RTBEXHU1M0Q4XHUzMDAyXG5mdW5jdGlvbiBnYW1lSHRtbE91dHB1dFBhdGgoKTogUGx1Z2luIHtcbiAgY29uc3QgUFJFRklYID0gJ3NyYy9wYWdlcy9nYW1lLyc7XG4gIHJldHVybiB7XG4gICAgbmFtZTogJ2dhbWUtaHRtbC1vdXRwdXQtcGF0aCcsXG4gICAgZW5mb3JjZTogJ3Bvc3QnLFxuICAgIGdlbmVyYXRlQnVuZGxlKF9vcHRpb25zLCBidW5kbGUpIHtcbiAgICAgIGZvciAoY29uc3QgZmlsZU5hbWUgb2YgT2JqZWN0LmtleXMoYnVuZGxlKSkge1xuICAgICAgICBpZiAoIWZpbGVOYW1lLnN0YXJ0c1dpdGgoUFJFRklYKSB8fCAhZmlsZU5hbWUuZW5kc1dpdGgoJy9pbmRleC5odG1sJykpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBmaWxlID0gYnVuZGxlW2ZpbGVOYW1lXTtcbiAgICAgICAgaWYgKCFmaWxlIHx8IGZpbGUudHlwZSAhPT0gJ2Fzc2V0JykgY29udGludWU7XG4gICAgICAgIGNvbnN0IHRhcmdldCA9IGBnYW1lLyR7ZmlsZU5hbWUuc2xpY2UoUFJFRklYLmxlbmd0aCl9YDtcbiAgICAgICAgZmlsZS5maWxlTmFtZSA9IHRhcmdldDtcbiAgICAgICAgYnVuZGxlW3RhcmdldF0gPSBmaWxlO1xuICAgICAgICBkZWxldGUgYnVuZGxlW2ZpbGVOYW1lXTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8vIFVJLTA3OVx1RkYxQVx1NjMwOVx1Njc4NFx1NUVGQVx1NEVBN1x1NzI2OVx1NzUxRlx1NjIxMCBzdy5qc1x1RkYwQ1x1OTg4NFx1N0YxM1x1NUI1OCA4IFx1NEUyQSBIVE1MIFx1NEUwRVx1NTE2OFx1OTBFOCBjaHVua1x1MzAwMlxuLy8gSFRNTCBcdThENzAgc3RhbGUtd2hpbGUtcmV2YWxpZGF0ZVx1RkYwOFx1NkUzOFx1NjIwRlx1NTE4NVx1OERFRlx1NzUzMVx1NjYyMFx1NUMwNFx1NTIzMFx1OEJFNVx1NkUzOFx1NjIwRlx1NzY4NCBpbmRleC5odG1sXHVGRjA5XHVGRjFCXHU5NzU5XHU2MDAxXHU4RDQ0XHU2RTkwIGNhY2hlLWZpcnN0XHUzMDAyXG4vLyAvYXBpXHUzMDAxL3NvY2tldC5pb1x1MzAwMS9hdWRpb1x1MzAwMS9za2lucyBcdTRFMERcdTU3MjggL2xvYmJ5LyBcdTRFMEJcdUZGMENcdTU5MjlcdTcxMzZcdTRFMERcdTYyRTZcdTYyMkFcdTMwMDJcbmZ1bmN0aW9uIHNlcnZpY2VXb3JrZXJQcmVjYWNoZSgpOiBQbHVnaW4ge1xuICByZXR1cm4ge1xuICAgIG5hbWU6ICdsb2JieS1zdy1wcmVjYWNoZScsXG4gICAgZW5mb3JjZTogJ3Bvc3QnLFxuICAgIGdlbmVyYXRlQnVuZGxlKF9vcHRpb25zLCBidW5kbGUpIHtcbiAgICAgIGNvbnN0IHVybHMgPSBPYmplY3QudmFsdWVzKGJ1bmRsZSlcbiAgICAgICAgLmZpbHRlcihmaWxlID0+XG4gICAgICAgICAgKGZpbGUudHlwZSA9PT0gJ2Fzc2V0JyAmJiAvXFwuKGh0bWx8Y3NzKSQvLnRlc3QoZmlsZS5maWxlTmFtZSkpIHx8XG4gICAgICAgICAgKGZpbGUudHlwZSA9PT0gJ2NodW5rJyAmJiBmaWxlLmZpbGVOYW1lLmVuZHNXaXRoKCcuanMnKSlcbiAgICAgICAgKVxuICAgICAgICAubWFwKGZpbGUgPT4gYCR7UFVCTElDX1VSTH0vJHtmaWxlLmZpbGVOYW1lfWApO1xuICAgICAgY29uc3Qgc291cmNlID0gYGNvbnN0IERBVEEgPSAke0pTT04uc3RyaW5naWZ5KHsgdmVyc2lvbjogRGF0ZS5ub3coKSwgdXJscyB9KX07XG5jb25zdCBDQUNIRSA9ICdsb2JieS0nICsgREFUQS52ZXJzaW9uO1xuY29uc3QgU0hFTEwgPSBuZXcgU2V0KERBVEEudXJscyk7XG5mdW5jdGlvbiBodG1sS2V5KHBhdGhuYW1lKSB7XG4gIGNvbnN0IG0gPSBwYXRobmFtZS5tYXRjaCgvXlxcXFwvbG9iYnlcXFxcL2dhbWVcXFxcLyhbXi9dKykvKTtcbiAgcmV0dXJuIG0gPyAnL2xvYmJ5L2dhbWUvJyArIG1bMV0gKyAnL2luZGV4Lmh0bWwnIDogJy9sb2JieS9pbmRleC5odG1sJztcbn1cbnNlbGYuYWRkRXZlbnRMaXN0ZW5lcignaW5zdGFsbCcsIGV2ZW50ID0+IHtcbiAgZXZlbnQud2FpdFVudGlsKFxuICAgIGNhY2hlcy5vcGVuKENBQ0hFKVxuICAgICAgLnRoZW4oY2FjaGUgPT4gY2FjaGUuYWRkQWxsKFsuLi5TSEVMTF0pKVxuICAgICAgLnRoZW4oKCkgPT4gc2VsZi5za2lwV2FpdGluZygpKVxuICApO1xufSk7XG5zZWxmLmFkZEV2ZW50TGlzdGVuZXIoJ2FjdGl2YXRlJywgZXZlbnQgPT4ge1xuICBldmVudC53YWl0VW50aWwoXG4gICAgY2FjaGVzLmtleXMoKVxuICAgICAgLnRoZW4oa2V5cyA9PiBQcm9taXNlLmFsbChrZXlzLmZpbHRlcihrZXkgPT4ga2V5ICE9PSBDQUNIRSkubWFwKGtleSA9PiBjYWNoZXMuZGVsZXRlKGtleSkpKSlcbiAgICAgIC50aGVuKCgpID0+IHNlbGYuY2xpZW50cy5jbGFpbSgpKVxuICApO1xufSk7XG5zZWxmLmFkZEV2ZW50TGlzdGVuZXIoJ2ZldGNoJywgZXZlbnQgPT4ge1xuICBjb25zdCByZXEgPSBldmVudC5yZXF1ZXN0O1xuICBpZiAocmVxLm1ldGhvZCAhPT0gJ0dFVCcpIHJldHVybjtcbiAgY29uc3QgdXJsID0gbmV3IFVSTChyZXEudXJsKTtcbiAgaWYgKHVybC5vcmlnaW4gIT09IHNlbGYubG9jYXRpb24ub3JpZ2luIHx8ICF1cmwucGF0aG5hbWUuc3RhcnRzV2l0aCgnL2xvYmJ5LycpKSByZXR1cm47XG4gIGlmIChyZXEubW9kZSA9PT0gJ25hdmlnYXRlJykge1xuICAgIGNvbnN0IGtleSA9IGh0bWxLZXkodXJsLnBhdGhuYW1lKTtcbiAgICBldmVudC5yZXNwb25kV2l0aChcbiAgICAgIGNhY2hlcy5tYXRjaChrZXkpLnRoZW4oY2FjaGVkID0+IHtcbiAgICAgICAgY29uc3QgbmV0d29yayA9IGZldGNoKHJlcSkudGhlbihyZXMgPT4ge1xuICAgICAgICAgIGlmIChyZXMgJiYgcmVzLm9rKSBjYWNoZXMub3BlbihDQUNIRSkudGhlbihjYWNoZSA9PiBjYWNoZS5wdXQoa2V5LCByZXMuY2xvbmUoKSkpO1xuICAgICAgICAgIHJldHVybiByZXM7XG4gICAgICAgIH0pLmNhdGNoKCgpID0+IGNhY2hlZCB8fCBSZXNwb25zZS5lcnJvcigpKTtcbiAgICAgICAgcmV0dXJuIGNhY2hlZCB8fCBuZXR3b3JrO1xuICAgICAgfSlcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBldmVudC5yZXNwb25kV2l0aChcbiAgICBjYWNoZXMubWF0Y2gocmVxKS50aGVuKGNhY2hlZCA9PiBjYWNoZWQgfHwgZmV0Y2gocmVxKS50aGVuKHJlcyA9PiB7XG4gICAgICBpZiAocmVzICYmIHJlcy5vaykgY2FjaGVzLm9wZW4oQ0FDSEUpLnRoZW4oY2FjaGUgPT4gY2FjaGUucHV0KHJlcSwgcmVzLmNsb25lKCkpKTtcbiAgICAgIHJldHVybiByZXM7XG4gICAgfSkpXG4gICk7XG59KTtcbmA7XG4gICAgICB0aGlzLmVtaXRGaWxlKHsgdHlwZTogJ2Fzc2V0JywgZmlsZU5hbWU6ICdzdy5qcycsIHNvdXJjZSB9KTtcbiAgICB9XG4gIH07XG59XG5cbi8vIFVJLTA4MFx1RkYxQTggXHU0RTJBIEhUTUwgXHU1MTcxXHU3NTI4XHU1MTg1XHU4MDU0XHU5RUQxXHU1RTU1XHUyMDE0XHUyMDE0XHU1NzI4IDxoZWFkPiBcdTkxQ0NcdTZEODhcdThEMzlcdTY4MDdcdThCQjBcdUZGMENcdTRFMERcdTdCNDkgUmVhY3QgXHU1MzA1XHVGRjFCXHU2NTg3XHU2ODYzIGxvYWQgXHU1NDBFXHU2REUxXHU1MUZBXHUzMDAyXG5mdW5jdGlvbiB0cmFuc2l0aW9uQ3VydGFpbigpOiBQbHVnaW4ge1xuICBjb25zdCBDVVJUQUlOX0tFWSA9ICdsb2JieTpjdXJ0YWluJztcbiAgY29uc3Qgc25pcHBldCA9IGA8c2NyaXB0PlxuKGZ1bmN0aW9uICgpIHtcbiAgdHJ5IHtcbiAgICB2YXIgZmxhZyA9IHNlc3Npb25TdG9yYWdlLmdldEl0ZW0oJyR7Q1VSVEFJTl9LRVl9Jyk7XG4gICAgaWYgKCFmbGFnIHx8IERhdGUubm93KCkgLSBOdW1iZXIoZmxhZykgPiAxMDAwMCkgcmV0dXJuO1xuICAgIHNlc3Npb25TdG9yYWdlLnJlbW92ZUl0ZW0oJyR7Q1VSVEFJTl9LRVl9Jyk7XG4gICAgdmFyIHJvb3QgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQ7XG4gICAgcm9vdC5jbGFzc0xpc3QuYWRkKCdsb2JieS1jdXJ0YWluLW9uJyk7XG4gICAgdmFyIGRvbmUgPSBmYWxzZTtcbiAgICB2YXIgb2ZmID0gZnVuY3Rpb24gKCkge1xuICAgICAgaWYgKGRvbmUpIHJldHVybjtcbiAgICAgIGRvbmUgPSB0cnVlO1xuICAgICAgcm9vdC5jbGFzc0xpc3QuYWRkKCdpcy1mYWRpbmcnKTtcbiAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkgeyByb290LmNsYXNzTGlzdC5yZW1vdmUoJ2xvYmJ5LWN1cnRhaW4tb24nLCAnaXMtZmFkaW5nJyk7IH0sIDIwMCk7XG4gICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignbG9hZCcsIG9mZik7XG4gICAgfTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIG9mZiwgeyBvbmNlOiB0cnVlIH0pO1xuICAgIHNldFRpbWVvdXQob2ZmLCA1MDAwKTtcbiAgfSBjYXRjaCAoZSkge31cbn0pKCk7XG48L3NjcmlwdD5cbjxzdHlsZT5cbmh0bWwubG9iYnktY3VydGFpbi1vbiwgaHRtbC5sb2JieS1jdXJ0YWluLW9uIGJvZHkgeyBiYWNrZ3JvdW5kOiAjMDAwOyB9XG5odG1sLmxvYmJ5LWN1cnRhaW4tb246OmJlZm9yZSB7XG4gIGNvbnRlbnQ6ICcnO1xuICBwb3NpdGlvbjogZml4ZWQ7XG4gIGluc2V0OiAwO1xuICB6LWluZGV4OiAyMTQ3NDgzNjQ3O1xuICBiYWNrZ3JvdW5kOiAjMDAwO1xuICBwb2ludGVyLWV2ZW50czogbm9uZTtcbiAgdHJhbnNpdGlvbjogb3BhY2l0eSAxODBtcyBlYXNlO1xufVxuaHRtbC5sb2JieS1jdXJ0YWluLW9uLmlzLWZhZGluZzo6YmVmb3JlIHsgb3BhY2l0eTogMDsgfVxuPC9zdHlsZT5gO1xuICByZXR1cm4ge1xuICAgIG5hbWU6ICdsb2JieS10cmFuc2l0aW9uLWN1cnRhaW4nLFxuICAgIHRyYW5zZm9ybUluZGV4SHRtbDoge1xuICAgICAgb3JkZXI6ICdwcmUnLFxuICAgICAgaGFuZGxlcihodG1sKSB7XG4gICAgICAgIHJldHVybiBodG1sLmluY2x1ZGVzKCc8L2hlYWQ+JylcbiAgICAgICAgICA/IGh0bWwucmVwbGFjZSgnPC9oZWFkPicsIGAke3NuaXBwZXR9XFxuICA8L2hlYWQ+YClcbiAgICAgICAgICA6IGAke3NuaXBwZXR9XFxuJHtodG1sfWA7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuXG5mdW5jdGlvbiBnYW1lSHRtbEZhbGxiYWNrKCk6IFBsdWdpbiB7XG4gIHJldHVybiB7XG4gICAgbmFtZTogJ2dhbWUtaHRtbC1mYWxsYmFjaycsXG4gICAgY29uZmlndXJlU2VydmVyKHNlcnZlcikge1xuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZSgocmVxLCBfcmVzLCBuZXh0KSA9PiB7XG4gICAgICAgIGlmIChyZXEubWV0aG9kICE9PSAnR0VUJyAmJiByZXEubWV0aG9kICE9PSAnSEVBRCcpIHJldHVybiBuZXh0KCk7XG5cbiAgICAgICAgY29uc3QgdXJsID0gKHJlcS51cmwgPz8gJycpLnNwbGl0KCc/JylbMF07XG4gICAgICAgIC8vIFVJLTA4MFx1RkYxQVx1OEY2Rlx1NUJGQ1x1ODIyQSBmZXRjaCBcdTk4ODRcdTUzRDZcdTc2ODRcdTY2MkYgaW5kZXguaHRtbFx1RkYwOEFjY2VwdCBcdTRFMERcdTY2MkYgdGV4dC9odG1sXHVGRjA5XHVGRjBDXHU0RTVGXHU4OTgxXHU1NkRFXHU5MDAwXHU1MjMwXHU1MTY1XHU1M0UzIEhUTUxcbiAgICAgICAgY29uc3QgZXhwbGljaXRIdG1sID0gL15cXC9sb2JieVxcL2dhbWVcXC9bXi9dK1xcL2luZGV4XFwuaHRtbCQvLnRlc3QodXJsKTtcbiAgICAgICAgaWYgKCFleHBsaWNpdEh0bWwpIHtcbiAgICAgICAgICBpZiAoIXJlcS5oZWFkZXJzLmFjY2VwdD8uaW5jbHVkZXMoJ3RleHQvaHRtbCcpKSByZXR1cm4gbmV4dCgpO1xuICAgICAgICAgIC8vIFx1NUUyNlx1NjI2OVx1NUM1NVx1NTQwRFx1NzY4NFx1OTc1OVx1NjAwMVx1OEQ0NFx1NkU5MFx1RkYwOFx1NTk4MiAvbG9iYnkvZ2FtZS9zbmFrZS9hc3NldHMveC5qc1x1RkYwOVx1NEUwRFx1NjUzOVx1NTE5OVxuICAgICAgICAgIGlmICgvXFwuW14vXSskLy50ZXN0KHVybCkpIHJldHVybiBuZXh0KCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtYXRjaCA9IHVybC5tYXRjaCgvXlxcL2xvYmJ5XFwvZ2FtZVxcLyhbXi9dKykoXFwvLiopPyQvKTtcbiAgICAgICAgY29uc3Qgc2x1ZyA9IG1hdGNoPy5bMV07XG4gICAgICAgIC8vIFx1NjcyQVx1NzdFNSBzbHVnIFx1NEUwRFx1NjUzOVx1NTE5OVx1RkYwQ1x1NEVBNFx1N0VEOSBWaXRlIFx1OUVEOFx1OEJBNFx1NTkwNFx1NzQwNlx1RkYwOFNQQSBcdTU2REVcdTkwMDBcdTYyMTYgNDA0XHVGRjA5XG4gICAgICAgIGlmICghc2x1ZyB8fCAhR0FNRV9TTFVHUy5pbmNsdWRlcyhzbHVnKSkgcmV0dXJuIG5leHQoKTtcblxuICAgICAgICByZXEudXJsID0gYCR7UFVCTElDX1VSTH0vc3JjL3BhZ2VzL2dhbWUvJHtzbHVnfS9pbmRleC5odG1sYDtcbiAgICAgICAgbmV4dCgpO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBiYXNlOiBQVUJMSUNfVVJMLFxuICBkZWZpbmU6IHtcbiAgICAncHJvY2Vzcy5lbnYuUFVCTElDX1VSTCc6IEpTT04uc3RyaW5naWZ5KFBVQkxJQ19VUkwpXG4gIH0sXG4gIHBsdWdpbnM6IFtyZWFjdCgpLCB0cmFuc2l0aW9uQ3VydGFpbigpLCBnYW1lSHRtbE91dHB1dFBhdGgoKSwgZ2FtZUh0bWxGYWxsYmFjaygpLCBzZXJ2aWNlV29ya2VyUHJlY2FjaGUoKV0sXG4gIGJ1aWxkOiB7XG4gICAgb3V0RGlyOiAnbG9iYnknLFxuICAgIHNvdXJjZW1hcDogZmFsc2UsXG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgaW5wdXQ6IHtcbiAgICAgICAgbWFpbjogcmVzb2x2ZShfX2Rpcm5hbWUsICdpbmRleC5odG1sJyksXG4gICAgICAgIHNuYWtlOiByZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9wYWdlcy9nYW1lL3NuYWtlL2luZGV4Lmh0bWwnKSxcbiAgICAgICAgZ29tb2t1OiByZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9wYWdlcy9nYW1lL2dvbW9rdS9pbmRleC5odG1sJyksXG4gICAgICAgIHhpYW5ncWk6IHJlc29sdmUoX19kaXJuYW1lLCAnc3JjL3BhZ2VzL2dhbWUveGlhbmdxaS9pbmRleC5odG1sJyksXG4gICAgICAgIG90aGVsbG86IHJlc29sdmUoX19kaXJuYW1lLCAnc3JjL3BhZ2VzL2dhbWUvb3RoZWxsby9pbmRleC5odG1sJyksXG4gICAgICAgIGNoZXNzOiByZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9wYWdlcy9nYW1lL2NoZXNzL2luZGV4Lmh0bWwnKSxcbiAgICAgICAgJzIwNDgnOiByZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9wYWdlcy9nYW1lLzIwNDgvaW5kZXguaHRtbCcpLFxuICAgICAgICB0ZXRyaXM6IHJlc29sdmUoX19kaXJuYW1lLCAnc3JjL3BhZ2VzL2dhbWUvdGV0cmlzL2luZGV4Lmh0bWwnKVxuICAgICAgfVxuICAgIH1cbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogNTE3MyxcbiAgICBhbGxvd2VkSG9zdHM6IFtcIm1heC5sb2NhbFwiLCBcImdhbWUuamlheW91LndvcmtcIixcIm1heC5sb2NhbDo1MTczXCJdLFxuICAgIHByb3h5OiB7XG4gICAgICAnL2FwaSc6IHtcbiAgICAgICAgdGFyZ2V0OiAnaHR0cDovLzEwMC4xMjUuMzkuODk6ODA4NycsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZVxuICAgICAgfSxcbiAgICAgIC8vIFx1OEJFRFx1OTdGM1x1NTMwNVx1OTdGM1x1OTg5MVx1NzUzMVx1NTQwRVx1N0FFRlx1NEVDRSBzZXJ2ZXIvcHVibGljL2F1ZGlvIFx1OTc1OVx1NjAwMVx1NjI1OFx1N0JBMVx1RkYwQ2RldiBcdTRFMEJcdTVGQzVcdTk4N0JcdThGNkNcdTUzRDFcdUZGMENcdTU0MjZcdTUyMTkgL2F1ZGlvLyogXHU2MjUzXHU1MjMwIFZpdGVcbiAgICAgICcvYXVkaW8nOiB7XG4gICAgICAgIHRhcmdldDogJ2h0dHA6Ly8xMDAuMTI1LjM5Ljg5OjgwODcnLFxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWVcbiAgICAgIH0sXG4gICAgICAvLyBcdTc2QUVcdTgwQTRcdTU2RkVcdTU0MENcdTc0MDZcdUZGMUFzZXJ2ZXIvcHVibGljL3NraW5zLzxwYWNrPi88Z2FtZT4vLi4uXG4gICAgICAnL3NraW5zJzoge1xuICAgICAgICB0YXJnZXQ6ICdodHRwOi8vMTAwLjEyNS4zOS44OTo4MDg3JyxcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlXG4gICAgICB9LFxuICAgICAgJy9zb2NrZXQuaW8nOiB7XG4gICAgICAgIHRhcmdldDogJ2h0dHA6Ly8xMDAuMTI1LjM5Ljg5OjgwODcnLCAvLyBzb2NrZXQuaW8gXHU1NDBFXHU3QUVGXG4gICAgICAgIHdzOiB0cnVlLCAgICAgICAgICAgICAgICAgICAgICAgIC8vIFx1MjZBMFx1RkUwRiBcdTUxNzNcdTk1MkVcdUZGMUFcdTU0MkZcdTc1MjggV2ViU29ja2V0XG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgIH1cbiAgICB9XG4gIH1cbn0pOyJdLAogICJtYXBwaW5ncyI6ICI7QUFBc1QsU0FBUyxvQkFBaUM7QUFDaFcsT0FBTyxXQUFXO0FBQ2xCLFNBQVMsZUFBZTtBQUZ4QixJQUFNLG1DQUFtQztBQUl6QyxJQUFNLGFBQWE7QUFDbkIsSUFBTSxhQUFhLENBQUMsU0FBUyxVQUFVLFdBQVcsV0FBVyxTQUFTLFFBQVEsUUFBUTtBQU90RixTQUFTLHFCQUE2QjtBQUNwQyxRQUFNLFNBQVM7QUFDZixTQUFPO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixTQUFTO0FBQUEsSUFDVCxlQUFlLFVBQVUsUUFBUTtBQUMvQixpQkFBVyxZQUFZLE9BQU8sS0FBSyxNQUFNLEdBQUc7QUFDMUMsWUFBSSxDQUFDLFNBQVMsV0FBVyxNQUFNLEtBQUssQ0FBQyxTQUFTLFNBQVMsYUFBYSxFQUFHO0FBQ3ZFLGNBQU0sT0FBTyxPQUFPLFFBQVE7QUFDNUIsWUFBSSxDQUFDLFFBQVEsS0FBSyxTQUFTLFFBQVM7QUFDcEMsY0FBTSxTQUFTLFFBQVEsU0FBUyxNQUFNLE9BQU8sTUFBTSxDQUFDO0FBQ3BELGFBQUssV0FBVztBQUNoQixlQUFPLE1BQU0sSUFBSTtBQUNqQixlQUFPLE9BQU8s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
