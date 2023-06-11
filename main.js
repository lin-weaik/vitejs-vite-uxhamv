import './style.css';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
let loading = document.createElement('div');
loading.style.position = 'absolute';
loading.style.top = '5px';
loading.style.left = '5px';
loading.style.color = '#fff';
document.body.appendChild(loading);
let selectionShape,
  controls,
  camera,
  c_camera,
  renderer,
  scene,
  model,
  pickingScene,
  mask,
  /**
   * @type THREE.Group
   */
  highlightGroup,
  /**
   * @type THREE.ExtrudeGeometry
   */
  shapeGeometry,
  /**
   * @type THREE.Shape
   */
  maskShape;

/**
 * @type THREE.Mesh<any, any>[]
 */
let acupoints = [];
let selectionShapeNeedsUpdate, selectionNeedsUpdate;
/**
 * @type number[]
 */
let selectionPoints = [];
let startX = -Infinity;
let startY = -Infinity;
let prevX = -Infinity;
let prevY = -Infinity;

const tempVec0 = new THREE.Vector2();
const tempVec1 = new THREE.Vector2();
const tempVec2 = new THREE.Vector2();

const pickingMaterial = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: /* glsl */ `
      attribute int id;
      flat varying int vid;
      void main() {

        vid = id;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

      }
    `,

  fragmentShader: /* glsl */ `
      layout(location = 0) out int out_id;
      flat varying int vid;

      void main() {

        out_id = vid;

      }
    `,
});

function init() {
  // 创建场景
  scene = new THREE.Scene();
  // 第二场景
  pickingScene = new THREE.Scene();

  highlightGroup = new THREE.Group();
  // var geometry = new THREE.BoxGeometry(1, 1, 1);
  // var material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  // var cube = new THREE.Mesh(geometry, material);
  // highlightGroup.add(cube);
  scene.add(highlightGroup);
  {
    // 创建一个形状
    maskShape = new THREE.Shape();
    // 定义外部轮廓
    maskShape.moveTo(-1, -1);
    maskShape.lineTo(-1, 1);
    maskShape.lineTo(1, 1);
    maskShape.lineTo(1, -1);
    // 创建一个几何体
    const extrudeSettings = {
      depth: 0.0000001, // 平面的深度
      bevelEnabled: false, // 禁用斜角
    };
    shapeGeometry = new THREE.ExtrudeGeometry(maskShape, extrudeSettings);
    // 创建一个网格对象并添加到场景中
    mask = new THREE.Mesh(shapeGeometry, pickingMaterial);
    applyId(shapeGeometry, -1);
    mask.position.z = -0.2;
  }

  // 创建相机
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    50
  );
  camera.position.set(2, 4, 6);
  camera.far = 100;
  camera.updateProjectionMatrix();
  scene.add(camera);
  c_camera = camera.clone();
  c_camera.add(mask);
  pickingScene.add(c_camera);

  // 导入FBX模型
  const loader = new FBXLoader();
  loader.load(
    '/hand.fbx',
    function (object) {
      object.rotateY(30);
      model = object;
      scene.add(object);

      object.children.forEach((item, index) => {
        if (
          ['M_HT', 'M_LI', 'M_LU', 'M_PC', 'M_SI', 'M_SJ'].findIndex(
            (nameAdj) => item.name.includes(nameAdj)
          ) > -1
        ) {
          item.userData._id = index;
          acupoints.push(item);
        }
      });
      let pickingSceneObject = object.clone();
      deepSetModel(pickingSceneObject);
      pickingScene.add(pickingSceneObject);
    },
    function (e) {
      loading.innerText = `${e.loaded}/${e.total}`;
      if (e.loaded === e.total) {
        setTimeout(() => {
          document.body.removeChild(loading);
        }, 1000);
      }
    }
  );

  // 创建渲染器
  const bgColor = new THREE.Color(0x263238);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(bgColor, 1);
  renderer.shadowMap.enabled = true;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // 添加光源
  var light = new THREE.AmbientLight(0xffffff, 1);
  scene.add(light);

  // 创建线条对象
  selectionShape = new THREE.Line();
  // selectionShape.material.color.set(0xff9800).convertSRGBToLinear();
  selectionShape.renderOrder = 1;
  selectionShape.position.z = -0.2;
  selectionShape.depthTest = false;
  selectionShape.scale.setScalar(1);
  // 将线条对象添加到相机中
  camera.add(selectionShape);

  // add floor
  const gridHelper = new THREE.GridHelper(10, 10, 0xffffff, 0xffffff);
  gridHelper.material.opacity = 0.2;
  gridHelper.material.transparent = true;
  gridHelper.position.y = -2.75;
  scene.add(gridHelper);

  // controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.minDistance = 3;
  controls.touches.ONE = THREE.TOUCH.PAN;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  controls.touches.TWO = THREE.TOUCH.ROTATE;
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  controls.enablePan = false;

  // c_controls
  let c_controls = new OrbitControls(c_camera, renderer.domElement);
  c_controls.minDistance = 3;
  c_controls.touches.ONE = THREE.TOUCH.PAN;
  c_controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  c_controls.touches.TWO = THREE.TOUCH.ROTATE;
  c_controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  c_controls.enablePan = false;

  // 监听鼠标事件
  document.addEventListener('mousemove', onMouseMove, false);
  document.addEventListener('mousedown', onMouseDown, false);
  document.addEventListener('mouseup', onMouseUp, false);
}

