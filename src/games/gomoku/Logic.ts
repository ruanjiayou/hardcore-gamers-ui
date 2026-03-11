import EventEmitter from "eventemitter3"
import SocketTransport from "../../core/GameTransport";

export type PieceColor = "white" | "black";

export interface Piece {
  type: string; // r n b a k c p
  color: PieceColor;
}

export default class GomokuLogic extends EventEmitter {
  socket: SocketTransport;

  board = new Map<string, PieceColor>();
  player: { _id: string; role: PieceColor };
  curr_turn: string;
  match_id: string;
  isPendding = false;

  constructor(socket: SocketTransport, player: any) {
    super()
    this.socket = socket;
    this.player = player;
    this.curr_turn = '';
    this.match_id = '';
    this.socket.socket.on('room:player-action', (data: { next_turn: string, point: { x: number, y: number, color: PieceColor } }) => {
      this.curr_turn = data.next_turn;
      this.board.set(`${data.point.x}|${data.point.y}`, data.point.color)

      this.emit('move', data.point);
    })
  }

  setPlayer(player: any) {
    if (player) {
      this.player = player;
    }
  }
  setState(state: any) {
    if (state) {
      this.board = new Map(Object.entries(state.board));
      if (state.player) {
        this.player = state.player;
      }
      this.match_id = state.match_id;
      this.curr_turn = state.curr_turn;
      this.emit('state')
    }
  }

  setCurrTurn(player_id: string) {
    this.curr_turn = player_id;
  }

  setMatchId(match_id: string) {
    this.match_id = match_id;
  }

  isMyTurn() {
    return this.player?._id === this.curr_turn;
  }

  move(point: { x: number, y: number, color: PieceColor }): boolean {
    const piece = this.board.get(`${point.x}|${point.y}`);
    if (piece || this.player?._id !== this.curr_turn) return false;

    this.socket.socket.emit('room:player-action', this.match_id, {
      player_id: this.curr_turn,
      point,
    }, (success: boolean) => {
      this.isPendding = false;
    })
    return true;
  }

}