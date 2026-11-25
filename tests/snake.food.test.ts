import { describe, expect, test } from 'bun:test';
import LogicSnake from '../src/games/snake/Logic';

/**
 * 快照里的拾取物是**增量同步**的：服务端每帧只发 `foodAdd` / `foodDel`，
 * 每 10 秒（或开局/中途加入）才发一次 `foodFull`。
 * 这里只测合并逻辑本身——它是「场上食物少一个 / 多一个」的唯一入口，
 * 错了会表现成「食物吃不完」或「食物凭空消失」。
 */
function makeLogic() {
  const socket = { socket: { on() { }, off() { }, emit() { } } };
  return new LogicSnake(socket as any, { _id: 'p1', nickname: 't', room_id: 'r1' });
}

const food = (id: number, x = 100, y = 100, r = 6, v = 6, k = 0) => ({ id, x, y, r, v, k });

describe('拾取物增量同步', () => {
  test('foodFull：整表替换（开局首帧）', () => {
    const logic = makeLogic() as any;
    logic.applyFoodDelta({ foodFull: true, food: [food(1), food(2)] });
    expect(logic.food.map((f: any) => f.id)).toEqual([1, 2]);
    logic.applyFoodDelta({ foodFull: true, food: [food(9)] });
    expect(logic.food.map((f: any) => f.id)).toEqual([9]);
  });

  test('没有 foodFull 标志但带 food 数组也当全量（兼容旧服务端）', () => {
    const logic = makeLogic() as any;
    logic.applyFoodDelta({ food: [food(1), food(2), food(3)] });
    expect(logic.food).toHaveLength(3);
  });

  test('增量：按 id 删除 + 追加新增', () => {
    const logic = makeLogic() as any;
    logic.applyFoodDelta({ foodFull: true, food: [food(1), food(2), food(3)] });
    logic.applyFoodDelta({ foodDel: [2], foodAdd: [food(4)] });
    expect(logic.food.map((f: any) => f.id)).toEqual([1, 3, 4]);
  });

  test('重复的新增不会出现两个一样的拾取物', () => {
    const logic = makeLogic() as any;
    logic.applyFoodDelta({ foodFull: true, food: [food(1)] });
    logic.applyFoodDelta({ foodAdd: [food(1), food(2)] });
    expect(logic.food.map((f: any) => f.id)).toEqual([1, 2]);
  });

  test('没有 id 的旧数据不会被 foodDel 误删（按 id 匹配不到就保留）', () => {
    const logic = makeLogic() as any;
    logic.applyFoodDelta({ food: [{ x: 10, y: 10, r: 6, v: 6, k: 0 }] });
    logic.applyFoodDelta({ foodDel: [1, 2] });
    expect(logic.food).toHaveLength(1);
  });

  test('纯增量帧（既无 food 也无 foodFull）不会清空已有食物', () => {
    const logic = makeLogic() as any;
    logic.applyFoodDelta({ foodFull: true, food: [food(1), food(2)] });
    logic.applyFoodDelta({});
    expect(logic.food).toHaveLength(2);
  });

  test('foodMove：按 id 更新坐标（磁铁吸附效果）', () => {
    const logic = makeLogic() as any;
    logic.applyFoodDelta({ foodFull: true, food: [food(1, 100, 100)] });
    logic.applyFoodDelta({ foodMove: [{ id: 1, x: 130, y: 90 }] });
    const f = logic.food.find((x: any) => x.id === 1);
    expect(f.x).toBe(130);
    expect(f.y).toBe(90);
  });

  test('foodMove：id 不存在时忽略（不能凭空造出拾取物）', () => {
    const logic = makeLogic() as any;
    logic.applyFoodDelta({ foodFull: true, food: [food(1, 100, 100)] });
    logic.applyFoodDelta({ foodMove: [{ id: 99, x: 1, y: 2 }] });
    expect(logic.food).toHaveLength(1);
  });
});