// 渲染循环
function animate() {
  requestAnimationFrame(animate);
  if (selectionShapeNeedsUpdate) {
    const ogLength = selectionPoints.length;
    selectionPoints.push(
      selectionPoints[0],
      selectionPoints[1],
      selectionPoints[2]
    );
    selectionShape.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(selectionPoints, 3, false)
    );

    selectionPoints.length = ogLength;
    selectionShape.frustumCulled = false;
    selectionShapeNeedsUpdate = false;
  }

  if (selectionNeedsUpdate) {
    selectionNeedsUpdate = false;

    if (selectionPoints.length > 0) {
      updateSelection();
    }
  }

  const yScale =
    Math.tan((THREE.MathUtils.DEG2RAD * camera.fov) / 2) *
    selectionShape.position.z;
  selectionShape.scale.set(-yScale * camera.aspect, -yScale, 1);

  const MaskYscale =
    Math.tan((THREE.MathUtils.DEG2RAD * camera.fov) / 2) * mask.position.z;
  mask.scale.set(-MaskYscale * camera.aspect, -MaskYscale, 1);
  // 渲染场景
  renderer.render(scene, camera);
}

function onMouseMove(e) {
  // If the left mouse button is not pressed
  if ((1 & e.buttons) === 0) {
    return;
  }

  const ex = e.clientX;
  const ey = e.clientY;

  const nx = (e.clientX / window.innerWidth) * 2 - 1;
  const ny = -((e.clientY / window.innerHeight) * 2 - 1);
  // If the mouse hasn't moved a lot since the last point
  if (Math.abs(ex - prevX) >= 3 || Math.abs(ey - prevY) >= 3) {
    // Check if the mouse moved in roughly the same direction as the previous point
    // and replace it if so.
    const i = selectionPoints.length / 3 - 1;
    const i3 = i * 3;
    let doReplace = false;
    if (selectionPoints.length > 3) {
      // prev segment direction
      tempVec0.set(selectionPoints[i3 - 3], selectionPoints[i3 - 3 + 1]);
      tempVec1.set(selectionPoints[i3], selectionPoints[i3 + 1]);
      tempVec1.sub(tempVec0).normalize();

      // this segment direction
      tempVec0.set(selectionPoints[i3], selectionPoints[i3 + 1]);
      tempVec2.set(nx, ny);
      tempVec2.sub(tempVec0).normalize();

      const dot = tempVec1.dot(tempVec2);
      doReplace = dot > 0.99;
    }

    if (doReplace) {
      selectionPoints[i3] = nx;
      selectionPoints[i3 + 1] = ny;
    } else {
      selectionPoints.push(nx, ny, 0);
    }

    selectionShapeNeedsUpdate = true;
    selectionShape.visible = true;

    prevX = ex;
    prevY = ey;
  }
}

