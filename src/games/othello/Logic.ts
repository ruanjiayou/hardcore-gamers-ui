import EventEmitter from "eventemitter3"
import type SocketTransport from "../../core/GameTransport";

export type OthelloColor = 'black' | 'white';
export type Cell = OthelloColor | null;
export type Pos = [number, number];

export default class OthelloLogic extends EventEmitter {
  socket: SocketTransport;
  board: Cell[][];
  player: { _id: string; role: OthelloColor };
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
      to: Pos;
      color: OthelloColor;
      flips?: Pos[];
      pass?: boolean;
    }) => {
      this.curr_turn = data.next_turn;
      if (!data.pass && data.to && data.to[0] >= 0 && data.color) {
        this.board[data.to[0]][data.to[1]] = data.color;
        (data.flips || []).forEach(([r, c]) => { this.board[r][c] = data.color; });
      }
      this.emit('move', data);
    });
  }

  setPlayer(player: any) {
    if (player) this.player = player;
  }

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

  isMyTurn() {
    return this.player?._id === this.curr_turn;
  }

  /** 落子；pass 传 [-1,-1] */
  move(to: Pos): boolean {
    if (this.player?._id !== this.curr_turn) return false;
    this.socket.socket.emit('room:player-action', this.match_id, {
      player_id: this.curr_turn,
      to,
      color: this.player.role,
    }, () => {
      this.isPendding = false;
    });
    return true;
  }
}
