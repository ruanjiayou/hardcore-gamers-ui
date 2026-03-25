import EventEmitter from "eventemitter3"
import SocketTransport from "../../core/GameTransport";

export type PieceRole = "white" | "black";

export default class GomokuLogic extends EventEmitter {
  socket: SocketTransport;

  board = new Map<string, PieceRole>();
  player: { _id: string; role: PieceRole };
  curr_turn: string;
  match_id: string;
  isPendding = false;

  constructor(socket: SocketTransport, player: any) {
    super()
    this.socket = socket;
    this.player = player;
    this.curr_turn = '';
    this.match_id = '';
    this.socket.socket.on('room:player-action', (data: { next_turn: string, to: { x: number, y: number, role: PieceRole } }) => {
      this.curr_turn = data.next_turn;
      this.board.set(`${data.to.x}|${data.to.y}`, data.to.role)

      this.emit('move', data.to);
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

  move(to: { x: number, y: number, role: PieceRole }): boolean {
    const piece = this.board.get(`${to.x}|${to.y}`);
    if (piece || this.player?._id !== this.curr_turn) return false;

    this.socket.socket.emit('room:player-action', this.match_id, {
      player_id: this.curr_turn,
      to: { x: to.x + 7, y: to.y + 7, role: to.role },
    }, (data: { success: boolean; message: string }) => {
      this.isPendding = false;
    })
    return true;
  }

}