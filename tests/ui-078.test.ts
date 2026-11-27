import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import UiStore from '../src/stores/ui';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('跨入口新建页面时连接状态乐观为已连接，避免头像先裂一下', () => {
  expect(new UiStore().socketConnected).toBe(true);
});

test('游戏页头像下拉左锚定，不溢出屏幕', () => {
  expect(read('src/styles/game-header.css')).toContain('.game-header .dropdown-menu { left: 0; right: auto; }');
});

test('个人中心/公开主页顶部用主题色，页面无圆角', () => {
  const css = read('src/styles/profile.css');
  const page = css.slice(css.indexOf('.profile-page {'), css.indexOf('}', css.indexOf('.profile-page {')));
  const head = css.slice(css.indexOf('.profile-head {'), css.indexOf('}', css.indexOf('.profile-head {')));
  expect(page).not.toContain('border-radius');
  expect(head).toContain('linear-gradient(135deg, var(--lobby-brand-from, #667eea) 0%, var(--lobby-brand-to, #764ba2) 100%)');
});
