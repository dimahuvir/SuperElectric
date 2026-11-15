// ==================== СОСТОЯНИЕ ПРОЕКТА ====================
const state = {
  step: 1,
  wallCount: 3, // 1 = прямая, 2 = Г, 3 = П, 4 = квадрат
  wallLength: 4.0, // метров
  wallHeight: 2.7, // метров
  xrayWalls: false,
  selectedPointId: null,

  // Высоты по умолчанию (в метрах)
  heights: {
    socket: 0.30,
    switch: 0.95,
    junction: 2.40,
    led: 2.50,
    panel: 1.50
  },

  // Щиток
  panel: {
    wall: 3,
    posZone: 'left_edge'
  },

  // Общие распредкоробки (одна над группой коробок на стене)
  junctionBoxes: [
    { id: 'JB1', wall: 1, posZone: 'center', boxSize: '10x15' },
    { id: 'JB2', wall: 2, posZone: 'center', boxSize: '10x10' },
    { id: 'JB3', wall: 3, posZone: 'center_right', boxSize: '10x15' }
  ],

  // Точки (подрозетники / выводы спирали), каждая привязана к общей распредкоробке
  points: [
    { id: 1, wall: 1, type: 'socket', posZone: 'start', height: 0.30, jbId: 'JB1', targetLedId: null },
    { id: 2, wall: 1, type: 'socket', posZone: 'center_right', height: 0.30, jbId: 'JB1', targetLedId: null },
    { id: 3, wall: 2, type: 'switch', posZone: 'start', height: 0.95, jbId: 'JB2', targetLedId: 4 },
    { id: 4, wall: 2, type: 'led', posZone: 'center_right', height: 2.50, jbId: 'JB2', targetLedId: null },
    { id: 5, wall: 3, type: 'socket', posZone: 'center_right', height: 0.30, jbId: 'JB3', targetLedId: null }
  ]
};

const POS_ZONES = [
  { id: 'left_edge', label: 'Крайняя левая (0.25м)', ratio: 0.07 },
  { id: 'start', label: 'Начало стены (0.7м)', ratio: 0.18 },
  { id: 'center_left', label: 'От середины влево', ratio: 0.36 },
  { id: 'center', label: 'Середина стены', ratio: 0.50 },
  { id: 'center_right', label: 'От середины вправо', ratio: 0.64 },
  { id: 'right_edge', label: 'Крайняя правая', ratio: 0.88 }
];

const BOX_SIZES = ['7x7', '10x10', '10x15', 'Круглая'];

const TYPE_INFO = {
  socket: { label: 'Розетка', color: '#38bdf8', section: '1x2.5' },
  switch: { label: 'Выключатель', color: '#facc15', section: '1x1.5' },
  led: { label: 'Вывод спираль (LED)', color: '#c084fc', section: '1x1.5' }
};

function getRatio(zoneId) {
  const z = POS_ZONES.find(item => item.id === zoneId);
  return z ? z.ratio : 0.5;
}

function getZoneLabel(zoneId) {
  const z = POS_ZONES.find(item => item.id === zoneId);
  return z ? z.label : zoneId;
}

// ==================== ГЕОМЕТРИЯ СТЕН (1, 2-Г, 3-П, 4-КВАДРАТ) ====================
function getWallTransform(wallIndex) {
  const L = state.wallLength;
  const half = L / 2;
  if (state.wallCount === 1) {
    return { pos: new THREE.Vector3(0, 0, 0), rotY: 0 };
  }
  if (state.wallCount === 2) {
    if (wallIndex === 1) return { pos: new THREE.Vector3(0, 0, -half), rotY: 0 };
    if (wallIndex === 2) return { pos: new THREE.Vector3(half, 0, 0), rotY: -Math.PI / 2 };
  }
  if (state.wallCount === 3) {
    if (wallIndex === 1) return { pos: new THREE.Vector3(-half, 0, 0), rotY: Math.PI / 2 };
    if (wallIndex === 2) return { pos: new THREE.Vector3(0, 0, -half), rotY: 0 };
    if (wallIndex === 3) return { pos: new THREE.Vector3(half, 0, 0), rotY: -Math.PI / 2 };
  }
  if (wallIndex === 1) return { pos: new THREE.Vector3(-half, 0, 0), rotY: Math.PI / 2 };
  if (wallIndex === 2) return { pos: new THREE.Vector3(0, 0, -half), rotY: 0 };
  if (wallIndex === 3) return { pos: new THREE.Vector3(half, 0, 0), rotY: -Math.PI / 2 };
  if (wallIndex === 4) return { pos: new THREE.Vector3(0, 0, half), rotY: Math.PI };
  return { pos: new THREE.Vector3(0, 0, 0), rotY: 0 };
}