function onMouseDown(e) {
  prevX = e.clientX;
  prevY = e.clientY;
  startX = (e.clientX / window.innerWidth) * 2 - 1;
  startY = -((e.clientY / window.innerHeight) * 2 - 1);
  selectionPoints.length = 0;
  selectionShapeNeedsUpdate = true;
}

function onMouseUp() {
  selectionShape.visible = false;
  if (selectionPoints.length) {
    selectionNeedsUpdate = true;
  }
}

/**
 *
 * @param {THREE.Group} object
 */
function deepSetModel(object) {
  object.children.forEach((item) => {
    if (item instanceof THREE.Mesh) {
      if (
        ['M_HT', 'M_LI', 'M_LU', 'M_PC', 'M_SI', 'M_SJ'].findIndex((nameAdj) =>
          item.name.includes(nameAdj)
        ) > -1
      ) {
        applyId(item.geometry, item.userData._id);
        item.material = pickingMaterial;
      } else {
        applyId(item.geometry, -1);
        item.material = pickingMaterial;
      }
    } else if (item instanceof THREE.Group) {
      deepSetModel(item);
    }
  });
  return object;
}

function updateSelection() {
  highlightGroup.clear();
  const width = renderer.domElement.width;
  const height = renderer.domElement.height;
  let pickingTexture = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.IntType,
    format: THREE.RGBAIntegerFormat,
    internalFormat: 'RGBA32I',
  });
  let pixelBuffer = new Int32Array(width * height * 4);
  maskShape.holes.length = 0;
  let hole = new THREE.Path();
  for (let i = 0; i < selectionPoints.length; i += 3) {
    const x = selectionPoints[i];
    const y = selectionPoints[i + 1];
    if (i === 0) {
      hole.moveTo(x, y);
    } else {
      hole.lineTo(x, y);
    }
  }
  maskShape.holes.push(hole);
  shapeGeometry.dispose();
  shapeGeometry = new THREE.ExtrudeGeometry(maskShape, {
    depth: 0.0000001, // 平面的深度
    bevelEnabled: false, // 禁用斜角
  });
  applyId(shapeGeometry, -1);
  mask.geometry = shapeGeometry;

  renderer.setRenderTarget(pickingTexture);
  // renderer.setClearColor(new THREE.Color(-1, -1, -1));
  renderer.render(pickingScene, c_camera);
  renderer.setRenderTarget(null);
  renderer.readRenderTargetPixels(
    pickingTexture,
    0,
    0,
    width,
    height,
    pixelBuffer
  );
  const selectIdPixs = [];
  for (let i = 0; i < pixelBuffer.length; i += 4) {
    if (pixelBuffer[i]) {
      selectIdPixs.push(pixelBuffer[i]);
    }
  }
  const ids = Array.from(new Set(selectIdPixs)).filter((item) => item !== -1);
  ids.forEach((id) => {
    let acupoint = acupoints.find((item) => item.userData._id === id);
    const helper = new THREE.BoxHelper(acupoint, 0xffff00);
    highlightGroup.add(helper);
  });
}
init();
animate();

function applyId(geometry, id) {
  const position = geometry.attributes.position;
  const array = new Int16Array(position.count);
  array.fill(id);

  const bufferAttribute = new THREE.Int16BufferAttribute(array, 1, false);
  bufferAttribute.gpuType = THREE.IntType;
  geometry.setAttribute('id', bufferAttribute);
}
