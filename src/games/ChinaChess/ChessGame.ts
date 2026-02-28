import ChessScene from "./ChessScene";

export default class ChessGame {
  private scene!: ChessScene;

  async init(canvas: HTMLCanvasElement) {
    this.scene = new ChessScene();
    await this.scene.create(canvas);
  }

  destroy() {
    if (this.scene) {
      this.scene.dispose();
    }
  }
}