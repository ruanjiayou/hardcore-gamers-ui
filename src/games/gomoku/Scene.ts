// ChessScene.ts
import {
  Scene,
  Engine,
  MeshBuilder,
  Vector3,
  Color3,
  StandardMaterial,
  TransformNode,
  GroundMesh,
  HighlightLayer,
  Texture,
  DynamicTexture,
  PointerEventTypes,
  Mesh,
  ArcRotateCamera,
  FxaaPostProcess,
  HemisphericLight,
} from "@babylonjs/core"
import { GridMaterial } from "@babylonjs/materials/grid";
import GomokuLogic from "./Logic";

export default class GomokuScene {
  engine!: Engine;
  scene!: Scene;
  logic: GomokuLogic;
  inited: boolean = false;

  board: GroundMesh | null = null;
  highlightLayer: HighlightLayer | null = null;

  pieceMap = new Map<string, Mesh>();

  selected: string = '';

  constructor(canvas: HTMLCanvasElement, logic: GomokuLogic) {
    this.logic = logic;
    this.logic.on('state', () => {
      this.clear()
      this.createPieces();
    });
    this.logic.on('move', (data: { x: number, y: number, role: 'white' | 'black' }) => {
      this.onMovePiece({ x: data.x - 7, y: data.y - 7, role: data.role })
    })

    this.engine = new Engine(canvas, true, {
      antialias: true,
      preserveDrawingBuffer: true,
      stencil: true
    });
    this.engine.setHardwareScalingLevel(1 / window.devicePixelRatio)
    this.scene = new Scene(this.engine);
    const camera = new ArcRotateCamera(
      "camera",
      Math.PI / 2,
      0,
      25,
      new Vector3(0, 0, 0),
      this.scene
    );
    camera.attachControl(canvas, true);
    const fxaa = new FxaaPostProcess("fxaa", 1.0, null, 1, this.engine);
    camera.attachPostProcess(fxaa);

    // 禁用触摸旋转
    if (camera.inputs.attached.touch) {
      camera.inputs.attached.touch.detachControl();
    }

    // 禁用键盘
    if (camera.inputs.attached.keyboard) {
      camera.inputs.attached.keyboard.detachControl();
    }

    // 禁用滚轮缩放
    if (camera.inputs.attached.mousewheel) {
      camera.inputs.attached.mousewheel.detachControl();
    }

    // 禁用多点触控缩放
    // if (camera.inputs.attached.pointers) {
    //   camera.inputs.attached.pointers.detachControl();
    // }

    const light = new HemisphericLight("light",
      new Vector3(1, 1, 1),
      this.scene);
    // // 调低强度
    // light.intensity = 0.5;   // 推荐 0.4 ~ 0.7

    // // 上方光颜色（别太白）
    // light.diffuse = new Color3(0.5, 0.5, 0.5);

    // // 地面反射光调暗（关键！）
    light.groundColor = new Color3(0.05, 0.05, 0.05);

    // 高亮层
    this.highlightLayer = new HighlightLayer("highlightLayer", this.scene);

    this.createBoard();
    this.setupPicking();
    // this.createDebugHelper({})

    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  async init() {
    if (this.inited) {
      return;
    } else {
      this.inited = true
    }

    await this.scene.whenReadyAsync()
  }

  createDebugHelper(options: any) {

    const {
      size = 10,
      step = 1,
      gridSize = 10,
      axisDiameter = 0.04
    } = options;

    const root = new TransformNode("debugHelper", this.scene);

    const createMaterial = (color: any) => {
      const mat = new StandardMaterial("mat", this.scene);
      mat.emissiveColor = color;
      mat.disableLighting = true;
      return mat;
    }

    const matX = createMaterial(new Color3(1, 0, 0));
    const matY = createMaterial(new Color3(0, 1, 0));
    const matZ = createMaterial(new Color3(0, 0, 1));
    const matTick = createMaterial(new Color3(0.7, 0.7, 0.7));

    const createAxis = (dir: any, mat: any) => {

      const axis = MeshBuilder.CreateCylinder("axis", {
        height: size,
        diameter: axisDiameter
      }, this.scene);

      axis.material = mat;
      axis.parent = root;

      if (dir.x) axis.rotation.z = Math.PI / 2;
      if (dir.z) axis.rotation.x = Math.PI / 2;

      axis.position = dir.scale(size / 2);

      for (let i = step; i <= size; i += step) {

        const major = i % 5 === 0;

        const tick = MeshBuilder.CreateCylinder("tick", {
          height: major ? 0.5 : 0.25,
          diameter: axisDiameter * 0.6
        }, this.scene);

        tick.material = matTick;
        tick.parent = root;

        const p = dir.scale(i);

        if (dir.x) {
          tick.rotation.z = Math.PI / 2;
          tick.position = p;
        }

        if (dir.y) {
          tick.position = p;
        }

        if (dir.z) {
          tick.rotation.x = Math.PI / 2;
          tick.position = p;
        }
      }
    }

    createAxis(new Vector3(1, 0, 0), matX);
    createAxis(new Vector3(0, 1, 0), matY);
    createAxis(new Vector3(0, 0, 1), matZ);

    // 原点球
    const origin = MeshBuilder.CreateSphere("origin", {
      diameter: 0.15
    }, this.scene);

    origin.material = createMaterial(new Color3(1, 1, 0));
    origin.parent = root;

    // Grid
    const grid = MeshBuilder.CreateGround("grid", {
      width: gridSize,
      height: gridSize,
      subdivisions: gridSize
    }, this.scene);

    const gridMat = new GridMaterial("gridMat", this.scene);
    gridMat.majorUnitFrequency = 5;
    gridMat.minorUnitVisibility = 0.45;
    gridMat.gridRatio = 1;
    gridMat.backFaceCulling = false;
    gridMat.mainColor = new Color3(0.9, 0.8, 0.64);
    gridMat.lineColor = new Color3(0.7, 0.7, 0.7);
    gridMat.opacity = 0.6;

    grid.material = gridMat;
    grid.parent = root;

    root.position._y = -0.1

    return root;
  }

  createBoard() {
    const cols = 14;
    const rows = 14;
    const cellSize = 1;
    const margin = 1;

    const width = (cols - 1) * cellSize + margin * 2;
    const height = (rows - 1) * cellSize + margin * 2;

    const board = MeshBuilder.CreateGround(
      "board",
      { width, height },
      this.scene
    );

    const texSize = 2048;

    const dt = new DynamicTexture(
      "boardTexture",
      texSize,
      this.scene,
      true
    );
    // 纹理采样优化
    dt.updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);
    dt.anisotropicFilteringLevel = 16; // 各向异性过滤

    const ctx = dt.getContext() as CanvasRenderingContext2D;

    ctx.fillStyle = "#E8CFA5";
    ctx.fillRect(0, 0, texSize, texSize);

    ctx.strokeStyle = "#222";
    ctx.lineWidth = 5;

    // 3. 开启抗锯齿
    ctx.imageSmoothingEnabled = true;
    ctx.translate(0.5, 0.5); // 避免线条模糊

    // 像素比例
    const pxPerUnitX = texSize / width;
    const pxPerUnitY = texSize / height;

    // 关键：以世界中心为原点计算
    const halfLineWidth = ((cols) * cellSize) / 2;
    const halfLineHeight = ((rows) * cellSize) / 2;

    for (let row = 0; row <= rows; row++) {
      const worldZ = row * cellSize - halfLineHeight;
      const y = texSize / 2 - worldZ * pxPerUnitY;
      ctx.beginPath();
      ctx.moveTo(
        texSize / 2 - halfLineWidth * pxPerUnitX,
        y
      );
      ctx.lineTo(
        texSize / 2 + halfLineWidth * pxPerUnitX,
        y
      );
      ctx.stroke();
    }

    for (let col = 0; col <= cols; col++) {
      const worldX = col * cellSize - halfLineWidth;
      const x = texSize / 2 + worldX * pxPerUnitX;

      ctx.beginPath();
      ctx.moveTo(x, texSize / 2 - halfLineHeight * pxPerUnitY);
      ctx.lineTo(x, texSize / 2 + halfLineHeight * pxPerUnitY);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(texSize / 2, texSize / 2, pxPerUnitX / 8, 0, Math.PI * 2)
    ctx.fillStyle = "#000000";        // 红色填充
    ctx.lineWidth = 0;
    ctx.fill();
    ctx.stroke();

    dt.update();

    const mat = new StandardMaterial("boardMat", this.scene);
    mat.backFaceCulling = false;
    mat.diffuseTexture = dt;
    mat.specularColor = Color3.Black();

    board.material = mat;
    board.position.y = -0.01

    this.board = board;
  }

  createPiece(x: number, y: number, role: "white" | "black") {
    const id = `piece-${x}-${y}-${role}`;

    // 创建扁球体（标准五子棋棋子）
    const piece = MeshBuilder.CreateSphere(
      id,
      { diameter: 0.8, segments: 32 },
      this.scene
    );

    // 压扁成棋子形状
    piece.scaling.y = 0.25;
    piece.position.set(x, 0.1, y);

    // 材质
    const material = new StandardMaterial(id + "-mat", this.scene);

    if (role === "white") {
      material.diffuseColor = new Color3(0.95, 0.95, 0.9);
      material.specularColor = new Color3(0.3, 0.3, 0.3);
    } else {
      material.diffuseColor = new Color3(0.15, 0.15, 0.15);
      material.specularColor = new Color3(0.2, 0.2, 0.2);
    }

    material.specularPower = 32;
    piece.material = material;
    piece.isPickable = true;

    return piece;
  }

  createPieces() {
    this.logic.board.forEach((role: 'white' | 'black', key: string) => {
      const [x, y] = key.split('|').map(v => parseInt(v, 10));
      if (role) {
        const mesh = this.createPiece(x - 7, y - 7, role)
        this.pieceMap.set(key, mesh);
      }
    });
  }

  setupPicking() {
    this.scene.onPointerObservable.add(pointer => {
      if (this.logic.isPendding) {
        return;
      }
      if (!pointer.pickInfo?.hit) return;
      const name = pointer.pickInfo.pickedMesh?.name;
      if (!name) return;
      if (!this.logic.isMyTurn()) {
        return;
      }

      const p = {
        x: Math.round(pointer.pickInfo.pickedPoint?._x || -1),
        y: Math.round(pointer.pickInfo.pickedPoint?._z || -1),
        role: this.logic.player.role,
      }
      // this.addPieceHightlight()
      if (name.startsWith('board') && Math.abs(p.x) <= 7 && Math.abs(p.y) <= 7) {
        this.logic.move(p)
      }
    }, PointerEventTypes.POINTERDOWN);
  }

  clear() {
    this.pieceMap.forEach((mesh, key) => {
      if (mesh) {
        mesh.dispose();
      }
    });

    // 清空 Map
    this.pieceMap.clear();

    // 可选：强制触发场景更新
    this.scene.render();
  }

  cancelPieceHighlight() {
    const piece = this.pieceMap.get(this.selected);
    if (piece) {
      this.highlightLayer?.removeMesh(piece)
    }
    this.selected = ''
  }
  addPieceHightlight() {
    const piece = this.pieceMap.get(this.selected);
    const color = Color3.Yellow();
    if (piece && this.highlightLayer) {
      this.highlightLayer.addMesh(piece, color)
    }
  }

  onMovePiece(point: { x: number, y: number, role: 'white' | 'black' }) {
    const piece = this.createPiece(point.x, point.y, point.role)
    this.cancelPieceHighlight()
    this.selected = `${point.x}|${point.y}`
    this.pieceMap.set(this.selected, piece)
    this.addPieceHightlight()
  }

  dispose() {
    this.scene.dispose();
    this.engine.dispose();
  }
}