import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');
const ROOM = 'src/pages/game/snake/Room.tsx';
const HOME = 'src/pages/game/snake/index.tsx';

describe('UI-100 房间页按玩法收起玩家列表 / 无尽纯画布', () => {
  test('团队房非沉浸底部不再渲染 PlayerList（Chat 保留）', () => {
    const tsx = compact(read(ROOM));
    const bottom = tsx.slice(tsx.indexOf('className=\'game-info\''));
    expect(bottom).toContain('!isRealtimeGame&&<PlayerList');
    expect(bottom).toContain('<Chat');
  });

  test('无尽房首帧即沉浸：匹配回调打 arena-entry 标记，Room 消费它', () => {
    const home = compact(read(HOME));
    expect(home).toContain('markArenaEntry(roomId)');
    const tsx = compact(read(ROOM));
    expect(tsx).toContain('consumeArenaEntry(room_id)');
    expect(tsx).toContain('local.arenaEntry||store.room.roomInfo?.settings?.arena===true');
  });

  test('无尽沉浸 HUD 不再渲染玩家/聊天抽屉（☰ 与抽屉均以 !isEndlessArena 收起）', () => {
    const tsx = compact(read(ROOM));
    const hud = tsx.slice(tsx.indexOf('className="immersion-hud"'), tsx.indexOf("className='game-info'"));
    expect(hud).toContain('!isEndlessArena&&(<buttonclassName="hud-btnhud-panel-toggle"');
    expect(hud).toContain('local.showPanel&&!isEndlessArena&&(<divclassName="hud-drawer">');
  });

  test('无尽房非沉浸分支也不渲染底部 game-info', () => {
    const tsx = compact(read(ROOM));
    expect(tsx).toContain('!isSoloGame&&!isEndlessArena?');
  });
});

describe('UI-101 退出弹框按身份分化', () => {
  test('Room 传 isTeamRoom / canDisband 给 resolveExitIntent', () => {
    const tsx = compact(read(ROOM));
    expect(tsx).toContain('isTeamRoom:isRealtimeGame');
    expect(tsx).toContain('canDisband:canDisband');
  });

  test('canDisband 明确排除无尽竞技房', () => {
    const tsx = compact(read(ROOM));
    expect(tsx).toContain('constcanDisband=isOwner&&!store.room.roomInfo?.official&&!store.room.roomInfo?.transient&&!isEndlessArena');
  });

  test('handleExit 对 disband-room 走解散路径', () => {
    const tsx = compact(read(ROOM));
    expect(tsx).toContain('if(exitIntent.kind===\'disband-room\')');
    expect(tsx).toContain('handleDisband();return');
  });

  test('独立解散按钮不再与新意图重复渲染', () => {
    const tsx = compact(read(ROOM));
    expect(tsx).toContain('canDisband&&exitIntent.kind!==\'disband-room\'');
  });
});
