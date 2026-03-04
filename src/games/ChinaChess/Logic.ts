import EventEmitter from "eventemitter3"
import SocketTransport from "../../core/GameTransport";

export type PieceColor = "red" | "black";

export interface Piece {
  type: string; // r n b a k c p
  color: PieceColor;
}

export default class ChinaChessLogic extends EventEmitter {
  socket: SocketTransport;

  board: (Piece | null)[][];
  player: { _id: string; role: 'red' | 'black' } | null;
  curr_turn: string;
  match_id: string;
  isPendding = false;

  constructor(socket: SocketTransport) {
    super()
    this.socket = socket;
    this.player = null;
    this.curr_turn = '';
    this.match_id = '';
    this.board = [];
    this.socket.socket.on('room:player-action', (data: { next_turn: string, from: { x: number, y: number }, to: { x: number, y: number } }) => {
      this.curr_turn = data.next_turn;
      const from = data.from;
      const to = data.to
      const piece = this.getPiece(from.x, from.y);
      this.board[to.y][to.x] = piece;
      this.board[from.y][from.x] = null;

      this.emit('move', { ...data, from, to });
    })
  }

  setPlayer(player: any) {
    if (player) {
      this.player = player;
    }
  }
  setState(state: any) {
    if (state) {
      this.board = state.board;
      if (state.player) {
        this.player = state.player;
      }
      this.match_id = state.match_id;
      this.curr_turn = state.curr_turn;
      this.emit('state')
    }
  }

  isMyTurn(role: 'red' | 'black') {
    return this.player?._id === this.curr_turn && this.player.role === role;
  }

  getPiece(x: number, y: number) {
    return this.board[y]?.[x] ?? null;
  }

  move(fx: number, fy: number, tx: number, ty: number): boolean {
    const piece = this.getPiece(fx, fy);
    if (!piece) return false;

    if (this.player?._id !== this.curr_turn) return false;
    if (!this.isLegalMove(piece, fx, fy, tx, ty)) return false;
    this.socket.socket.emit('room:player-action', this.match_id, {
      player_id: this.curr_turn,
      from: { x: fx, y: fy },
      to: { x: tx, y: ty },
    }, (success: boolean) => {
      this.isPendding = false;
    })
    return true;
  }

  isInside(x: number, y: number) {
    return x >= 0 && x < 9 && y >= 0 && y < 10;
  }

  isPathClearStraight(fx: number, fy: number, tx: number, ty: number) {
    if (fx === tx) {
      const min = Math.min(fy, ty) + 1;
      const max = Math.max(fy, ty);
      for (let y = min; y < max; y++)
        if (this.board[y][fx]) return false;
      return true;
    }

    if (fy === ty) {
      const min = Math.min(fx, tx) + 1;
      const max = Math.max(fx, tx);
      for (let x = min; x < max; x++)
        if (this.board[fy][x]) return false;
      return true;
    }

    return false;
  }

  isLegalMove(piece: Piece, fx: number, fy: number, tx: number, ty: number): boolean {
    if (!this.isInside(tx, ty)) return false;

    const target = this.getPiece(tx, ty);
    if (target && target.color === piece.color) return false;

    const dx = tx - fx;
    const dy = ty - fy;

    switch (piece.type) {
      case "r": // 车
        return this.isPathClearStraight(fx, fy, tx, ty);

      case "n": // 马
        if (!((Math.abs(dx) === 2 && Math.abs(dy) === 1) ||
          (Math.abs(dx) === 1 && Math.abs(dy) === 2)))
          return false;
        const legX = fx + (Math.abs(dx) === 2 ? dx / 2 : 0);
        const legY = fy + (Math.abs(dy) === 2 ? dy / 2 : 0);
        return !this.getPiece(legX, legY);

      case "b": // 象
        if (Math.abs(dx) !== 2 || Math.abs(dy) !== 2) return false;
        if (piece.color === "red" && ty < 5) return false;
        if (piece.color === "black" && ty > 4) return false;
        return !this.getPiece(fx + dx / 2, fy + dy / 2);

      case "a": // 士
        if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) return false;
        if (tx < 3 || tx > 5) return false;
        if (piece.color === "red" && (ty < 7 || ty > 9)) return false;
        if (piece.color === "black" && (ty < 0 || ty > 2)) return false;
        return true;

      case "k": // 将
        if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
        if (tx < 3 || tx > 5) return false;
        if (piece.color === "red" && (ty < 7 || ty > 9)) return false;
        if (piece.color === "black" && (ty < 0 || ty > 2)) return false;
        return true;

      case "c": // 炮
        if (!this.isPathClearStraight(fx, fy, tx, ty)) {
          let count = 0;
          if (fx === tx) {
            const min = Math.min(fy, ty) + 1;
            const max = Math.max(fy, ty);
            for (let y = min; y < max; y++)
              if (this.board[y][fx]) count++;
          } else if (fy === ty) {
            const min = Math.min(fx, tx) + 1;
            const max = Math.max(fx, tx);
            for (let x = min; x < max; x++)
              if (this.board[fy][x]) count++;
          }
          return count === 1 && target !== null;
        }
        return target === null;

      case "p": // 兵
        if (piece.color === "red") {
          if (fy <= 4)
            return (Math.abs(dx) === 1 && dy === 0) || (dx === 0 && dy === -1);
          return dx === 0 && dy === -1;
        } else {
          if (fy >= 5)
            return (Math.abs(dx) === 1 && dy === 0) || (dx === 0 && dy === 1);
          return dx === 0 && dy === 1;
        }
    }

    return false;
  }

}