import GameTransport from '../../core/GameTransport'
import Logic from './Logic'
import Scene from './Scene'
export default class Xiangqi {
  logic: Logic;
  scene: Scene;

  constructor(canvas: HTMLCanvasElement, socket: GameTransport, player: any) {
    this.logic = new Logic(socket, player);
    this.scene = new Scene(canvas, this.logic)
  }

  destroy() {
    this.logic.removeAllListeners();
    if (this.scene) {
      this.scene.dispose();
    }
  }
}