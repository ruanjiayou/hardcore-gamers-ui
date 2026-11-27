/**
 * UI-087 跨入口转场与 URL 助手（UI-091 去掉转场遮罩，缓存加载逻辑不变）。
 *
 * 一次转场（进游戏带进度层，关游戏不带）：
 *   push 加载路由 → 预取=PWA 缓存 + 该游戏资源清单缓存 → 1s 下限 → replace 文档
 * 失败回滚 URL + 进度层；加载路由刷新由 HTML <head> 内联脚本 replace 回真实目标。
 */
import { getAssetManifest, type AssetManifest } from './services/api';
import { assetUrls, cacheGameAssets } from './services/assetCache';
import { saveGameManifest } from './services/assets';

/** 从 URL 取游戏 slug；大厅/加载路由返回空 */
export function gameSlugOf(pathname: string): string {
  return pathname.match(/^\/lobby\/game\/([^/]+)/)?.[1] || '';
}

const LOBBY = '/lobby';
const LOADING_ROUTE = `${LOBBY}/loading`;
const ASSET_MANIFEST_URL = `${LOBBY}/asset-manifest.json`;

const WARM_NAV_KEY = 'lobby:warm-nav';
const WARM_NAV_TTL = 10_000;
const MIN_LOADING_MS = 1000;

/**
 * UI-100/112：无尽匹配成功 → 跳转房间页时打标记，房间页首帧就知道这是竞技场，
 * 直接进沉浸 canvas，避免房间壳/玩家列表闪一下。
 * UI-112：标记同时写进 URL（`?arena=1`），刷新/前进后退仍保持沉浸；sessionStorage
 * 那份只作为匹配跳转途中的兼容兜底，一次性消费，不影响直接打开房间地址。
 */
const ARENA_ENTRY_KEY = 'lobby:arena-entry';

export function markArenaEntry(roomId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.setItem(ARENA_ENTRY_KEY, roomId); } catch { /* 隐私模式忽略 */ }
}

/** 竞技场房间地址：带 arena=1，刷新后仍能识别为全屏对战页（UI-112） */
export function arenaRoomUrl(slug: string, roomId: string): string {
  return `${gameUrl(slug, `/room/${roomId}`)}?arena=1`;
}

/** 房间页 URL 是否带竞技场沉浸标记 */
export function isArenaEntryUrl(search: string): boolean {
  if (typeof URLSearchParams !== 'undefined') return new URLSearchParams(search).get('arena') === '1';
  return /[?&]arena=1(?:&|$)/.test(search);
}

export function consumeArenaEntry(roomId?: string): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    const stored = sessionStorage.getItem(ARENA_ENTRY_KEY);
    sessionStorage.removeItem(ARENA_ENTRY_KEY);
    return !!stored && (!roomId || stored === roomId);
  } catch {
    return false;
  }
}

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

/**
 * UI-104：游戏入口 → 大厅子页（/me、/user/:id、/login）。
 * 与「关游戏回大厅」不同，这些跳转必须保留历史，浏览器返回才能回到刚离开的游戏页。
 * 大厅根（/lobby/）不算子页：它走 isBackToLobby 的 replace 分支。
 */
export function isLobbySubpage(currentPathname: string, targetUrl: string): boolean {
  if (!isBackToLobby(currentPathname, targetUrl)) return false;
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const target = new URL(targetUrl, origin);
  const sub = target.pathname.slice(LOBBY.length).replace(/^\/+|\/+$/g, '');
  return sub === 'me' || sub === 'login' || sub.startsWith('user/');
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

// ---- 进度层：DOM 直建，不依赖 React Router，任何入口都能显示 ----

function showLoader(): void {
  if (typeof document === 'undefined' || loaderEl) return;
  if (!document.getElementById('lobby-loader-style')) {
    const style = document.createElement('style');
    style.id = 'lobby-loader-style';
    style.textContent = `
#lobby-loader-overlay{position:fixed;inset:0;z-index:2147483648;display:flex;align-items:center;justify-content:center;background:var(--lobby-page-gradient);color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.lobby-loader-box{width:min(360px,78vw);text-align:center}
.lobby-loader-title{font-size:16px;letter-spacing:1px;margin-bottom:14px;text-shadow:0 2px 8px rgba(0,0,0,.35)}
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

/** 直达游戏冷启动复用同一套进度层（软导航内部仍调用 showLoader） */
export function startEntryLoader(): void { showLoader(); }
export function updateEntryLoader(done: number, total: number): void { setLoaderProgress(done, total); }
export function stopEntryLoader(): void { hideLoader(); }

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
    // UI-110：目标若属于某个游戏，按 slug 拉服务端清单并缓存该游戏全部资源
    const slug = gameSlugOf(pathname);
    let gameManifest: AssetManifest | null = null;
    if (slug) {
      try {
        const res = await getAssetManifest(slug);
        if (res.data?.code === 0 && res.data?.data) {
          gameManifest = res.data.data;
          // UI-111：过桥给目标文档，游戏主页首帧就显示已装备皮肤，不先闪默认图
          saveGameManifest(slug, gameManifest);
        }
      } catch {
        // 清单接口失败不阻断入口 HTML 的预取；对局仍能玩，只是没有自定义图
      }
    }
    const gameUrls = gameManifest ? assetUrls(gameManifest) : [];
    const total = urls.length + 1 + gameUrls.length; // +1 算入口 HTML
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
    if (gameManifest) {
      await cacheGameAssets(gameManifest, {
        onProgress: d => report(1 + urls.length + d, total),
      });
    }
  } finally {
    activeFetch = previousFetch;
  }
}

// ---- 热导航标记：目标文档据此跳过全屏 Loading ----

export function markWarmNav(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(WARM_NAV_KEY, String(Date.now()));
  } catch {
    // 隐私模式下 sessionStorage 可能不可写
  }
}

/** 失败回滚/主动取消时清掉标记，避免下一个冷启动误判为热导航。 */
export function clearTransitionFlags(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(WARM_NAV_KEY);
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
 * 任一入口 HTML 预取失败 → 回滚 URL + 撤进度层，留在原页面。
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
  const subpage = isLobbySubpage(window.location.pathname, target.pathname);
  navigating = true;
  try {
    if (back) {
      // 关游戏 / 跳大厅子页：无进度页、不强制 1s，但同样先预取完成才换文档
      await prefetchTarget(target.pathname);
      markWarmNav();
      if (subpage) {
        // UI-104：玩家中心等子页保留历史，返回按钮（navigate(-1)）才能回到游戏页
        window.location.assign(url);
      } else {
        // 关游戏：replace 掉游戏文档，避免浏览器返回又回到游戏
        window.location.replace(url);
      }
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
    window.location.replace(url);
  } catch (error) {
    console.warn('软导航预取失败，回滚到原页面', error);
    hideLoader();
    clearTransitionFlags();
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
