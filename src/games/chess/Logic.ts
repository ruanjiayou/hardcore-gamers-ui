import EventEmitter from "eventemitter3"
import type SocketTransport from "../../core/GameTransport";

export type Color = 'white' | 'black';
export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';
export interface Piece { type: PieceType; color: Color }
export type Cell = Piece | null;
export type Pos = [number, number];

export default class InternationalChessLogic extends EventEmitter {
  socket: SocketTransport;
  board: Cell[][];
  player: { _id: string; role: Color };
  curr_turn: string;
  match_id: string;
  isPendding = false;

  constructor(socket: SocketTransport, player: any) {
    super();
    this.socket = socket;
    this.player = player;
    this.board = [];
    this.curr_turn = '';
    this.match_id = '';

    this.socket.socket.on('room:player-action', (data: {
      next_turn: string;
      from: Pos;
      to: Pos;
      promotion?: PieceType;
      castle?: 'K' | 'Q';
      enPassant?: boolean;
    }) => {
      this.curr_turn = data.next_turn;
      this.applyMove(data);
      this.emit('move', data);
    });
  }

  private applyMove(data: { from: Pos; to: Pos; promotion?: PieceType; castle?: 'K' | 'Q'; enPassant?: boolean }) {
    const b = this.board;
    if (!b?.length) return;
    const [fr, fc] = data.from;
    const [tr, tc] = data.to;
    const piece = b[fr]?.[fc];
    if (!piece) return;
    // 吃过路兵：删除被吃兵（起点行、终点列）
    if (data.enPassant) b[fr][tc] = null;
    // 落子/升变
    b[tr][tc] = data.promotion ? { type: data.promotion, color: piece.color } : piece;
    b[fr][fc] = null;
    // 易位：同步车
    if (data.castle) {
      const row = fr;
      if (data.castle === 'K') { b[row][5] = b[row][7]; b[row][7] = null; }
      else { b[row][3] = b[row][0]; b[row][0] = null; }
    }
  }

  setPlayer(player: any) { if (player) this.player = player; }

  setState(state: any) {
    if (!state) return;
    this.board = state.board;
    if (state.player) this.player = state.player;
    this.match_id = state.match_id;
    this.curr_turn = state.curr_turn;
    this.emit('state');
  }

  setCurrTurn(id: string) { this.curr_turn = id; }
  setMatchId(id: string) { this.match_id = id; }

  isMyTurn() { return this.player?._id === this.curr_turn; }

  /** 落子。from/to 为 [row,col]；升变传 promotion。 */
  move(from: Pos, to: Pos, promotion?: PieceType): boolean {
    if (this.player?._id !== this.curr_turn) return false;
    this.socket.socket.emit('room:player-action', this.match_id, {
      player_id: this.curr_turn,
      from,
      to,
      promotion,
    }, () => { this.isPendding = false; });
    return true;
  }
}
