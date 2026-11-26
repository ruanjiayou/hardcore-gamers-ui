import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

/** 跨入口跳转禁止用 react-router 的 navigate，必须用 navigation.ts 的 go() */
const CROSS_ENTRY_NAVIGATE = [
  "navigate('/lobby'",
  'navigate(`/lobby',
  "navigate('/me'",
  'navigate(`/me',
  "navigate('/login'",
  'navigate(`/login',
  "navigate('/user'",
  'navigate(`/user',
  'navigate(`/game/',
  "navigate('/game/",
];

const COMPONENT_FILES = [
  'src/components/GameList.tsx',
  'src/components/UserMenu.tsx',
  'src/components/InviteToast.tsx',
  'src/components/LoginRequired.tsx',
  'src/components/Navbar.tsx',
  'src/pages/Login.tsx',
];

/** 这些文件里必须出现 go( 并自 ../navigation 引入 */
const NEEDS_GO = [
  'src/components/GameList.tsx',
  'src/components/InviteToast.tsx',
  'src/components/UserMenu.tsx',
  'src/components/LoginRequired.tsx',
  'src/pages/Login.tsx',
  'src/components/Navbar.tsx',
];

const SLUGS = ['snake', 'gomoku', 'xiangqi', 'othello', 'chess', '2048', 'tetris'];

// 去掉注释，避免注释里的历史写法造成误报
function stripComments(src: string): string {
  let out = '';
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (lineComment) {
      if (c === '\n') { lineComment = false; out += c; }
      continue;
    }
    if (blockComment) {
      if (c === '*' && next === '/') { blockComment = false; i++; }
      else if (c === '\n') out += c;
      continue;
    }
    if (quote) {
      out += c;
      if (c === '\\') { out += next ?? ''; i++; }
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { lineComment = true; i++; continue; }
    if (c === '/' && next === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
    out += c;
  }
  return out;
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

describe('跨入口跳转走整页 go()，不残留 SPA navigate', () => {
  test('6 个公共入口文件不得含跨入口 navigate（允许 navigate(-1)）', () => {
    const problems: string[] = [];
    for (const rel of COMPONENT_FILES) {
      const code = stripComments(read(rel));
      for (const pattern of CROSS_ENTRY_NAVIGATE) {
        if (code.includes(pattern)) problems.push(`${rel}: 含 ${pattern}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('需要跨入口跳转的文件都 import go 并实际调用 go(', () => {
    const problems: string[] = [];
    for (const rel of NEEDS_GO) {
      const code = stripComments(read(rel));
      if (!/from ['"]\.\.\/navigation['"]/.test(code)) {
        problems.push(`${rel}: 未从 ../navigation import`);
      }
      if (!/\bimport\s*\{[^}]*\bgo\b[^}]*\}\s*from\s*['"]\.\.\/navigation['"]/.test(code)) {
        problems.push(`${rel}: 未从 ../navigation import go`);
      }
      if (!/\bgo\s*\(/.test(code)) problems.push(`${rel}: 未出现 go(`);
    }
    expect(problems).toEqual([]);
  });

  test('AppFrame 有 showNavbar prop 并按它条件渲染 Navbar', () => {
    const code = stripComments(read('src/bootstrap/AppFrame.tsx'));
    expect(code).toContain('showNavbar');
    expect(code).toMatch(/showNavbar\s*=\s*true/);
    expect(code).toMatch(/showNavbar\s*&&\s*<Navbar\s*\/?>/);
  });

  test('7 个游戏入口 mountEntry 传 { showNavbar: false }', () => {
    const problems: string[] = [];
    for (const slug of SLUGS) {
      const rel = `game/${slug}/main.tsx`;
      if (!existsSync(join(ROOT, rel))) {
        problems.push(`${rel}: 文件不存在`);
        continue;
      }
      const code = stripComments(read(rel));
      if (!/mountEntry\s*\(/.test(code)) problems.push(`${rel}: 没有 mountEntry(`);
      if (!/showNavbar\s*:\s*false/.test(code)) problems.push(`${rel}: 未传 showNavbar: false`);
    }
    expect(problems).toEqual([]);
  });

  test('LoginRequired 不再导出 loginUrl，改用 loginRedirectUrl', () => {
    const code = stripComments(read('src/components/LoginRequired.tsx'));
    expect(code).not.toMatch(/export\s+function\s+loginUrl\s*\(/);
    expect(code).toMatch(/export\s+function\s+loginRedirectUrl\s*\(/);
  });

  test('去登录用 window.location 绝对 path 拼 redirect（不用 react-router 相对 pathname）', () => {
    const code = stripComments(read('src/components/LoginRequired.tsx'));
    expect(code).toContain('window.location.pathname + window.location.search');
  });

  test('登录页 redirect 只接受以 /lobby 开头的路径', () => {
    const code = stripComments(read('src/pages/Login.tsx'));
    expect(code).toContain("'/lobby/'");
    expect(code).toContain("'/lobby'");
    expect(code).toMatch(/startsWith/);
  });
});
