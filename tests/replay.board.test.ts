import { describe, expect, test } from 'bun:test';
import { flattenBoard } from '../src/core/replay';

/**
 * 回放棋盘摊平（UI-047）：服务端只给棋盘快照，前端负责把它变成可渲染的网格。
 * 这里锁住四种棋盘的尺寸与棋子识别，避免"回放空白/错位"。
 */
describe('回放棋盘摊平', () => {
  test('五子棋：15×15，坐标键 x|y 转成圆点', () => {
    const { cols, rows, cells } = flattenBoard('gomoku', { '0|0': 'black', '14|14': 'white' });
    expect(cols).toBe(15);
    expect(rows).toBe(15);
    expect(cells.length).toBe(225);
    expect(cells[0]).toMatchObject({ dot: true, color: '#1b1b1b' });
    expect(cells[224]).toMatchObject({ dot: true, color: '#f5f5f5' });
    expect(cells[1]).toEqual({ label: '' });
  });

  test('象棋：9×10，红黑用不同字', () => {
    const board: any = Array.from({ length: 10 }, () => Array(9).fill(null));
    board[0][0] = { type: 'r', color: 'black' };
    board[9][4] = { type: 'k', color: 'red' };
    const { cols, rows, cells } = flattenBoard('xiangqi', board);
    expect(cols).toBe(9);
    expect(rows).toBe(10);
    expect(cells.length).toBe(90);
    expect(cells[0].label).toBe('車');
    expect(cells[9 * 9 + 4]).toMatchObject({ label: '帅', color: '#c62828' });
  });

  test('国际象棋：8×8，白子/黑子用不同字形', () => {
    const board: any = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[0][0] = { type: 'r', color: 'black' };
    board[7][4] = { type: 'k', color: 'white' };
    const { cols, rows, cells } = flattenBoard('international-chess', board);
    expect(cols).toBe(8);
    expect(rows).toBe(8);
    expect(cells[0].label).toBe('♜');
    expect(cells[7 * 8 + 4]).toMatchObject({ label: '♚', color: '#ffffff' });
  });

  test('黑白棋：8×8，借用 dot 画圆盘', () => {
    const board: any = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[3][3] = 'white';
    const { cols, cells } = flattenBoard('othello', board);
    expect(cols).toBe(8);
    expect(cells[3 * 8 + 3]).toMatchObject({ dot: true, color: '#f5f5f5' });
  });

  test('空/缺失棋盘不抛错（老对局没有逐手快照）', () => {
    for (const slug of ['gomoku', 'xiangqi', 'international-chess', 'othello']) {
      const result = flattenBoard(slug, null);
      expect(result.cells.length).toBe(result.cols * result.rows);
      expect(result.cells.every(c => !c.dot && !c.label)).toBe(true);
    }
  });
});