function wallToWorld(wallIndex, ratioU, y, inset = 0.08) {
  const { pos, rotY } = getWallTransform(wallIndex);
  const localX = (ratioU - 0.5) * state.wallLength;
  const localZ = inset;
  const vec = new THREE.Vector3(localX, y, localZ);
  vec.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  vec.add(pos);
  return vec;
}

function getCornerWorld(wallFrom, wallTo, y, inset = 0.08) {
  const step = wallFrom < wallTo ? 1 : -1;
  const pts = [];
  for (let w = wallFrom; w !== wallTo; w += step) {
    if (step > 0) {
      pts.push(wallToWorld(w, 0.98, y, inset));
      pts.push(wallToWorld(w + 1, 0.02, y, inset));
    } else {
      pts.push(wallToWorld(w, 0.02, y, inset));
      pts.push(wallToWorld(w - 1, 0.98, y, inset));
    }
  }
  return pts;
}

// ==================== РАСЧЕТ ТРУБ И МАРШРУТОВ ПРОВОДОВ ====================
function buildRoutingData() {
  const pipes = [];
  const wireRuns = [];

  const validJBs = state.junctionBoxes.filter(jb => jb.wall <= state.wallCount);
  const validPoints = state.points.filter(p => p.wall <= state.wallCount);

  const jbY = state.heights.junction;
  const panelWall = Math.min(state.panel.wall, state.wallCount);
  const panelRatio = getRatio(state.panel.posZone);
  const panelTop3D = wallToWorld(panelWall, panelRatio, jbY, 0.08);
  const panelBox3D = wallToWorld(panelWall, panelRatio, state.heights.panel, 0.08);

  // 1. Вертикальная магистраль от щитка
  pipes.push({
    id: 'PIPE-PANEL-MAIN',
    label: 'Магистраль от щитка наверх',
    points3D: [panelBox3D, panelTop3D],
    length: Math.abs(jbY - state.heights.panel),
    category: 'main'
  });

  // 2. Горизонтальная магистраль до общих распредкоробок
  validJBs.forEach(jb => {
    const jbRatio = getRatio(jb.posZone);
    const jb3D = wallToWorld(jb.wall, jbRatio, jbY, 0.08);
    const path = [panelTop3D];
    if (panelWall !== jb.wall) {
      path.push(...getCornerWorld(panelWall, jb.wall, jbY, 0.08));
    }
    path.push(jb3D);
    pipes.push({
      id: `PIPE-MAIN-${jb.id}`,
      label: `Магистраль Щиток → ${jb.id} (Стена ${jb.wall})`,
      points3D: path,
      length: calcPathLength(path),
      category: 'main'
    });
  });

  // 3. Индивидуальная труба под каждую коробку -> в общую распредкоробку
  validPoints.forEach(pt => {
    let jb = validJBs.find(b => b.id === pt.jbId && b.wall === pt.wall) || validJBs.find(b => b.wall === pt.wall);
    if (!jb) return;

    const ptRatio = getRatio(pt.posZone);
    const jbRatio = getRatio(jb.posZone);

    const sameJbPoints = validPoints.filter(p => (p.jbId === jb.id || (!validJBs.some(x => x.id === p.jbId) && p.wall === jb.wall)));
    const slotIdx = sameJbPoints.findIndex(p => p.id === pt.id);
    const offsetRatio = (slotIdx - (sameJbPoints.length - 1) / 2) * 0.015;

    const pt3D = wallToWorld(pt.wall, ptRatio, pt.height, 0.08);
    const elbowY = pt.height < jbY ? jbY - 0.06 : jbY + 0.06;
    const elbow3D = wallToWorld(pt.wall, ptRatio, elbowY, 0.08);
    const jbEntry3D = wallToWorld(jb.wall, Math.min(0.96, Math.max(0.04, jbRatio + offsetRatio)), jbY, 0.08);

    const dropPath = [pt3D, elbow3D, jbEntry3D];
    const dropLen = calcPathLength(dropPath);

    pipes.push({
      id: `PIPE-PT-${pt.id}`,
      label: `Труба №${pt.id} (${TYPE_INFO[pt.type].label}) → ${jb.id}`,
      points3D: dropPath,
      length: dropLen,
      category: 'drop'
    });

    // 4. Провода от начала до конца
    const mainToJb = [panelBox3D, panelTop3D];
    if (panelWall !== jb.wall) {
      mainToJb.push(...getCornerWorld(panelWall, jb.wall, jbY, 0.08));
    }
    mainToJb.push(jbEntry3D);

    if (pt.type === 'socket') {
      const fullPath = [...mainToJb, elbow3D, pt3D];
      wireRuns.push({
        pointId: pt.id,
        label: `Розетка #${pt.id} (Щиток → ${jb.id} → Розетка #${pt.id})`,
        section: '1x2.5',
        colors: ['blue', 'yellow_green', 'brown'],
        path3D: fullPath,
        length: calcPathLength(fullPath)
      });
    } else if (pt.type === 'switch') {
      const feedPath = [...mainToJb, elbow3D, pt3D];
      wireRuns.push({
        pointId: pt.id,
        label: `Выключатель #${pt.id} подача L (Щиток → ${jb.id} → Выкл #${pt.id})`,
        section: '1x1.5',
        colors: ['brown'],
        path3D: feedPath,
        length: calcPathLength(feedPath)
      });

      const targetLed = validPoints.find(p => p.id === pt.targetLedId && p.type === 'led') || validPoints.find(p => p.type === 'led');
      if (targetLed) {
        const ledJb = validJBs.find(b => b.id === targetLed.jbId && b.wall === targetLed.wall) || validJBs.find(b => b.wall === targetLed.wall);
        if (ledJb) {
          const ledPt3D = wallToWorld(targetLed.wall, getRatio(targetLed.posZone), targetLed.height, 0.08);
          const ledElbowY = targetLed.height < jbY ? jbY - 0.06 : jbY + 0.06;
          const ledElbow3D = wallToWorld(targetLed.wall, getRatio(targetLed.posZone), ledElbowY, 0.08);
          const ledJb3D = wallToWorld(ledJb.wall, getRatio(ledJb.posZone), jbY, 0.08);

          const switchToLedPath = [pt3D, elbow3D, jbEntry3D];
          if (jb.wall !== ledJb.wall) {
            switchToLedPath.push(...getCornerWorld(jb.wall, ledJb.wall, jbY, 0.08));
          }
          if (jb.id !== ledJb.id) {
            switchToLedPath.push(ledJb3D);
          }
          switchToLedPath.push(ledElbow3D, ledPt3D);

          const commColor = (pt.id % 2 === 1) ? 'red' : 'black';
          wireRuns.push({
            pointId: pt.id,
            label: `Коммутация Выкл #${pt.id} → LED #${targetLed.id}`,
            section: '1x1.5',
            colors: [commColor],
            path3D: switchToLedPath,
            length: calcPathLength(switchToLedPath)
          });
        }
      }
    } else if (pt.type === 'led') {
      const neutralEarthPath = [...mainToJb, elbow3D, pt3D];
      wireRuns.push({
        pointId: pt.id,
        label: `LED #${pt.id} питание N+PE (Щиток → ${jb.id} → LED #${pt.id})`,
        section: '1x1.5',
        colors: ['blue', 'yellow_green'],
        path3D: neutralEarthPath,
        length: calcPathLength(neutralEarthPath)
      });
    }
  });

  const totals = {
    '1x2.5': { blue: 0, yellow_green: 0, brown: 0 },
    '1x1.5': { blue: 0, yellow_green: 0, brown: 0, red: 0, black: 0 }
  };

  wireRuns.forEach(run => {
    const lenWithReserve = run.length * 1.15;
    run.colors.forEach(c => {
      if (totals[run.section][c] !== undefined) {
        totals[run.section][c] += lenWithReserve;
      }
    });
  });

  return { pipes, wireRuns, totals, validJBs, validPoints };
}

