import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');
const ROOM = 'src/pages/game/snake/Room.tsx';
const ROOM_CSS = 'src/pages/game/snake/styles/room.css';

describe('UI-098 无尽匹配直达对战页（跳过房间中间态）', () => {
  test('竞技场房（autoStarted）不渲染等待卡片 / 房间信息侧栏', () => {
    const tsx = compact(read(ROOM));
    // showTeamWait 必须排除 autoStarted
    expect(tsx).toContain('showTeamWait=isRealtimeGame&&store.room.status!==RoomStatus.playing&&!autoStarted');
  });

  test('沉浸态由 arena 标记/官方房提前触发（arena 直接全屏，UI-100 首帧即沉浸）', () => {
    const tsx = compact(read(ROOM));
    expect(tsx).toContain('constisEndlessArena=local.arenaEntry||store.room.roomInfo?.settings?.arena===true');
    expect(tsx).toContain('constautoStarted=isEndlessArena&&(local.arenaEntry||!!store.room.roomInfo?.official)');
    expect(tsx).toContain('immersive=(autoStarted||store.room.status===RoomStatus.playing)&&!local.endedMatch');
  });

  test('匹配回调拿到 room_id 直接跳房间页（无中间弹窗，UI-100 打竞技场标记）', () => {
    const home = compact(read('src/pages/game/snake/index.tsx'));
    expect(home).toMatch(/constroomId=player\?\.room_id;if\(success&&roomId\)\{/);
    expect(home).toContain('if(arenaMatch)markArenaEntry(roomId)');
    expect(home).toContain("go(gameUrl(slug,'/room/'+roomId))");
  });
});

describe('UI-099 团队房等待区 5 座横向卡片', () => {
  test('渲染 5 个座位（TEAM_SEAT_COUNT），不再渲染队伍徽标', () => {
    const tsx = compact(read(ROOM));
    expect(tsx).toContain('constTEAM_SEAT_COUNT=5');
    const wait = tsx.slice(tsx.indexOf('className="team-wait"'), tsx.indexOf('className="board-center-actions"'));
    expect(wait).toContain('team-seat');
    expect(wait).not.toContain('badge.team');
    expect(wait).not.toContain('p.team&&');
  });

  test('座位卡：上头像下昵称', () => {
    const css = compact(read(ROOM_CSS));
    expect(css).toContain('.team-seat-avatar{');
    expect(css).toContain('.team-seat-name{');
    expect(css).toContain('flex-direction:column');
  });

  test('房主等待态：座位卡右上 × 踢人 + 第 6 张 🫱 添加人机', () => {
    const tsx = compact(read(ROOM));
    expect(tsx).toContain('team-seat-kick');
    expect(tsx).toContain('SendoutEvent.KickPlayer');
    expect(tsx).toContain('team-seat-add-robot');
    expect(tsx).toContain('🫱');
    expect(tsx).toContain('SendoutEvent.AddRobot');
  });

  test('团队房等待区不再渲染独立 PlayerList / Chat', () => {
    const tsx = compact(read(ROOM));
    const wait = tsx.slice(tsx.indexOf('className="team-wait"'), tsx.indexOf('className="board-center-actions"'));
    expect(wait).not.toContain('<PlayerList');
    expect(wait).not.toContain('<Chat');
  });

  test('顶栏 subtitle 对团队房不显示房间名', () => {
    const tsx = compact(read(ROOM));
    expect(tsx).toContain('subtitle={isRealtimeGame?variantInfo?.label||\'\':store.room.roomInfo?.name||variantInfo?.label||\'\'}');
  });
});
