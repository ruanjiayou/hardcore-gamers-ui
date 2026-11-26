const LOBBY = '/lobby';
const WARM_NAV_KEY = 'lobby:warm-nav';
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

// AppFrame 在 Router 内注入 navigate；socket 回调也能复用它做 push。
let entryNavigate: ((to: string) => void) | null = null;

export function registerEntryNav(navigate: (to: string) => void): void {
  entryNavigate = navigate;
}

/** 跨入口整页跳转前打标：目标文档据此跳过全屏 Loading，改显细进度条（UI-079）。 */
export function markWarmNav(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(WARM_NAV_KEY, String(Date.now()));
  } catch {
    // 隐私模式下 sessionStorage 可能不可写，忽略即可
  }
}

export function consumeWarmNav(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    const raw = sessionStorage.getItem(WARM_NAV_KEY);
    sessionStorage.removeItem(WARM_NAV_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < WARM_NAV_TTL;
  } catch {
    return false;
  }
}

/**
 * 浏览器里做跳转：同入口走 react-router push，跨入口才整页导航。
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
    const root = entryRootOf(window.location.pathname);
    const relative = target.pathname.slice(root.length) || '/';
    entryNavigate(`${relative}${target.search}${target.hash}`);
    return;
  }
  markWarmNav();
  window.location.href = url;
}
