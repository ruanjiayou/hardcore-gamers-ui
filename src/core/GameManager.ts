export interface IGameModule {
  init(canvas: HTMLCanvasElement): Promise<void>;
  setState(state: any): void;
  destroy(): void;
}

class GameManager {
  private currentGame: IGameModule | null = null;

  async load(gameId: string, canvas: HTMLCanvasElement) {
    if (this.currentGame) {
      return;
    }
    const Game = (await import(/* @vite-ignore */`../games/${gameId}/index`)).default;
    this.currentGame = new Game();
    // @ts-ignore
    await this.currentGame.init(canvas);
  }

  setState(state: any) {
    if (this.currentGame) {
      this.currentGame.setState(state)
    }
  }

  unload() {
    if (this.currentGame) {
      this.currentGame.destroy();
      this.currentGame = null;
    }
  }
}

export const gameManager = new GameManager();