function calcPathLength(pts) {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    sum += pts[i].distanceTo(pts[i - 1]);
  }
  return sum;
}

// ==================== THREE.JS 3D СЦЕНА ====================
let scene, camera, renderer, controls, worldGroup;
const clickableMeshes = [];

function init3D() {
  const container = document.getElementById('canvas-container');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1120);

  camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 3.2, 6.2);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1.3, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dir = new THREE.DirectionalLight(0xffffff, 0.65);
  dir.position.set(4, 8, 5);
  scene.add(dir);

  scene.add(new THREE.GridHelper(10, 20, 0x334155, 0x1e293b));

  worldGroup = new THREE.Group();
  scene.add(worldGroup);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown', (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(clickableMeshes);
    if (hits.length > 0 && hits[0].object.userData.pointId) {
      const pid = hits[0].object.userData.pointId;
      state.selectedPointId = (state.selectedPointId === pid) ? null : pid;
      renderUI();
      rebuild3D();
    }
  });

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function resetCamera() {
  camera.position.set(0, 3.2, 6.2);
  controls.target.set(0, 1.3, 0);
}

function toggleWallTransparency() {
  state.xrayWalls = !state.xrayWalls;
  document.getElementById('btn-xray').innerText = `👁 Прозрачность: ${state.xrayWalls ? 'ВКЛ' : 'ВЫКЛ'}`;
  rebuild3D();
}

