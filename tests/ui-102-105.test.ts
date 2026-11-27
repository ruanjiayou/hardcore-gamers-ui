import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
// 去掉所有空白，避免 CSS/JSX 换行与缩进造成脆弱断言
const compact = (s: string) => s.replace(/\s+/g, '');

const GAME_CSS = 'src/styles/game.css';
const CHAT = 'src/components/Chat.tsx';
const ROOM_CSS = 'src/styles/room.css';
const SNAKE_ROOM_CSS = 'src/pages/game/snake/styles/room.css';
const NAV = 'src/navigation.ts';
const PROFILE = 'src/pages/Profile.tsx';
const USER_PROFILE = 'src/pages/UserProfile.tsx';
const SETTINGS = 'src/components/GameSettings.tsx';
const SNAKE_ROOM = 'src/pages/game/snake/Room.tsx';

describe('UI-102 玩法按钮渐变背景 + 居中', () => {
  test('按钮行居中，窄屏仍可横向滚动', () => {
    const css = compact(read(GAME_CSS));
    const block = css.slice(css.indexOf('.mode-buttons{'), css.indexOf('.mode-buttons::-webkit-scrollbar'));
    expect(block).toContain('justify-content:center');
    expect(block).toContain('overflow-x:auto');
  });

  test('默认态与选中态都是渐变底，文字白色显式覆盖', () => {
    const css = compact(read(GAME_CSS));
    const base = css.slice(css.indexOf('.mode-btn{'), css.indexOf('.mode-btn:hover'));
    expect(base).toContain('background:linear-gradient(');
    expect(base).toContain('color:#fff');
    expect(base).toContain('-webkit-text-fill-color:#fff');
    const active = css.slice(css.indexOf('.mode-btn.active{'), css.indexOf('.mode-btn:disabled'));
    expect(active).toContain('linear-gradient(');
    expect(active).toContain('box-shadow:');
  });
});

describe('UI-103 团队房聊天高度自适应', () => {
  test('Chat 根节点不再写死 flex: 0 0 60%', () => {
    const tsx = compact(read(CHAT));
    expect(tsx).not.toContain("flex:'0 0 60%'");
    expect(tsx).not.toContain('flex:"0 0 60%"');
    expect(tsx).toContain('className="chatchat-panel"');
  });

  test('消息区可滚动且 min-height:0，输入组固定底部', () => {
    const css = compact(read(ROOM_CSS));
    const messages = css.slice(css.indexOf('.messages{'), css.indexOf('.message{'));
    expect(messages).toContain('flex:1');
    expect(messages).toContain('min-height:0');
    expect(messages).toContain('overflow-y:auto');
    const input = css.slice(css.indexOf('.input-group{'), css.indexOf('.input-groupinput'));
    expect(input).toContain('flex:00auto');
  });

  test('团队房等待态给聊天高度下限，抽屉内聊天不遮挡输入', () => {
    const css = compact(read(SNAKE_ROOM_CSS) + read(ROOM_CSS));
    expect(css).toMatch(/chat-panel\{[^}]*min-height:220px/);
    expect(css).toMatch(/\.hud-drawer\.chat\{[^}]*min-height:0/);
  });
});

describe('UI-104 玩家中心返回上一页', () => {
  test('跨入口跳大厅子页用 assign 保留历史，不再 replace', () => {
    const code = compact(read(NAV));
    expect(code).toContain('functionisLobbySubpage');
    expect(code).toContain('location.assign(url)');
    // replace 只保留给"关游戏回大厅"分支
    const softGo = code.slice(code.indexOf('exportasyncfunctionsoftGo('), code.indexOf('exportfunctioninstallSoftNavPopstate'));
    expect(softGo).toContain('isLobbySubpage');
    expect(softGo).toContain('location.replace');
  });

  test('isLobbySubpage 只认大厅子页，不认大厅根', () => {
    const code = read(NAV);
    expect(code).toMatch(/isLobbySubpage\([^)]*\)\s*:\s*boolean/);
    const body = code.slice(code.indexOf('export function isLobbySubpage'));
    expect(body.slice(0, 700)).toContain("'login'");
    expect(body.slice(0, 700)).toContain("'me'");
    expect(body.slice(0, 700)).toContain("'user/'");
  });

  test('个人中心与公开主页返回按钮仍用 navigate(-1)', () => {
    for (const rel of [PROFILE, USER_PROFILE]) {
      const tsx = compact(read(rel));
      expect(tsx).toContain('navigate(-1)');
    }
  });
});

describe('UI-105 游戏设置移除下一首按钮', () => {
  test('设置弹框不再渲染「下一首」按钮', () => {
    const tsx = read(SETTINGS);
    expect(tsx).not.toContain('>下一首</button>');
    expect(tsx).not.toContain('onClick={() => audio.nextBgm()}');
    // 背景音乐区本身仍在
    expect(tsx).toContain('🎵 背景音乐');
  });
});

describe('GM-snake-37 竞技场状态时序修复', () => {
  test('局面 ACK 未就绪时暂存 pendingState', () => {
    const tsx = compact(read(SNAKE_ROOM));
    expect(tsx).toContain('pendingState');
    const def = tsx.slice(tsx.indexOf('constapplyState='), tsx.indexOf('consthandleAddRobot='));
    expect(def).toContain('pendingState');
    expect(def).toContain('applyState(state)');
  });

  test('GameCanvas onReady 消费暂存局面并补拉', () => {
    const tsx = compact(read(SNAKE_ROOM));
    const idx = tsx.indexOf('onReady=');
    expect(idx).toBeGreaterThan(-1);
    const readyBlock = tsx.slice(idx, idx + 900);
    expect(readyBlock).toContain('pendingState');
    expect(readyBlock).toContain('loadState(');
  });
});
