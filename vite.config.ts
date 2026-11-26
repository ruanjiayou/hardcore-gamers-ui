import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const PUBLIC_URL = '/lobby';
const GAME_SLUGS = ['snake', 'gomoku', 'xiangqi', 'othello', 'chess', '2048', 'tetris'];

// UI-077 dev 回退：将 /lobby/game/<slug>/* 的 HTML 导航请求重写到对应入口 HTML，
// 使游戏内路由（如 /lobby/game/snake/room/abc）刷新后仍由该游戏的入口接管。
// 生产环境的同名回退在 server/src/index.ts 中实现。
function gameHtmlFallback(): Plugin {
  return {
    name: 'game-html-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (!req.headers.accept?.includes('text/html')) return next();

        const url = (req.url ?? '').split('?')[0];
        // 带扩展名的静态资源（如 /lobby/game/snake/assets/x.js）不改写
        if (/\.[^/]+$/.test(url)) return next();

        const match = url.match(/^\/lobby\/game\/([^/]+)(\/.*)?$/);
        const slug = match?.[1];
        // 未知 slug 不改写，交给 Vite 默认处理（SPA 回退或 404）
        if (!slug || !GAME_SLUGS.includes(slug)) return next();

        req.url = `${PUBLIC_URL}/game/${slug}/index.html`;
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
  plugins: [react(), gameHtmlFallback()],
  build: {
    outDir: 'lobby',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        snake: resolve(__dirname, 'game/snake/index.html'),
        gomoku: resolve(__dirname, 'game/gomoku/index.html'),
        xiangqi: resolve(__dirname, 'game/xiangqi/index.html'),
        othello: resolve(__dirname, 'game/othello/index.html'),
        chess: resolve(__dirname, 'game/chess/index.html'),
        '2048': resolve(__dirname, 'game/2048/index.html'),
        tetris: resolve(__dirname, 'game/tetris/index.html')
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