function makeTextSprite(text, bgColor = '#1e293b', textColor = '#f8fafc') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 56, 12);
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.85, 0.22, 1);
  return sprite;
}

function drawTubePolyline(points3D, radius, colorHex, opacity = 1.0) {
  for (let i = 1; i < points3D.length; i++) {
    const p1 = points3D[i - 1];
    const p2 = points3D[i];
    const dist = p1.distanceTo(p2);
    if (dist < 0.005) continue;
    const geom = new THREE.CylinderGeometry(radius, radius, dist, 10);
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      transparent: opacity < 1,
      opacity: opacity,
      roughness: 0.4
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
    worldGroup.add(mesh);
  }
}

function rebuild3D() {
  while (worldGroup.children.length > 0) {
    worldGroup.remove(worldGroup.children[0]);
  }
  clickableMeshes.length = 0;

  const { pipes, wireRuns, validJBs, validPoints } = buildRoutingData();

  for (let w = 1; w <= state.wallCount; w++) {
    const { pos, rotY } = getWallTransform(w);
    const wallGeom = new THREE.BoxGeometry(state.wallLength, state.wallHeight, 0.12);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      transparent: true,
      opacity: state.xrayWalls ? 0.25 : 0.92,
      roughness: 0.85
    });
    const wallMesh = new THREE.Mesh(wallGeom, wallMat);
    wallMesh.position.set(pos.x, state.wallHeight / 2, pos.z);
    wallMesh.rotation.y = rotY;
    worldGroup.add(wallMesh);

    const label = makeTextSprite(`СТЕНА ${w}`, '#0f172a', '#fbbf24');
    label.position.copy(wallToWorld(w, 0.5, state.wallHeight + 0.18, 0.05));
    worldGroup.add(label);
  }

  const pWall = Math.min(state.panel.wall, state.wallCount);
  const pPos = wallToWorld(pWall, getRatio(state.panel.posZone), state.heights.panel, 0.09);
  const pRot = getWallTransform(pWall).rotY;
  const panelMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.48, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xef4444 })
  );
  panelMesh.position.copy(pPos);
  panelMesh.rotation.y = pRot;
  worldGroup.add(panelMesh);

  const pSprite = makeTextSprite('ЩИТОК', '#7f1d1d', '#ffffff');
  pSprite.position.copy(pPos).add(new THREE.Vector3(0, 0.34, 0));
  worldGroup.add(pSprite);

  validJBs.forEach(jb => {
    const jbPos = wallToWorld(jb.wall, getRatio(jb.posZone), state.heights.junction, 0.09);
    const rot = getWallTransform(jb.wall).rotY;
    const isRound = jb.boxSize === 'Круглая';
    const geom = isRound
      ? new THREE.CylinderGeometry(0.085, 0.085, 0.06, 20)
      : new THREE.BoxGeometry(jb.boxSize === '10x15' ? 0.22 : 0.16, 0.14, 0.06);
    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0xf97316 }));
    mesh.position.copy(jbPos);
    mesh.rotation.y = rot;
    if (isRound) mesh.rotation.x = Math.PI / 2;
    worldGroup.add(mesh);

    const lbl = makeTextSprite(`${jb.id} (${jb.boxSize})`, '#7c2d12', '#ffedd5');
    lbl.position.copy(jbPos).add(new THREE.Vector3(0, 0.17, 0));
    worldGroup.add(lbl);
  });

  validPoints.forEach(pt => {
    const pos = wallToWorld(pt.wall, getRatio(pt.posZone), pt.height, 0.09);
    const rot = getWallTransform(pt.wall).rotY;
    const isSelected = state.selectedPointId === pt.id;

    const geom = pt.type === 'led'
      ? new THREE.TorusGeometry(0.065, 0.018, 12, 24)
      : new THREE.CylinderGeometry(0.065, 0.065, 0.05, 20);

    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      color: isSelected ? 0xffffff : TYPE_INFO[pt.type].color,
      emissive: isSelected ? 0x38bdf8 : 0x000000
    }));
    mesh.position.copy(pos);
    mesh.rotation.y = rot;
    if (pt.type !== 'led') mesh.rotation.x = Math.PI / 2;
    mesh.userData = { pointId: pt.id };
    clickableMeshes.push(mesh);
    worldGroup.add(mesh);

    const shortName = pt.type === 'socket' ? `Роз #${pt.id}` : (pt.type === 'switch' ? `Выкл #${pt.id}` : `LED #${pt.id}`);
    const lbl = makeTextSprite(shortName, isSelected ? '#0284c7' : '#1e293b', '#ffffff');
    lbl.position.copy(pos).add(new THREE.Vector3(0, -0.15, 0));
    worldGroup.add(lbl);
  });

  if (state.step === 2) {
    pipes.forEach(pipe => {
      const color = pipe.category === 'main' ? 0x94a3b8 : 0x38bdf8;
      const rad = pipe.category === 'main' ? 0.016 : 0.012;
      drawTubePolyline(pipe.points3D, rad, color, 0.95);
    });
  }

  if (state.step === 3) {
    pipes.forEach(pipe => {
      drawTubePolyline(pipe.points3D, 0.017, 0x64748b, 0.25);
    });

    const colorMap = {
      blue: 0x3b82f6,
      yellow_green: 0xa3e635,
      brown: 0x92400e,
      red: 0xef4444,
      black: 0x18181b
    };

    const colorShift = {
      blue: new THREE.Vector3(-0.008, 0.006, 0.008),
      yellow_green: new THREE.Vector3(0.008, 0.006, 0.008),
      brown: new THREE.Vector3(0, -0.008, 0.010),
      red: new THREE.Vector3(-0.006, -0.006, 0.012),
      black: new THREE.Vector3(0.006, -0.006, 0.012)
    };

    wireRuns.forEach(run => {
      const dimmed = state.selectedPointId !== null && state.selectedPointId !== run.pointId;
      run.colors.forEach(c => {
        const shiftedPts = run.path3D.map(p => p.clone().add(colorShift[c]));
        drawTubePolyline(shiftedPts, dimmed ? 0.003 : 0.0065, colorMap[c], dimmed ? 0.2 : 1.0);
      });
    });
  }
}

