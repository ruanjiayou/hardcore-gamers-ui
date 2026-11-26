/**
 * UI-079：生产环境注册入口预缓存 Service Worker。
 * dev 不注册——Vite 热更新的模块不应被 SW 缓存，否则会拿到旧代码。
 */
export function registerPwa(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const run = () => {
    void navigator.serviceWorker.register('/lobby/sw.js', { scope: '/lobby/' }).catch(() => {
      // SW 注册失败不影响正常使用，静默降级到纯网络
    });
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
}
