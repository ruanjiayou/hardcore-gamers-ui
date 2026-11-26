import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 去掉 CSS 注释，避免注释里的示例选择器误报 */
function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

const ROOT = join(import.meta.dir, '..');
const PUBLIC_CSS_DIR = join(ROOT, 'src', 'styles');
const SNAKE_CSS_DIR = join(ROOT, 'src', 'pages', 'game', 'snake', 'styles');
const FORBIDDEN = ['.snake-', '.team-wait-', '.current-skin', '.game-2048', '.tetris-'];

function cssFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

function cssText(dir: string): Array<{ name: string, src: string }> {
  return cssFiles(dir).map(path => ({ name: path.slice(dir.length + 1), src: stripCssComments(readFileSync(path, 'utf8')) }));
}

describe('CSS 按游戏隔离', () => {
  test('公共样式不含任何游戏专属选择器片段', () => {
    const violations: string[] = [];
    for (const { name, src } of cssText(PUBLIC_CSS_DIR)) {
      for (const fragment of FORBIDDEN) {
        if (src.includes(fragment)) violations.push(`${name}: ${fragment}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test('贪吃蛇自己的样式目录里含有 .snake- 规则', () => {
    expect(cssFiles(SNAKE_CSS_DIR).length).toBeGreaterThan(0);
    expect(cssText(SNAKE_CSS_DIR).some(({ src }) => src.includes('.snake-'))).toBe(true);
  });
});
