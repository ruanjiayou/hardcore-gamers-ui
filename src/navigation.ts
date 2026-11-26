/**
 * UI-087 跨入口转场与 URL 助手。
 *
 * 一次转场是固定的六步流水线（进游戏带进度层，关游戏不带）：
 *   push 加载路由 → 预取=PWA 缓存 → 1s 下限 → 黑幕 → replace 文档 → 首屏撤幕
 * 这里只负责编排；黑幕的即时绘制由 HTML <head> 内联脚本完成，撤幕由 AppBootstrap
 * 在 React 首屏 mount 后调用 dismissCurtain()。
 */

const LOBBY = '/lobby';
const LOADING_ROUTE = `${LOBBY}/loading`;
const ASSET_MANIFEST_URL = `${LOBBY}/asset-manifest.json`;
const WARM_NAV_KEY = 'lobby:warm-nav';
const CURTAIN_KEY = 'lobby:curtain';
const WARM_NAV_TTL = 10_000;
const MIN_LOADING_MS = 1000;

// 纯字符串拼接：每一段都去掉首尾斜杠，避免出现 //
function joinPath(base: string, ...parts: Array<string | undefined>): string {
  const tail = parts
    .filter((part): part is string => part !== undefined && part !== '')
    .map(part => part.replace(/^\/+|\/+$/g, ''))
    .filter(part => part !== '')
    .join('/');
  return tail === '' ? base : `${base}/${tail}`;
}

export function gameUrl(slug: string, path = ''): string {
  return joinPath(`${LOBBY}/game/${slug}`, path);
}
export function lobbyUrl(): string { return `${LOBBY}/`; }
export function loginUrl(): string { return joinPath(LOBBY, 'login'); }
export function profileUrl(): string { return joinPath(LOBBY, 'me'); }
export function userUrl(id: string): string { return joinPath(LOBBY, 'user', id); }
export function playerUrl(slug: string, playerId: string): string {
  return joinPath(LOBBY, 'game', slug, 'player', playerId);
}

/** 加载路由把真实目标编码进 to，刷新后由 <head> 内联脚本 replace 回去。 */
export function loadingUrlOf(target: string): string {
  return `${LOADING_ROUTE}?to=${encodeURIComponent(target)}`;
}

/** 当前 URL 属于哪个 HTML 入口根：公共 /lobby 或 /lobby/game/<slug>。 */
export function entryRootOf(pathname: string): string {
  const match = pathname.match(/^\/lobby\/game\/([^/]+)/);
  return match ? `/lobby/game/${match[1]}` : LOBBY;
}

/** 只有「游戏入口 → 公共入口」才算回大厅（关游戏）。 */
export function isBackToLobby(currentPathname: string, targetUrl: string): boolean {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const target = new URL(targetUrl, origin);
  return entryRootOf(currentPathname) !== LOBBY && entryRootOf(target.pathname) === LOBBY;
}

/** 同入口内跳转用 react-router push，不必换文档。 */
export function isSameEntry(currentPathname: string, targetUrl: string): boolean {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const target = new URL(targetUrl, origin);
  return entryRootOf(currentPathname) === entryRootOf(target.pathname);
}

/** 软导航预取用的缓存 key：游戏路由 → 该游戏 index.html，其余 → 公共 index.html。 */
export function cacheUrlOf(pathname: string): string {
  const match = pathname.match(/^\/lobby\/game\/([^/]+)/);
  return match ? `/lobby/game/${match[1]}/index.html` : '/lobby/index.html';
}

// AppFrame 在 Router 内注入 navigate；socket 回调也能复用它做 push。
let entryNavigate: ((to: string) => void) | null = null;
let currentEntryRoot = LOBBY;
let navigating = false;
let loaderEl: HTMLElement | null = null;
let loaderStartedAt = 0;

export function registerEntryNav(basename: string, navigate: (to: string) => void): void {
  currentEntryRoot = entryRootOf(basename);
  entryNavigate = navigate;
}

// ---- 黑幕：亮幕在换文档前，撤幕在新页首屏 mount 后 ----

function showCurtain(): void {
  if (typeof document !== 'undefined') document.documentElement.classList.add('lobby-curtain-on');
}