// ==================== ИНТЕРФЕЙС 3-Х ШАГОВ ====================
function setStep(step) {
  state.step = step;
  [1, 2, 3].forEach(s => {
    const btn = document.getElementById(`tab-${s}`);
    btn.className = s === step
      ? 'py-2 px-1 rounded bg-amber-500 text-slate-950 font-bold transition'
      : 'py-2 px-1 rounded text-slate-300 hover:bg-slate-700 transition';
  });

  const badges = {
    1: 'Шаг 1: Стены, общие распредкоробки и точки',
    2: 'Шаг 2: Индивидуальная труба под каждую коробку → в общую РК',
    3: 'Шаг 3: Трассировка проводов от начала до конца'
  };
  document.getElementById('scene-badge').innerText = badges[step];
  document.getElementById('wire-legend').classList.toggle('hidden', step !== 3);

  renderUI();
  rebuild3D();
}

function renderUI() {
  const container = document.getElementById('panel-content');
  const { pipes, wireRuns, totals, validJBs, validPoints } = buildRoutingData();

  if (state.step === 1) {
    let wallOptions = '';
    for (let w = 1; w <= state.wallCount; w++) {
      wallOptions += `<option value="${w}">Стена ${w}</option>`;
    }

    const zoneOptions = POS_ZONES.map(z => `<option value="${z.id}">${z.label}</option>`).join('');
    const boxSizeOptions = BOX_SIZES.map(b => `<option value="${b}">${b}</option>`).join('');
    const jbOptions = vali
