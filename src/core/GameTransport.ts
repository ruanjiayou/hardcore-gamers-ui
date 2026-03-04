import { Socket } from "socket.io-client";

export default class SocketTransport {
  socket: Socket;

  constructor(socket: Socket) {
    this.socket = socket
  }

  send() {

  }

  onMessage() {

  }
}