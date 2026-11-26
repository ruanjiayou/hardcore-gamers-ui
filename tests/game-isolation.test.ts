import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SLUGS = ['snake', 'gomoku', 'xiangqi', 'othello', 'chess', '2048', 'tetris'];
const PAGES = ['index', 'Room', 'Play', 'Friends', 'Skins', 'Player'];

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

// 去掉行注释/块注释，但保留字符串字面量里的文字
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

// 精确 token 匹配：不能把 international-chess 里的 chess 当成独立 slug；
// 后向不排除 `-`，这样 chess-board 这类 kebab 名仍会被检出。
function slugToken(slug: string): RegExp {
  const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${esc}(?![\\w])`);
}

const REQUIRED_PAGES: Record<string, string[]> = {
  snake: ['index', 'Room', 'Friends', 'Skins', 'Player'],
  gomoku: ['index', 'Room', 'Friends', 'Player'],
  xiangqi: ['index', 'Room', 'Friends', 'Player'],
  othello: ['index', 'Room', 'Friends', 'Player'],
  chess: ['index', 'Room', 'Friends', 'Player'],
  '2048': ['index', 'Play', 'Player'],
  tetris: ['index', 'Play', 'Player'],
};

describe('按游戏拆入口后的源码隔离', () => {
  test('七个 slug 各有自己的 main.tsx', () => {
    const missing = SLUGS.filter(slug => !existsSync(join(ROOT, 'src', 'pages', 'game', slug, 'main.tsx')));
    expect(missing).toEqual([]);
  });

  test('每个 main.tsx 只注册并加载自己的游戏引擎', () => {
    const problems: string[] = [];
    for (const slug of SLUGS) {
      const path = join(ROOT, 'src', 'pages', 'game', slug, 'main.tsx');
      const src = readIfExists(path);
      if (src === null) {
        problems.push(`${slug}: 缺少 main.tsx`);
        continue;
      }
      if (!src.includes(`registerLoader('${slug}'`)) {
        problems.push(`${slug}/main.tsx: 缺少 registerLoader('${slug}')`);
      }
      if (!src.includes(`import('../../../games/${slug}')`)) {
        problems.push(`${slug}/main.tsx: 缺少自己的引擎 import`);
      }
      for (const other of SLUGS) {
        if (other === slug) continue;
        if (new RegExp(`src/games/${other}(?![\\w-])`).test(src)) {
          problems.push(`${slug}/main.tsx: 出现其他游戏的引擎 import: ${other}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test('按页面矩阵，每个游戏该有的页面文件都存在', () => {
    const missing: string[] = [];
    for (const [slug, pages] of Object.entries(REQUIRED_PAGES)) {
      for (const page of pages) {
        if (!existsSync(join(ROOT, 'src', 'pages', 'game', slug, `${page}.tsx`))) missing.push(`${slug}/${page}.tsx`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('每个游戏页面源码里不出现其他游戏的 slug token', () => {
    const problems: string[] = [];
    for (const slug of SLUGS) {
      for (const page of PAGES) {
        const path = join(ROOT, 'src', 'pages', 'game', slug, `${page}.tsx`);
        const src = readIfExists(path);
        if (src === null) continue;
        const code = stripComments(src);
        for (const other of SLUGS) {
          if (other === slug) continue;
          if (slugToken(other).test(code)) {
            problems.push(`${slug}/${page}.tsx: 出现其他游戏 slug: ${other}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