function hideCurtain(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.add('is-fading');
  setTimeout(() => root.classList.remove('lobby-curtain-on', 'is-fading'), 200);
}

/** 新文档 React 首屏渲染后调用：此时内容已在，撤幕不会露空白。 */
export function dismissCurtain(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root.classList.contains('lobby-curtain-on')) return;
  root.classList.add('is-fading');
  setTimeout(() => root.classList.remove('lobby-curtain-on', 'is-fading'), 200);
}

// ---- 进度层：DOM 直建，不依赖 React Router，任何入口都能显示 ----

function showLoader(): void {
  if (typeof document === 'undefined' || loaderEl) return;
  if (!document.getElementById('lobby-loader-style')) {
    const style = document.createElement('style');
    style.id = 'lobby-loader-style';
    style.textContent = `
#lobby-loader-overlay{position:fixed;inset:0;z-index:2147483648;display:flex;align-items:center;justify-content:center;background:#0f1020;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.lobby-loader-box{width:min(360px,78vw);text-align:center}
.lobby-loader-title{font-size:16px;letter-spacing:1px;margin-bottom:14px}
.lobby-loader-track{height:6px;border-radius:99px;background:rgba(255,255,255,.18);overflow:hidden}
.lobby-loader-bar{height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#6d5efc,#00d4ff);transition:width .18s ease}
.lobby-loader-percent{margin-top:10px;font-size:13px;opacity:.8}`;
    document.head.appendChild(style);
  }
  const el = document.createElement('div');
  el.id = 'lobby-loader-overlay';
  el.innerHTML = '<div class="lobby-loader-box">'
    + '<div class="lobby-loader-title">正在加载游戏资源</div>'
    + '<div class="lobby-loader-track"><div class="lobby-loader-bar"></div></div>'
    + '<div class="lobby-loader-percent">0%</div></div>';
  document.body.appendChild(el);
  loaderStartedAt = Date.now();
  loaderEl = el;
}

function setLoaderProgress(done: number, total: number): void {
  if (!loaderEl) return;
  const pct = total > 0 ? Math.round(done / total * 100) : 100;
  const bar = loaderEl.querySelector('.lobby-loader-bar') as HTMLElement | null;
  const text = loaderEl.querySelector('.lobby-loader-percent');
  if (bar) bar.style.width = `${pct}%`;
  if (text) text.textContent = `${pct}%`;
}

function hideLoader(): void {
  loaderEl?.remove();
  loaderEl = null;
  if (typeof document !== 'undefined') document.getElementById('lobby-loader-style')?.remove();
}

// ---- 预取 = 进度条：入口 HTML 单独抓，其余资源 allSettled ----

interface FetchResponse {
  ok: boolean;
  json?: () => Promise<unknown>;
}
type FetchLike = (url: string) => Promise<FetchResponse>;

// 生产用全局 fetch（被 SW 拦截写缓存）；测试可注入假 fetch 验证逐项进度。
let activeFetch: FetchLike = url => fetch(url);

async function fetchEntryHtml(pathname: string): Promise<void> {
  const response = await activeFetch(cacheUrlOf(pathname));
  if (!response.ok) throw new Error(`预取失败: ${pathname}`);
}

/**
 * 预取目标入口的 HTML 与清单列出的 JS/CSS。
 * 入口 HTML 失败 → 抛错回滚；资源失败 → allSettled 吞掉，进度仍走满。
 * onProgress 收到的事件就是进度条的唯一数据源。
 */
export async function prefetchTarget(
  pathname: string,
  options: { fetcher?: FetchLike; onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  const previousFetch = activeFetch;
  if (options.fetcher) activeFetch = options.fetcher;
  const report = options.onProgress ?? setLoaderProgress;
  try {
    // UI-080 骨架：入口 HTML 先成功，否则整段回滚
    await fetchEntryHtml(pathname);
    let urls: string[] = [];
    try {
      const response = await activeFetch(ASSET_MANIFEST_URL);
      if (response.ok && response.json) {
        const manifest = await response.json() as Record<string, string[]>;
        if (Array.isArray(manifest[cacheUrlOf(pathname)])) {
          urls = manifest[cacheUrlOf(pathname)].filter(url => url !== cacheUrlOf(pathname));
        }
      }
    } catch {
      // 旧部署没有清单接口：入口 HTML 已成功，进度直接到 100%
    }
    const total = urls.length + 1; // +1 算入口 HTML
    let done = 1;
    report(done, total);
    await Promise.allSettled(urls.map(async url => {
      try {
        await activeFetch(url);
      } finally {
        done += 1;
        report(done, total);
      }
    }));
  } finally {
    activeFetch = previousFetch;
  }
}

// ---- 热导航标记：目标文档据此亮幕并跳过全屏 Loading ----

export function markWarmNav(withCurtain = true): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const now = String(Date.now());
    sessionStorage.setItem(WARM_NAV_KEY, now);
    if (withCurtain) sessionStorage.setItem(CURTAIN_KEY, now);
    else sessionStorage.removeItem(CURTAIN_KEY);
  } catch {
    // 隐私模式下 sessionStorage 可能不可写
  }
}

