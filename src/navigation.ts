const LOBBY = '/lobby';

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

/** 浏览器里做跳转；node 测试环境不调用 */
export function go(url: string): void {
  if (typeof window !== 'undefined') {
    window.location.href = url;
  }
}
