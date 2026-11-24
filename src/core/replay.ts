/**
 * 回放棋盘摊平：把各游戏的棋盘快照统一成"网格 + 格子内容"，纯函数、无依赖（可单测）。
 *
 * 数据来源：服务端 `movements[].board`（每手落子后的棋盘快照）。
 * 所以前端不需要重放规则，只要认识四种棋盘结构：
 * - gomoku：`{ "x|y": 'black' | 'white' }`
 * - xiangqi：`board[row][col] = { type, color } | null`（10×9）
 * - international-chess：`board[row][col] = { type, color } | null`（8×8）
 * - othello：`board[row][col] = 'black' | 'white' | null`（8×8）
 */

const XIANGQI_CHAR: Record<string, { red: string, black: string }> = {
  r: { red: '车', black: '車' },
  n: { red: '马', black: '馬' },
  b: { red: '相', black: '象' },
  a: { red: '仕', black: '士' },
  k: { red: '帅', black: '将' },
  c: { red: '炮', black: '砲' },
  p: { red: '兵', black: '卒' },
};

const CHESS_CHAR: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

export interface ReplayCell {
  label: string;
  color?: string;
  /** 用圆点表示棋子（五子棋/黑白棋） */
  dot?: boolean;
}

export function flattenBoard(slug: string, board: any): { cols: number, rows: number, cells: ReplayCell[] } {
  if (slug === 'gomoku') {
    const size = 15;
    const cells: ReplayCell[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const role = board?.[`${x}|${y}`];
        cells.push(role
          ? { label: '', dot: true, color: role === 'black' ? '#1b1b1b' : '#f5f5f5' }
          : { label: '' });
      }
    }
    return { cols: size, rows: size, cells };
  }

  if (slug === 'xiangqi') {
    const cells: ReplayCell[] = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board?.[r]?.[c];
        cells.push(p
          ? { label: XIANGQI_CHAR[p.type]?.[p.color as 'red' | 'black'] || p.type, color: p.color === 'red' ? '#c62828' : '#1b1b1b' }
          : { label: '' });
      }
    }
    return { cols: 9, rows: 10, cells };
  }

  if (slug === 'international-chess') {
    const cells: ReplayCell[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board?.[r]?.[c];
        cells.push(p
          ? { label: CHESS_CHAR[p.type] || '?', color: p.color === 'white' ? '#ffffff' : '#1b1b1b' }
          : { label: '' });
      }
    }
    return { cols: 8, rows: 8, cells };
  }

  // 黑白棋
  const cells: ReplayCell[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const v = board?.[r]?.[c];
      cells.push(v
        ? { label: '', dot: true, color: v === 'black' ? '#1b1b1b' : '#f5f5f5' }
        : { label: '' });
    }
  }
  return { cols: 8, rows: 8, cells };
}
