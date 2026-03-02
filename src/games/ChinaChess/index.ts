import ChessScene from "./Scene";

export default class ChessGame {
  private scene!: ChessScene;

  constructor(state: any, player: any) {
    this.scene = new ChessScene(state, player);
  }

  async init(canvas: HTMLCanvasElement) {
    await this.scene.init(canvas);
  }

  destroy() {
    if (this.scene) {
      this.scene.dispose();
    }
  }
}