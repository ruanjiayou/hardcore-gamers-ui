import { describe, test, expect } from 'bun:test';
import LogicTetris, { COLS, ROWS, PIECE_TYPES, PIECE_CELLS, gravityMs } from '../src/games/tetris/Logic';

/** localStorage 在 bun 环境不存在，构造函数内已有 try/catch 兜底 */
function makeLogic() {
  return new LogicTetris(null as any, { _id: 'p1', nickname: 'tester' });
}

function filledCells(logic: LogicTetris): number {
  let n = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (logic.board[r][c]) n++;
  return n;
}

describe('俄罗斯方块引擎', () => {
  test('reset：空棋盘 + 当前方块 + NEXT 3 个', () => {
    const l = makeLogic();
    expect(l.board.length).toBe(ROWS);
    expect(l.board[0].length).toBe(COLS);
    expect(filledCells(l)).toBe(0);
    expect(l.current).not.toBeNull();
    expect(l.next.length).toBe(3);
    expect(l.score).toBe(0);
    expect(l.level).toBe(1);
    expect(l.finished).toBe(false);
  });

  test('7-bag：一轮 70 个方块每种恰好 10 次', () => {
    const l = makeLogic();
    const counts: Record<string, number> = {};
    // 清掉开局已消费的队列，从空袋开始取 70 个验证 7-bag 均匀性
    (l as any).bag = [];
    for (let i = 0; i < 70; i++) {
      const t = (l as any).nextType();
      counts[t] = (counts[t] || 0) + 1;
    }
    PIECE_TYPES.forEach(t => expect(counts[t]).toBe(10));
  });

  test('左右移动：不能越过左/右边界', () => {
    const l = makeLogic();
    const canPlace = (dx: number) => !(l as any).collides(l.current, l.current.x + dx, l.current.y);
    for (let i = 0; i < 20; i++) l.move(-1);
    expect(l.current!.x).toBeGreaterThanOrEqual(0);
    expect(canPlace(-1)).toBe(false);
    const x = l.current!.x;
    for (let i = 0; i < 30; i++) l.move(1);
    expect(canPlace(1)).toBe(false);
    expect(l.current!.x).toBeGreaterThan(x);
  });

  test('旋转：顺时针 4 次回到初始朝向', () => {
    const l = makeLogic();
    const rot0 = l.current!.rot;
    l.rotate(1);
    l.rotate(1);
    l.rotate(1);
    l.rotate(1);
    expect(l.current!.rot).toBe(rot0);
  });

  test('硬降：落地后锁定并换新方块，分数按距离 x2 计', () => {
    const l = makeLogic();
    const startY = l.current!.y;
    const ghost = l.ghostY();
    l.hardDrop();
    // 棋盘上留下 4 个格子的旧方块
    expect(filledCells(l)).toBe(4);
    expect(l.score).toBe((ghost - startY) * 2);
    expect(l.current).not.toBeNull();
    expect(l.current!.y).toBeLessThanOrEqual(1);
  });

  test('消行：满行清除，得分按 1 行 100 计', () => {
    const l = makeLogic();
    for (let c = 0; c < COLS; c++) l.board[ROWS - 1][c] = 'I';
    const cleared = (l as any).clearLines();
    expect(cleared).toBe(1);
    expect(l.lines).toBe(1);
    expect(l.score).toBe(100);
    expect(filledCells(l)).toBe(0);
  });

  test('消四行：Tetris 得 800 分', () => {
    const l = makeLogic();
    for (let r = ROWS - 4; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) l.board[r][c] = 'T';
    }
    expect((l as any).clearLines()).toBe(4);
    expect(l.score).toBe(800);
    expect(l.lines).toBe(4);
    expect(filledCells(l)).toBe(0);
  });

  test('等级：每 10 行升级，重力间隔随之变短', () => {
    const l = makeLogic();
    for (let r = ROWS - 10; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) l.board[r][c] = 'L';
    }
    // 一次最多消 4 行，逐次清空
    let guard = 10;
    while (guard-- > 0 && (l as any).clearLines() > 0) { /* 反复清行 */ }
    expect(l.lines).toBe(10);
    expect(l.level).toBe(2);
    expect(gravityMs(l.level)).toBeLessThan(gravityMs(1));
  });

  test('顶出：堆满后生成新方块触发游戏结束', () => {
    const l = makeLogic();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) l.board[r][c] = 'Z';
    l.current = null;
    (l as any).spawn();
    expect(l.finished).toBe(true);
    expect(l.current).toBeNull();
  });

  test('HOLD：首次暂存当前方块，本回合不能再次暂存', () => {
    const l = makeLogic();
    const t = l.current!.type;
    l.hold();
    expect(l.holdType).toBe(t);
    expect(l.holdUsed).toBe(true);
    const nowType = l.current!.type;
    l.hold(); // 已用过，应被忽略
    expect(l.current!.type).toBe(nowType);
  });

  test('暂停：暂停时重力不再推进、操作被忽略', () => {
    const l = makeLogic();
    l.started = true;
    l.togglePause();
    expect(l.paused).toBe(true);
    const y = l.current!.y;
    l.softDrop();
    expect(l.current!.y).toBe(y);
  });

  test('形状表：每种方块 4 个旋转态，每态 2~4 格且不越出方框', () => {
    PIECE_TYPES.forEach(t => {
      expect(PIECE_CELLS[t].length).toBe(4);
      PIECE_CELLS[t].forEach(cells => {
        expect(cells.length).toBeGreaterThanOrEqual(1);
        expect(cells.length).toBeLessThanOrEqual(4);
        cells.forEach(([r, c]) => {
          expect(r).toBeGreaterThanOrEqual(0);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(3);
          expect(c).toBeLessThanOrEqual(3);
        });
      });
    });
    // 除 O 外每态都是 4 格
    PIECE_TYPES.filter(t => t !== 'O').forEach(t => {
      PIECE_CELLS[t].forEach(cells => expect(cells.length).toBe(4));
    });
  });
});