/** 失败回滚/主动取消时清掉两个标记，避免下一个冷启动误亮幕。 */
export function clearTransitionFlags(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(WARM_NAV_KEY);
    sessionStorage.removeItem(CURTAIN_KEY);
  } catch {
    // 忽略
  }
}

export function consumeWarmNav(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    const raw = sessionStorage.getItem(WARM_NAV_KEY);
    clearTransitionFlags();
    return !!raw && Date.now() - Number(raw) < WARM_NAV_TTL;
  } catch {
    return false;
  }
}

function pushInEntry(target: URL): void {
  if (!entryNavigate) return;
  const root = entryRootOf(window.location.pathname);
  const relative = target.pathname.slice(root.length) || '/';
  entryNavigate(`${relative}${target.search}${target.hash}`);
}

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/**
 * 跨入口软导航：一条流水线，只有「是否显示进度层」的分支差别。
 * 任一入口 HTML 预取失败 → 回滚 URL + 撤层撤幕，留在原页面。
 */
export async function softGo(url: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const target = new URL(url, window.location.origin);
  if (target.origin !== window.location.origin) {
    window.location.href = url;
    return;
  }
  if (navigating) return;
  if (entryNavigate && isSameEntry(window.location.pathname, url)) {
    pushInEntry(target);
    return;
  }

  const back = isBackToLobby(window.location.pathname, target.pathname);
  navigating = true;
  try {
    if (back) {
      // 关游戏：无进度页、不强制 1s，但也先预取完成才亮幕
      await prefetchTarget(target.pathname);
      markWarmNav();
      showCurtain();
      await nextFrame();
      window.location.replace(url);
      return;
    }
    // 进游戏：先 push 加载路由并显示真实进度
    history.pushState(
      { lobbySoftNav: true, lobbyLoading: true },
      '',
      loadingUrlOf(target.pathname + target.search + target.hash)
    );
    showLoader();
    await nextFrame(); // 先让加载路由与进度条绘制一帧
    await prefetchTarget(target.pathname, { onProgress: setLoaderProgress });
    const elapsed = Date.now() - loaderStartedAt;
    if (elapsed < MIN_LOADING_MS) {
      await new Promise<void>(resolve => setTimeout(resolve, MIN_LOADING_MS - elapsed));
    }
    markWarmNav();
    showCurtain();
    await nextFrame(); // 黑幕至少绘制一帧再换文档
    window.location.replace(url);
  } catch (error) {
    console.warn('软导航预取失败，回滚到原页面', error);
    hideLoader();
    clearTransitionFlags();
    hideCurtain();
    history.back();
  } finally {
    navigating = false;
  }
}

/** 浏览器前进/后退：跨入口要重载文档，同入口交给 React Router。 */
export function installSoftNavPopstate(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('popstate', () => {
    if (navigating) return;
    if (entryRootOf(window.location.pathname) === currentEntryRoot) return;
    markWarmNav();
    showCurtain();
    window.location.reload();
  });
}

/** 浏览器里跳转：同入口 push；跨入口走软导航；node 测试环境不触发跳转。 */
export function go(url: string): void {
  if (typeof window === 'undefined') return;
  const target = new URL(url, window.location.origin);
  if (target.origin !== window.location.origin) {
    window.location.href = url;
    return;
  }
  if (entryNavigate && isSameEntry(window.location.pathname, url)) {
    pushInEntry(target);
    return;
  }
  void softGo(url);
}
