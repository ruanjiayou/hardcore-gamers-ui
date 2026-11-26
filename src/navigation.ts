const LOBBY = '/lobby';
const WARM_NAV_KEY = 'lobby:warm-nav';
const CURTAIN_KEY = 'lobby:curtain';
const WARM_NAV_TTL = 10_000;

// 纯字符串拼接：每一段都去掉首尾斜杠，避免出现 //
function joinPath(base: string, ...parts: Array<string | undefined>): string {
  const tail = parts
    .filter((part): part is string => part !== undefined && part !== '')
    .map(part => part.replace(/^\/+|\/+$/g, ''))
    .filter(part => part !== '')
    .join('/');
  return tail === '' ? base : `${base}/${tail}`;
}

/** 游戏入口：可选 path 可以是 'room/abc' 或 '/room/abc' */
export function gameUrl(slug: string, path = ''): string {
  return joinPath(`${LOBBY}/game/${slug}`, path);
}

export function lobbyUrl(): string {
  return `${LOBBY}/`;
}

export function loginUrl(): string {
  return joinPath(LOBBY, 'login');
}

export function profileUrl(): string {
  return joinPath(LOBBY, 'me');
}

export function userUrl(id: string): string {
  return joinPath(LOBBY, 'user', id);
}

export function playerUrl(slug: string, playerId: string): string {
  return joinPath(LOBBY, 'game', slug, 'player', playerId);
}

/** 当前 URL 属于哪个 HTML 入口根：公共 /lobby 或 /lobby/game/<slug>。 */
export function entryRootOf(pathname: string): string {
  const match = pathname.match(/^\/lobby\/game\/([^/]+)/);
  return match ? `/lobby/game/${match[1]}` : LOBBY;
}

/** 同入口内跳转可以用 react-router push，不必换文档。 */
export function isSameEntry(currentPathname: string, targetUrl: string): boolean {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const target = new URL(targetUrl, origin);
  return entryRootOf(currentPathname) === entryRootOf(target.pathname);
}

/** 软导航预取用的缓存 key：游戏路由 → 该游戏 index.html，其余公共路由 → 公共 index.html。 */
export function cacheUrlOf(pathname: string): string {
  const match = pathname.match(/^\/lobby\/game\/([^/]+)/);
  return match ? `/lobby/game/${match[1]}/index.html` : '/lobby/index.html';
}

// AppFrame 在 Router 内注入 navigate；socket 回调也能复用它做 push。
let entryNavigate: ((to: string) => void) | null = null;
let currentEntryRoot = LOBBY;
let navigating = false;

export function registerEntryNav(basename: string, navigate: (to: string) => void): void {
  currentEntryRoot = entryRootOf(basename);
  entryNavigate = navigate;
}

function showCurtain(): void {
  if (typeof document !== 'undefined') document.documentElement.classList.add('lobby-curtain-on');
}

function hideCurtain(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.add('is-fading');
    setTimeout(() => document.documentElement.classList.remove('lobby-curtain-on', 'is-fading'), 200);
  }
}

/** 跨入口跳转前打标：目标文档据此亮黑幕并跳过全屏 Loading（UI-079/UI-080）。 */
export function markWarmNav(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const now = String(Date.now());
    sessionStorage.setItem(WARM_NAV_KEY, now);
    sessionStorage.setItem(CURTAIN_KEY, now);
  } catch {
    // 隐私模式下 sessionStorage 可能不可写，忽略即可
  }
}

function clearWarmNav(): void {
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
    clearWarmNav();
    if (!raw) return false;
    return Date.now() - Number(raw) < WARM_NAV_TTL;
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

/**
 * UI-080 软导航：先 push URL + 盖黑幕，后台 fetch 命中 SW 预缓存的目标 HTML，
 * 预取成功再 location.replace 真正换文档；失败则回滚 URL、撤幕、留在原页面。
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

  navigating = true;
  markWarmNav();
  showCurtain();
  try {
    history.pushState({ lobbySoftNav: true }, '', target.pathname + target.search + target.hash);
    const response = await fetch(cacheUrlOf(target.pathname));
    if (!response.ok) throw new Error(`预取失败: ${response.status}`);
    // 让黑幕至少绘制一帧，再换文档
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    window.location.replace(url);
  } catch (error) {
    console.warn('软导航预取失败，回滚到原页面', error);
    clearWarmNav();
    hideCurtain();
    history.back();
    navigating = false;
  }
}

/** 浏览器后退/前进：跨入口要重载文档，同入口交给 React Router。 */
export function installSoftNavPopstate(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('popstate', () => {
    if (navigating) return;
    if (entryRootOf(window.location.pathname) !== currentEntryRoot) {
      markWarmNav();
      showCurtain();
      window.location.reload();
    }
  });
}

/**
 * 浏览器里做跳转：同入口走 react-router push；跨入口走软导航（预取 + 黑幕换文档）。
 * node 测试环境下不触发任何跳转。
 */
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
