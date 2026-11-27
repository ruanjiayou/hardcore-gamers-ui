import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');

const PLAYER_PROFILE = 'src/components/PlayerProfile.tsx';

describe('UI-106 玩家主页返回改为历史回退', () => {
  test('引入 useNavigate 并用 navigate(-1) 返回上一页', () => {
    const tsx = compact(read(PLAYER_PROFILE));
    expect(tsx).toContain('useNavigate');
    expect(tsx).toContain('constnavigate=useNavigate()');
    expect(tsx).toContain('onClick={()=>navigate(-1)}');
  });

  test('不再用 go(gameUrl(slug)) push 新历史记录', () => {
    const tsx = compact(read(PLAYER_PROFILE));
    expect(tsx).not.toContain('go(gameUrl(slug))');
  });

  test('不再从 navigation 引入 go / gameUrl（返回不再依赖跨入口跳转助手）', () => {
    const tsx = compact(read(PLAYER_PROFILE));
    expect(tsx).not.toMatch(/import\{[^}]*\bgo\b[^}]*\}from'\.\.\/navigation'/);
    expect(tsx).not.toMatch(/import\{[^}]*gameUrl[^}]*\}from'\.\.\/navigation'/);
  });
});
