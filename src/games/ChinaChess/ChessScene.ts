import * as BABYLON from "babylonjs";

export default class ChessScene {
  engine!: BABYLON.Engine;
  scene!: BABYLON.Scene;

  async create(canvas: HTMLCanvasElement) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);

    const camera = new BABYLON.ArcRotateCamera(
      "camera",
      Math.PI / 2,
      Math.PI / 3,
      20,
      BABYLON.Vector3.Zero(),
      this.scene
    );

    camera.attachControl(canvas, true);

    const light = new BABYLON.HemisphericLight(
      "light",
      new BABYLON.Vector3(0, 1, 0),
      this.scene
    );

    this.createBoard();

    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  createBoard() {
    const size = 9;

    for (let x = -4; x <= 4; x++) {
      for (let z = -4; z <= 4; z++) {
        const box = BABYLON.MeshBuilder.CreateGround(
          `tile-${x}-${z}`,
          { width: 1, height: 1 },
          this.scene
        );

        box.position.x = x;
        box.position.z = z;

        const mat = new BABYLON.StandardMaterial("mat", this.scene);
        mat.diffuseColor =
          (x + z) % 2 === 0
            ? new BABYLON.Color3(0.8, 0.8, 0.8)
            : new BABYLON.Color3(0.2, 0.2, 0.2);

        box.material = mat;
      }
    }
  }

  dispose() {
    this.scene.dispose();
    this.engine.dispose();
  }
}