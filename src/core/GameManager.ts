import { Socket } from "socket.io-client";
import GameTransport from './GameTransport'

export interface IGameModule {
  logic: any;
  scene: {
    init(canvas: HTMLCanvasElement): Promise<void>;
  };
  destroy(): void;
}

class GameManager {
  inited: boolean = false;
  game: IGameModule | null = null;

  async load(gameId: string, canvas: HTMLCanvasElement, socket: Socket) {
    if (this.inited) {
      return;
    }
    this.inited = true
    const Game = (await import(/* @vite-ignore */`../games/${gameId}/index`)).default;
    this.game = new Game(canvas, new GameTransport(socket));
    // @ts-ignore
    await this.game?.scene.init();
    return this.game;
  }

  unload() {
    if (this.game) {
      this.game.destroy();
      this.game = null;
      this.inited = false;
    }
  }
}

export const gameManager = new GameManager();