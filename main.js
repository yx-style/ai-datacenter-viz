// ============================================================
// AI 数据中心可视化 — 场景与交互层 V2
// 四层结构：园区(campus) → 机柜(rack) → 托盘(tray/switchTray)
//          + 集群网络(cluster)
// 机柜/托盘物理布局依据：NVIDIA DGX GB200 文档、OCP MGX 规格、
// SemiAnalysis GB200 Hardware Architecture
// 所有数据来自 data.js；这里只负责画和交互
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { META, ARCH_COMPARE, CAMPUS_ZONES, RACK_TYPES, RACK_BOM, COMPONENTS, SUPPLY_BOTTLENECKS } from './data.js';

// ---------- 基础场景 ----------
const wrap = document.getElementById('canvas-wrap');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
scene.fog = new THREE.Fog(0x0d1117, 60, 160);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
wrap.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.AmbientLight(0xffffff, 0.4));
scene.add(new THREE.HemisphereLight(0x33415c, 0x0a0c10, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(20, 40, 25);
scene.add(key);
const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
fill.position.set(-25, 15, -20);
scene.add(fill);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- 材质库 ----------
const M = {
  floor:   new THREE.MeshStandardMaterial({ color: 0x1a2029, roughness: 0.9 }),
  metal:   new THREE.MeshStandardMaterial({ color: 0x3a424d, roughness: 0.45, metalness: 0.6 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x252b33, roughness: 0.5, metalness: 0.5 }),
  pcb:     new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.6 }),
  chipGold:new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.35, metalness: 0.7 }),
  chipDark:new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.3, metalness: 0.4 }),
  hbm:     new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.4 }),
  copper:  new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.4, metalness: 0.7 }),
  blue:    new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.5 }),
  red:     new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.5 }),
  green:   new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.6 }),
  grayBox: new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.7 }),
  white:   new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.7 }),
  glass:   new THREE.MeshStandardMaterial({ color: 0x58a6ff, roughness: 0.2, transparent: true, opacity: 0.18 }),
  ssd:     new THREE.MeshStandardMaterial({ color: 0x0e7490, roughness: 0.5 }),
};
function mat(base) { return base.clone(); }

// ---------- 交互注册 ----------
let pickables = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null, selected = null;
const pulseSet = new Set();

function makePickable(mesh, id, enterable = false) {
  mesh.userData.id = id;
  mesh.userData.enterable = enterable;
  mesh.traverse?.(c => { if (c.isMesh) { c.userData.id = id; c.userData.enterable = enterable; } });
  pickables.push(mesh);
  if (enterable) pulseSet.add(mesh);
}

function setEmissive(obj, color, intensity) {
  obj.traverse(c => {
    if (c.isMesh && c.material && 'emissive' in c.material) {
      c.material.emissive = new THREE.Color(color);
      c.material.emissiveIntensity = intensity;
    }
  });
}

// ---------- 流动脉冲系统：沿路径移动的发光小球，表达链路方向 ----------
let flows = [];
function addFlow(pts, color, count = 3, speed = 0.35, size = 0.1) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.01);
  const m = new THREE.MeshBasicMaterial({ color });
  const spheres = [];
  for (let i = 0; i < count; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 8), m);
    levelGroup.add(s);
    spheres.push(s);
  }
  flows.push({ curve, spheres, speed, offset: Math.random() });
}

// ---------- 相机平滑过渡 ----------
let camTween = null;
let firstPose = true;
function setPose(pos, tgt) {
  if (firstPose) {
    camera.position.set(...pos);
    controls.target.set(...tgt);
    firstPose = false;
    return;
  }
  camTween = {
    t: 0,
    fp: camera.position.clone(), ft: controls.target.clone(),
    tp: new THREE.Vector3(...pos), tt: new THREE.Vector3(...tgt),
  };
}

// ---------- 图例 ----------
const legendEl = document.getElementById('legend');
function setLegend(items) {
  if (!items || !items.length) { legendEl.style.display = 'none'; return; }
  legendEl.style.display = 'block';
  legendEl.innerHTML = items.map(([c, t]) =>
    `<div class="li"><span class="sw" style="background:${c}"></span>${t}</div>`).join('');
}

// ---------- 层级状态机 ----------
// view: 'campus' | 'rack' | 'tray' | 'switchTray' | 'cluster'
let view = 'campus';
let currentRackType = 'gb200';
let levelGroup = new THREE.Group();
scene.add(levelGroup);

const breadcrumbEl = document.getElementById('breadcrumb');
const captionEl = document.getElementById('scene-caption');
const backBtn = document.getElementById('back-btn');
const panel = document.getElementById('panel');
const tooltip = document.getElementById('tooltip');
const switcherEl = document.getElementById('rack-switcher');

function setCaption(html) { captionEl.innerHTML = html || ''; }

const VIEW_PARENT = { rack: 'campus', tray: 'rack', switchTray: 'rack', cluster: 'rack', optics: 'cluster' };
const VIEW_LABEL = {
  campus: '数据中心全景',
  rack: () => RACK_TYPES[currentRackType].name,
  tray: '计算托盘内部',
  switchTray: 'NVSwitch 托盘内部',
  cluster: '集群网络',
  optics: '光互联技术',
};

function clearLevel() {
  scene.remove(levelGroup);
  levelGroup.traverse(c => { if (c.isMesh) c.geometry.dispose(); });
  levelGroup = new THREE.Group();
  scene.add(levelGroup);
  pickables = [];
  pulseSet.clear();
  flows = [];
  hovered = null; selected = null;
  hidePanel();
  setLegend(null);
}

function goto(v) {
  view = v;
  clearLevel();
  setCaption('');
  if (v === 'campus') buildCampus();
  else if (v === 'rack') buildRack(currentRackType);
  else if (v === 'tray') buildTray();
  else if (v === 'switchTray') buildSwitchTray();
  else if (v === 'cluster') buildCluster();
  else if (v === 'optics') buildOptics();
  renderBreadcrumb();
  backBtn.style.display = v === 'campus' ? 'none' : 'block';
  switcherEl.style.display = (v === 'rack') ? 'flex' : 'none';
}

backBtn.onclick = () => goto(VIEW_PARENT[view] || 'campus');

function renderBreadcrumb() {
  const chain = [];
  let v = view;
  while (v) { chain.unshift(v); v = VIEW_PARENT[v]; }
  breadcrumbEl.innerHTML = '';
  chain.forEach((v, i) => {
    if (i > 0) {
      const s = document.createElement('span');
      s.className = 'sep'; s.textContent = '›';
      breadcrumbEl.appendChild(s);
    }
    const c = document.createElement('span');
    const label = VIEW_LABEL[v];
    c.textContent = typeof label === 'function' ? label() : label;
    c.className = 'crumb' + (v === view ? ' current' : '');
    if (v !== view) c.onclick = () => goto(v);
    breadcrumbEl.appendChild(c);
  });
}

// ---------- 机柜方案切换器 ----------
function renderSwitcher() {
  switcherEl.innerHTML = '';
  Object.values(RACK_TYPES).forEach(rt => {
    const b = document.createElement('button');
    b.textContent = rt.short;
    b.className = rt.id === currentRackType ? 'active' : '';
    b.onclick = () => {
      currentRackType = rt.id;
      goto('rack');
      showRackOverview();
    };
    switcherEl.appendChild(b);
  });
}

// ---------- 信息面板 ----------
function fmtK(k) {
  if (k == null) return '待补充';
  return k >= 1000 ? '$' + (k / 1000).toFixed(2) + 'M' : '$' + k + 'K';
}
function showPanel(html) {
  panel.innerHTML = '<button id="panel-close" aria-label="关闭">✕</button>' + html;
  panel.classList.remove('hidden');
  document.getElementById('panel-close').onclick = () => {
    hidePanel();
    if (selected) { setEmissive(selected, 0x000000, 0); selected = null; }
  };
}
function hidePanel() { panel.classList.add('hidden'); }

function valueBox(perRackK, bGW, pct, vrK) {
  let html = `<div class="value-box">
    <div class="v"><b>${fmtK(perRackK)}</b><span>单机柜 (GB200)</span></div>`;
  if (vrK != null) html += `<div class="v"><b>${fmtK(vrK)}</b><span>单机柜 (VR)</span></div>`;
  html += `<div class="v"><b>${bGW != null ? '$' + bGW + 'B' : '—'}</b><span>每 GW</span></div>
    <div class="v"><b>${pct != null ? pct + '%' : '—'}</b><span>占 DC capex</span></div>
  </div>`;
  return html;
}

function panelForComponent(id) {
  const c = COMPONENTS[id];
  if (!c) return;
  const v = c.value || {};
  let html = `<div class="cat">${c.cat}</div><h2>${c.name}</h2>`;
  html += valueBox(v.perRackK, v.bGW, v.pct, c.vrK);
  if (c.valueNote) html += `<div class="vnote">${c.valueNote}</div>`;
  html += `<div class="sec">是什么 / 干什么</div><p>${c.desc}</p>`;
  html += `<div class="sec">长什么样</div><p>${c.shape}</p>`;
  html += `<div class="sec">主要玩家</div><div class="players">${c.players.map(p => `<span>${p}</span>`).join('')}</div>`;
  if (c.action === 'enterTray') html += `<div class="enter-hint" onclick="window.__enter('tray')">⊕ 进入托盘内部</div>`;
  if (c.action === 'enterSwitchTray') html += `<div class="enter-hint" onclick="window.__enter('switchTray')">⊕ 进入交换托盘内部</div>`;
  if (c.action === 'enterCluster') html += `<div class="enter-hint" onclick="window.__enter('cluster')">⊕ 进入集群网络视图</div>`;
  if (c.action === 'enterOptics') html += `<div class="enter-hint" onclick="window.__enter('optics')">⊕ 进入光互联技术视图</div>`;
  html += `<div class="conf">数据置信度：${c.conf}（A=报告表格原文 B=报告正文 C=待校准）<br>来源：${META.source}</div>`;
  showPanel(html);
}

function panelForZone(id) {
  const z = CAMPUS_ZONES.find(z => z.id === id);
  if (!z) return;
  let html = `<div class="cat">数据中心 · 园区层</div><h2>${z.name}</h2>`;
  if (z.perRackK != null) {
    html += `<div class="value-box">
      <div class="v"><b>${fmtK(z.perRackK)}</b><span>折合每机柜</span></div>
      <div class="v"><b>$${z.bGW}B</b><span>每 GW</span></div>
      <div class="v"><b>${z.pct}%</b><span>占 DC capex</span></div>
    </div>`;
  }
  if (id === 'bottleneck') {
    html += `<div class="sec">2026E 各环节产能上限（GW，需求 21.1）</div><table>` +
      SUPPLY_BOTTLENECKS.ceilings.map(c =>
        `<tr><td>${c.name}</td><td>${c.gw}</td></tr>`).join('') + `</table>`;
  }
  html += `<div class="sec">是什么 / 干什么</div><p>${z.desc}</p>`;
  html += `<div class="sec">角色</div><p>${z.role}</p>`;
  if (z.children) {
    html += `<div class="sec">内部拆分（$K/柜）</div><table>` +
      z.children.map(c => `<tr><td>${c.name}</td><td>${c.perRackK}</td></tr>`).join('') + `</table>`;
  }
  html += `<div class="sec">主要玩家</div><div class="players">${z.players.map(p => `<span>${p}</span>`).join('')}</div>`;
  if (z.action === 'enterRack') html += `<div class="enter-hint" onclick="window.__enter('rack')">⊕ 进入机柜层</div>`;
  html += `<div class="conf">数据置信度：${z.conf}<br>来源：${META.source}</div>`;
  showPanel(html);
}

function showRackOverview() {
  const rt = RACK_TYPES[currentRackType];
  let html = `<div class="cat">机柜方案 · ${rt.status === 'detailed' ? '详细数据' : rt.status === 'brief' ? '简要数据' : '框架占位，待补数据'}</div>`;
  html += `<h2>${rt.name}</h2>`;
  html += `<div class="value-box">
    <div class="v"><b>${fmtK(rt.rackPriceK)}</b><span>整柜价格</span></div>
    <div class="v"><b>${rt.pctOfDC != null ? rt.pctOfDC + '%' : '—'}</b><span>占 DC capex</span></div>
  </div>`;
  html += `<div class="sec">一句话</div><p>${rt.tagline}</p>`;
  html += `<div class="sec">结构</div><p>${rt.spec}</p>`;
  const bom = RACK_BOM[currentRackType];
  if (bom) {
    html += `<div class="sec">整柜 BOM（$K/柜，点行高亮）</div><table>` +
      bom.map(r =>
        `<tr class="clickable" data-comp="${r.id}"><td>${r.name}</td><td>${r.perRackK.toLocaleString()}</td></tr>`
      ).join('') + `</table>`;
  }
  // 三代对照表
  html += `<div class="sec">三代架构对照</div><table>` +
    ARCH_COMPARE.rows.map(row =>
      `<tr><td>${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td><td>${row[3]}</td></tr>`
    ).join('') + `</table>
    <div class="vnote" style="margin-top:4px">列序：${ARCH_COMPARE.headers.slice(1).join(' / ')}</div>`;
  html += `<div class="conf">数据置信度：${rt.conf}<br>来源：${META.source}</div>`;
  showPanel(html);
  panel.querySelectorAll('tr.clickable').forEach(tr => {
    tr.onclick = () => { panelForComponent(tr.dataset.comp); highlightById(tr.dataset.comp); };
  });
}

function highlightById(id) {
  if (selected) setEmissive(selected, 0x000000, 0);
  const target = pickables.find(p => p.userData.id === id);
  if (target) { selected = target; setEmissive(target, 0x58a6ff, 0.7); }
}

window.__enter = (v) => goto(v);

// ---------- 3D 文字标签 ----------
function addLabel(text, x, y, z, scale = 1, opts = {}) {
  const fontSize = 56;
  const pad = 30;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = `${fontSize}px -apple-system, PingFang SC, sans-serif`;
  const textW = Math.ceil(ctx.measureText(text).width);
  cv.width = textW + pad * 2;
  cv.height = fontSize + pad;
  // 半透明圆角底板：复杂背景上保持可读
  if (opts.bg !== false) {
    ctx.fillStyle = 'rgba(13,17,23,.6)';
    ctx.beginPath();
    ctx.roundRect(2, 2, cv.width - 4, cv.height - 4, 18);
    ctx.fill();
  }
  ctx.font = `${fontSize}px -apple-system, PingFang SC, sans-serif`;
  ctx.fillStyle = opts.color || 'rgba(230,237,243,.95)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cv.width / 2, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  const worldH = 1.0 * scale;
  sp.scale.set(worldH * cv.width / cv.height, worldH, 1);
  sp.position.set(x, y, z);
  levelGroup.add(sp);
}

// 人形比例尺（1.75m），unitsPerMeter = 场景中 1 米的世界单位长度
function addHuman(x, z, unitsPerMeter) {
  const h = 1.75 * unitsPerMeter;
  const bodyM = new THREE.MeshStandardMaterial({ color: 0x6e7681, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(h * 0.045, h * 0.56, 4, 10), bodyM);
  body.position.set(x, h * 0.40, z);
  levelGroup.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(h * 0.052, 12, 12), bodyM.clone());
  head.position.set(x, h * 0.83, z);
  levelGroup.add(head);
  addLabel('1.75m', x, h * 1.0, z, 0.1 * unitsPerMeter);
}

// 管道辅助：两点间圆柱
function pipe(p1, p2, radius, material) {
  const v1 = new THREE.Vector3(...p1), v2 = new THREE.Vector3(...p2);
  const len = v1.distanceTo(v2);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 10), material);
  m.position.copy(v1).add(v2).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v2.clone().sub(v1).normalize());
  return m;
}

// ============================================================
// 第 1 层：园区全景（电力链路 + 冷却链路 + 白区）
// 布局：左侧=电力链路（柴发→ATS→变压器→开关柜→UPS→白区）
//       右侧=冷却链路（白区 CDU→冷机→冷却塔）
// ============================================================
function buildCampus() {
  setPose([0, 40, 64], [-3, 0, 3]);
  setCaption('数据中心全景 · GB200 口径 $40.5B/GW（VR $47.3B） · 前=电力链路（8 段）右=冷却链路 · 双击机房白区进入机柜层');
  setLegend([
    ['#2563eb', '计算机柜'], ['#9ca3af', '支持机柜'], ['#b8860b', '电力链路'],
    ['#b91c1c', '热水（回）'], ['#2563eb', '冷水（供）'], ['#0e7490', 'CDU'],
  ]);

  const ground = new THREE.Mesh(new THREE.BoxGeometry(100, 0.5, 70), mat(M.floor));
  ground.position.y = -0.25;
  levelGroup.add(ground);

  // --- 建筑外壳 ---
  const shellGeo = new THREE.BoxGeometry(42, 9, 30);
  const shellWall = new THREE.Mesh(shellGeo, mat(M.glass));
  shellWall.position.set(-4, 4.5, 0);
  levelGroup.add(shellWall);
  const shellEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(shellGeo),
    new THREE.LineBasicMaterial({ color: 0x30363d })
  );
  shellEdges.position.copy(shellWall.position);
  levelGroup.add(shellEdges);
  makePickable(shellWall, 'zone:land');

  // --- 机房白区：计算柜（蓝）+ 支持柜（灰），参考 Vertiv 48+48 ---
  const whitespace = new THREE.Group();
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 9; col++) {
      const isSupport = (col === 4); // 中间一列支持柜
      const r = new THREE.Mesh(new THREE.BoxGeometry(1.4, 4.6, 2.4), mat(isSupport ? M.grayBox : M.darkMetal));
      r.position.set(-20 + col * 4.0, 2.3, -10.5 + row * 7);
      whitespace.add(r);
      if (!isSupport) {
        const led = new THREE.Mesh(new THREE.BoxGeometry(1.0, 3.8, 0.06), mat(M.blue));
        led.material.emissive = new THREE.Color(0x2563eb);
        led.material.emissiveIntensity = 0.5;
        led.position.set(r.position.x, 2.3, r.position.z + 1.24);
        whitespace.add(led);
      }
    }
  }
  levelGroup.add(whitespace);
  makePickable(whitespace, 'zone:whitespace', true);

  // ============ 电力链路：8 段链条（按 SemiAnalysis Datacenter Anatomy Part 1）============
  // 布局从外到内、从远到近，全部摆在白区前侧（z 负方向）形成可视链条
  //   外: substation(HV→MV) → MV switchgear → MV transformer
  //       柴发挂 ATS 旁
  //   内: ATS → LV switchgear → UPS+BBU → STS → 白区
  // 每个节点是一个可点击的小区块，节点之间黄色管线表示电流流向
  const powerChain = new THREE.Group();
  const pl = mat(M.chipGold); pl.color = new THREE.Color(0xb8860b);

  // 链路节点位置（建筑前方一字排开，从左到右流向白区）
  const chainZ = 20;        // 电力链路所在的横排 z 坐标（建筑前方）
  const stations = [
    { id: 'comp:substation',     x: -40, color: 0x6b7280, w: 4.5, h: 3.0, d: 2.6, label: '现场变电站 HV→MV' },
    { id: 'comp:mv-switchgear',  x: -32, color: 0x4b5563, w: 2.5, h: 2.4, d: 1.6, label: '中压开关柜' },
    { id: 'comp:mv-transformer', x: -26, color: 0x6b7280, w: 2.6, h: 2.6, d: 2.0, label: '中压变压器' },
    { id: 'comp:ats',            x: -20, color: 0x6b7280, w: 1.6, h: 2.2, d: 1.4, label: 'ATS' },
    { id: 'comp:lv-switchgear',  x: -14, color: 0x4b5563, w: 2.4, h: 2.2, d: 1.4, label: '低压开关柜' },
    { id: 'comp:ups',            x:  -7, color: 0x9ca3af, w: 2.6, h: 2.4, d: 1.6, label: 'UPS' },
    { id: 'comp:sts',            x:  -1, color: 0x6b7280, w: 1.4, h: 2.0, d: 1.2, label: 'STS' },
  ];

  stations.forEach((s, i) => {
    const node = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(s.w, s.h, s.d),
      new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.6, metalness: 0.3 })
    );
    body.position.set(s.x, s.h / 2 + 0.05, chainZ);
    node.add(body);
    // 顶部小指示灯（黄色，强调"通电中"）
    const led = new THREE.Mesh(
      new THREE.BoxGeometry(s.w * 0.5, 0.06, s.d * 0.3),
      new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.4 })
    );
    led.position.set(s.x, s.h + 0.08, chainZ);
    node.add(led);
    powerChain.add(node);
    makePickable(node, s.id);
    addLabel(s.label, s.x, s.h + 1.0, chainZ, 0.62);
    // 节点之间画黄色连线
    if (i > 0) {
      const prev = stations[i - 1];
      powerChain.add(pipe([prev.x + prev.w / 2, 0.6, chainZ], [s.x - s.w / 2, 0.6, chainZ], 0.12, pl));
    }
  });
  // 链路末端→白区入口（建筑前缘）
  powerChain.add(pipe([-0.3, 0.6, chainZ], [-4, 0.6, 15.3], 0.12, pl));
  levelGroup.add(powerChain);

  // 柴发：挂在 ATS 前方（更靠观众一侧）
  const gens = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.4, 2.2), mat(M.chipGold));
    g.material.color = new THREE.Color(0x8a6d1a);
    g.position.set(-28 + i * 4.2, 1.2, 27);
    gens.add(g);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4), mat(M.darkMetal));
    exhaust.position.set(-28 + i * 4.2 + 1.2, 3.1, 27);
    gens.add(exhaust);
  }
  levelGroup.add(gens);
  makePickable(gens, 'zone:generators');
  addLabel('柴发阵列（N+1 · 2-3MW/台 · 启动 60s）', -21, 4.6, 27, 0.62);
  // 柴发→ATS 的支线
  powerChain.add(pipe([-20, 0.6, 27], [-20, 0.6, chainZ + 0.7], 0.08, pl));

  // BBU 走机柜内（在白区旁加个示意小标签）
  addLabel('BBU 直接进机柜（绕过 UPS）→', -10, 1.2, 16.6, 0.5);

  // 整体 power-distribution 区域加一个大透明罩，让用户能整体点击看汇总
  const pdHullGeo = new THREE.BoxGeometry(44, 0.1, 4);
  const pdHull = new THREE.Mesh(
    pdHullGeo,
    new THREE.MeshStandardMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.05 })
  );
  pdHull.position.set(-21, 0.05, chainZ);
  levelGroup.add(pdHull);
  makePickable(pdHull, 'zone:power-distribution');

  // backup-power 区域罩
  const bpHull = new THREE.Mesh(
    new THREE.BoxGeometry(20, 0.1, 4),
    new THREE.MeshStandardMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.05 })
  );
  bpHull.position.set(-21, 0.05, 27);
  levelGroup.add(bpHull);
  makePickable(bpHull, 'zone:backup-power');

  // ============ 冷却链路（右侧：白区→CDU→冷机→冷却塔）============
  // CDU 排（建筑内右缘）
  const cdus = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 1.6), mat(M.ssd));
    c.position.set(15, 1.2, -8 + i * 5);
    cdus.add(c);
  }
  levelGroup.add(cdus);
  makePickable(cdus, 'comp:cdu');

  // 冷机房（建筑右外侧）
  const chillers = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const ch = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 2.8), mat(M.white));
    ch.position.set(26, 1.3, -6 + i * 7);
    chillers.add(ch);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 4.4, 16), mat(M.grayBox));
    cyl.rotation.z = Math.PI / 2;
    cyl.position.set(26, 2.6, -6 + i * 7);
    chillers.add(cyl);
  }
  levelGroup.add(chillers);
  makePickable(chillers, 'comp:chiller');

  // 冷却塔（最右侧）
  const towers = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 3.4), mat(M.grayBox));
    base.position.set(38, 1.3, -10 + i * 6.5);
    towers.add(base);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.5, 24), mat(M.darkMetal));
    fan.position.set(38, 2.9, -10 + i * 6.5);
    towers.add(fan);
  }
  levelGroup.add(towers);
  makePickable(towers, 'comp:cooling-tower');

  // 冷却链路水管（蓝=供 红=回）
  levelGroup.add(pipe([12, 1.0, 0], [15, 1.0, -2], 0.14, mat(M.blue)));
  levelGroup.add(pipe([15.8, 1.0, -2], [23.5, 1.0, -3], 0.14, mat(M.red)));   // CDU→冷机（热水）
  levelGroup.add(pipe([23.5, 0.7, -3], [15.8, 0.7, -2], 0.14, mat(M.blue)));  // 冷机→CDU（冷水）
  levelGroup.add(pipe([28.5, 1.0, -3], [36, 1.0, -5], 0.14, mat(M.red)));     // 冷机→冷却塔
  levelGroup.add(pipe([36, 0.7, -5], [28.5, 0.7, -3], 0.14, mat(M.blue)));

  // 其他基础设施（储水罐，后侧角落）
  const other = new THREE.Group();
  const tank1 = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 4, 20), mat(M.white));
  tank1.position.set(30, 2, 14);
  other.add(tank1);
  const tank2 = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3, 20), mat(M.white));
  tank2.position.set(34, 1.5, 12);
  other.add(tank2);
  levelGroup.add(other);
  makePickable(other, 'zone:other-infra');

  // 区域标签
  addLabel('机房白区', -4, 10.3, 0, 0.9);
  addLabel('CDU', 15, 4.2, -3, 0.55);
  addLabel('冷机', 26, 4.8, -2.5, 0.55);
  addLabel('冷却塔', 38, 5.2, -3, 0.6);
  addLabel('储水', 32, 5.4, 13, 0.5);
  addLabel('→ 8 段电力链路 →', -21, 0.4, 23.5, 0.8);
  addLabel('→ 冷却链路 →', 26, 0.4, 7, 0.6);

  // ---- 供给瓶颈条形图（园区右前角）：各环节 2026E 产能上限 vs 需求 21.1GW ----
  const btG = new THREE.Group();
  const btX0 = 24, btZ = 24;
  const demandH = 21.1 * 0.32;
  SUPPLY_BOTTLENECKS.ceilings.forEach((c, i) => {
    const h = c.gw * 0.32;
    const tight = c.gw < 15; // 越紧越红
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, h, 1.6),
      new THREE.MeshStandardMaterial({
        color: tight ? 0xb91c1c : (c.gw < 21.1 ? 0xd97706 : 0x16a34a),
        emissive: tight ? 0xb91c1c : 0x000000, emissiveIntensity: tight ? 0.25 : 0,
        roughness: 0.6,
      })
    );
    bar.position.set(btX0 + i * 2.6, h / 2 + 0.05, btZ);
    btG.add(bar);
    addLabel(c.gw + '', btX0 + i * 2.6, h + 0.7, btZ, 0.42);
    addLabel(c.name.replace('/建筑劳动力', '劳动力').replace('电网电力供应', '电网供电'), btX0 + i * 2.6, -0.05, btZ + 1.6, 0.34);
  });
  // 需求线：一根横穿的细红杆
  const demandLine = new THREE.Mesh(
    new THREE.BoxGeometry(SUPPLY_BOTTLENECKS.ceilings.length * 2.6 + 1, 0.06, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 0.6 })
  );
  demandLine.position.set(btX0 + (SUPPLY_BOTTLENECKS.ceilings.length - 1) * 1.3, demandH, btZ);
  btG.add(demandLine);
  addLabel('需求 21.1GW —', btX0 - 2.6, demandH, btZ, 0.4);
  addLabel('⚠ 2026E 供给瓶颈：各环节产能上限 (GW)', btX0 + 6.5, demandH + 2.2, btZ, 0.5);
  levelGroup.add(btG);
  makePickable(btG, 'zone:bottleneck');

  // ---- 流动脉冲：电流（黄）与冷却水（红/蓝）----
  addFlow([[-40, 0.7, 20], [-32, 0.7, 20], [-26, 0.7, 20], [-20, 0.7, 20],
           [-14, 0.7, 20], [-7, 0.7, 20], [-1, 0.7, 20], [-4, 0.7, 15.3]],
          0xfbbf24, 5, 0.07, 0.16);
  addFlow([[-20, 0.7, 27], [-20, 0.7, 20.7]], 0xfbbf24, 1, 0.12, 0.12);
  // 热水：白区→CDU→冷机→冷却塔（红）
  addFlow([[12, 1.0, 0], [15, 1.0, -2], [23.5, 1.0, -3], [28.5, 1.0, -3], [36, 1.0, -5]],
          0xef4444, 3, 0.09, 0.14);
  // 冷水回流（蓝，反向）
  addFlow([[36, 0.7, -5], [28.5, 0.7, -3], [23.5, 0.7, -3], [15.8, 0.7, -2], [12, 0.7, 0]],
          0x3b82f6, 3, 0.09, 0.14);
}

// ============================================================
// 第 2 层：机柜
// ============================================================
function buildRack(type) {
  renderSwitcher();
  setPose([4.2, 2.6, 5.2], [0, 1.5, 0]);

  const ground = new THREE.Mesh(new THREE.BoxGeometry(14, 0.1, 12), mat(M.floor));
  ground.position.y = -0.05;
  levelGroup.add(ground);

  if (type === 'gb200' || type === 'gb300') {
    buildNVL72Rack();
    setCaption('NVL72 真实布局：顶 TOR×2 + 电源架 4 上 4 下（N+N）· 计算托盘 18 · NVSwitch 9 居中 · 抽出的托盘=可双击进入');
    setLegend([
      ['#3a424d', '计算托盘 ×18'], ['#d4a017', 'NVSwitch ×9'], ['#4b5563', '电源架 ×8'],
      ['#166534', '管理 TOR'], ['#b87333', '母排/铜缆'], ['#2563eb', '液冷歧管'],
    ]);
  } else if (type === 'rubin') {
    buildNVL72Rack();
    setCaption('Vera Rubin NVL72（借 NVL72 结构示意） · $9.1M/柜 220kW · 电源/液冷/铜缆价值量均 ~3 倍于 GB200');
    setLegend([
      ['#3a424d', '计算托盘'], ['#d4a017', 'NVSwitch'], ['#4b5563', '电源架'], ['#b87333', '母排/铜缆'],
    ]);
  } else if (type === 'h100') {
    buildH100Rack();
    setCaption('H100 DGX×8（上代对照）：风冷 HGX 服务器堆叠，41kW/柜 $2.0M · 与 NVL72 的本质区别是风冷 vs 液冷');
  } else if (type === 'tpu') {
    buildSchematicRack(0x4285f4, 8);
    setCaption('Google TPU 机柜（示意） · <span class="warn">⚠ 框架占位，等材料补 BOM</span>');
  } else if (type === 'ascend') {
    buildSchematicRack(0xc94a3d, 8);
    setCaption('华为 CloudMatrix 单计算柜（示意，超节点共 16 柜） · <span class="warn">⚠ 框架占位，等材料补 BOM</span>');
  } else if (type === 'cpu') {
    buildCPURack();
    setCaption('通用 CPU 机柜（对照）：20 台 2U 服务器 + TOR · 整柜 ~$0.4M ≈ GB200 的 1/10、VR 的 1/20');
  }

  showRackOverview();
}

// NVL72 机柜（按 NVIDIA DGX 文档/SemiAnalysis 布局）
// 自上而下：TOR×2 → 电源架×4 → 计算×10 → NVSwitch×9 → 计算×8 → 电源架×4
// 共 8 个电源架（N+N 冗余，每个 33kW=6×5.5kW PSU）
function buildNVL72Rack() {
  const W = 1.2, D = 2.4;
  // 框架
  const frame = new THREE.Group();
  [[-W/2, -D/2], [W/2, -D/2], [-W/2, D/2], [W/2, D/2]].forEach(([x, z]) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.6, 0.08), mat(M.darkMetal));
    post.position.set(x, 1.8, z);
    frame.add(post);
  });
  const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.07, D), mat(M.darkMetal));
  top.position.y = 3.6;
  frame.add(top);
  const base = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, D), mat(M.darkMetal));
  base.position.y = 0.06;
  frame.add(base);
  levelGroup.add(frame);
  makePickable(frame, 'rack-frame');

  const trayH = 0.078, gap = 0.011;
  let y = 0.16;
  // 布局序列（从下往上画）
  const slots = [];
  for (let i = 0; i < 4; i++) slots.push('power');
  for (let i = 0; i < 8; i++) slots.push('compute');
  for (let i = 0; i < 9; i++) slots.push('switch');
  for (let i = 0; i < 10; i++) slots.push('compute');
  for (let i = 0; i < 4; i++) slots.push('power');
  slots.push('tor'); slots.push('tor');

  const computeGroup = new THREE.Group();
  const switchGroup = new THREE.Group();
  const powerGroup = new THREE.Group();
  const torGroup = new THREE.Group();
  let computeIdx = 0, switchIdx = 0;

  slots.forEach(kind => {
    let m, g;
    if (kind === 'compute') { m = mat(M.metal); g = computeGroup; }
    else if (kind === 'switch') { m = mat(M.chipGold); g = switchGroup; }
    else if (kind === 'tor') { m = mat(M.green); g = torGroup; }
    else { m = mat(M.grayBox); g = powerGroup; }

    // “主角托盘”：最上面一个计算托盘和中间一个交换托盘向前抽出，体现拆解感
    let zOff = 0;
    if (kind === 'compute') { computeIdx++; if (computeIdx === 18) zOff = 0.42; }
    if (kind === 'switch') { switchIdx++; if (switchIdx === 5) zOff = 0.3; }

    const tray = new THREE.Mesh(new THREE.BoxGeometry(W - 0.18, trayH, D - 0.3), m);
    tray.position.set(0, y + trayH / 2, zOff);
    g.add(tray);
    // 前面板微细节
    const faceZ = (D - 0.3) / 2 + zOff + 0.012;
    if (kind === 'compute') {
      // 左侧 4 个 E1.S 盘位（青色竖条）
      for (let i = 0; i < 4; i++) {
        const ssd = new THREE.Mesh(new THREE.BoxGeometry(0.035, trayH * 0.62, 0.015), mat(M.ssd));
        ssd.position.set(-0.41 + i * 0.06, y + trayH / 2, faceZ);
        g.add(ssd);
      }
      // 中部 4 个 OSFP 笼（深色块）
      for (let i = 0; i < 4; i++) {
        const cage = new THREE.Mesh(new THREE.BoxGeometry(0.07, trayH * 0.5, 0.012), mat(M.chipDark));
        cage.position.set(-0.08 + i * 0.1, y + trayH / 2, faceZ);
        g.add(cage);
      }
      // 右侧指示灯
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.012),
        new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x4ade80, emissiveIntensity: 0.8 }));
      led.position.set(0.44, y + trayH / 2, faceZ);
      g.add(led);
    } else if (kind === 'switch') {
      // 交换托盘前面板：两个把手 + 指示灯（NVL72 柜内交换无光口）
      [-0.35, 0.35].forEach(x => {
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, trayH * 0.4, 0.015), mat(M.darkMetal));
        handle.position.set(x, y + trayH / 2, faceZ);
        g.add(handle);
      });
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.012),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.8 }));
      led.position.set(0.44, y + trayH / 2, faceZ);
      g.add(led);
    } else if (kind === 'power') {
      // 电源架：6 个 PSU 分隔
      for (let i = 0; i < 6; i++) {
        const psu = new THREE.Mesh(new THREE.BoxGeometry(0.135, trayH * 0.62, 0.012), mat(M.metal));
        psu.position.set(-0.39 + i * 0.156, y + trayH / 2, faceZ);
        g.add(psu);
      }
    } else {
      // TOR：一排小端口
      for (let i = 0; i < 10; i++) {
        const port = new THREE.Mesh(new THREE.BoxGeometry(0.045, trayH * 0.4, 0.012), mat(M.chipDark));
        port.position.set(-0.38 + i * 0.085, y + trayH / 2, faceZ);
        g.add(port);
      }
    }
    y += trayH + gap;
  });
  levelGroup.add(computeGroup, switchGroup, powerGroup, torGroup);
  makePickable(computeGroup, 'compute-tray');
  makePickable(switchGroup, 'nvswitch-tray');
  makePickable(powerGroup, 'power-shelf');
  makePickable(torGroup, 'tor-switch');

  // 抽出托盘的指示标签
  addLabel('计算托盘（抽出示意，双击进入）→', 1.85, 3.02, 0.6, 0.26);
  addLabel('NVSwitch 托盘 →', 1.4, 1.55, 0.5, 0.26);

  // 人形比例尺：机柜 2236mm = 3.6 世界单位 → 1m ≈ 1.61（贴机柜左侧站，与柜同深）
  addHuman(-1.55, 0, 1.61);

  // 价值量 X 光条：移到机柜左前方独立空间，避免和存储幽灵柜重叠
  // GB200 口径：GPU+CPU 在计算托盘里 $2.64M、存储 $0.83M、scale-up $0.29M、电源 $44K、液冷 $51K
  const moneyItems = [
    { label: 'GPU+CPU $2.64M', frac: 1.0,  color: 0xd4a017, y: 2.3 },
    { label: '存储 $0.83M',    frac: 0.32, color: 0x0e7490, y: 1.95 },
    { label: 'Scale-up $0.29M', frac: 0.11, color: 0xb87333, y: 1.6 },
    { label: '液冷 $51K',      frac: 0.04, color: 0x2563eb, y: 1.25 },
    { label: '电源 $44K',      frac: 0.035, color: 0x9ca3af, y: 0.9 },
  ];
  const MAXW = 1.5;
  const MB_X = -4.6, MB_Z = 2.0;
  moneyItems.forEach(it => {
    const w = Math.max(MAXW * it.frac, 0.05);
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.12, 0.05),
      new THREE.MeshStandardMaterial({ color: it.color, emissive: it.color, emissiveIntensity: 0.35, roughness: 0.5 })
    );
    bar.position.set(MB_X + w / 2, it.y, MB_Z);
    levelGroup.add(bar);
    addLabel(it.label, MB_X + MAXW + 0.55, it.y, MB_Z, 0.16);
  });
  addLabel('钱都在哪（GB200 BOM）', MB_X + 1.0, 2.75, MB_Z, 0.2);

  // 直流母排：后部中央垂直铜排
  const busbar = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.3, 0.05), mat(M.copper));
  bar.position.set(0, 1.8, -D/2 + 0.10);
  busbar.add(bar);
  levelGroup.add(busbar);
  makePickable(busbar, 'busbar');

  // 液冷歧管：后部两侧垂直管
  const manifold = new THREE.Group();
  const blue = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 3.3), mat(M.blue));
  blue.position.set(-W/2 + 0.13, 1.8, -D/2 + 0.08);
  const red = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 3.3), mat(M.red));
  red.position.set(W/2 - 0.13, 1.8, -D/2 + 0.08);
  manifold.add(blue, red);
  levelGroup.add(manifold);
  makePickable(manifold, 'manifold');

  // 铜缆背板：后部两块缆束区（避开中央母排）
  const backplane = new THREE.Group();
  [-0.28, 0.28].forEach(x => {
    const bp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 2.6, 0.1), mat(M.copper));
    bp.material.color = new THREE.Color(0x8a5a28);
    bp.position.set(x, 1.65, -D/2 + 0.18);
    backplane.add(bp);
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 2.4), mat(M.copper));
      c.position.set(x - 0.1 + i * 0.1, 1.65, -D/2 + 0.26);
      backplane.add(c);
    }
  });
  levelGroup.add(backplane);
  makePickable(backplane, 'copper-backplane');

  // 幽灵柜：网络柜（可进集群层）+ 存储说明柜
  const netRack = ghostRack(0x58a6ff, 2.6);
  netRack.position.set(2.6, 0, 0);
  levelGroup.add(netRack);
  makePickable(netRack, 'network-rack', true);
  addLabel('网络机柜 → 集群', 2.6, 3.4, 0, 0.24);

  const stoRack = ghostRack(0x0e7490, 2.6);
  stoRack.position.set(-2.6, 0, 0);
  levelGroup.add(stoRack);
  makePickable(stoRack, 'e1s-storage');
  addLabel('存储（柜内E1.S+外部阵列）', -2.6, 3.4, 0, 0.24);
}

function ghostRack(color, h) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, h, 1.6),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.16, roughness: 0.5 })
  );
  body.position.y = h / 2 + 0.1;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.0, h, 1.6)),
    new THREE.LineBasicMaterial({ color })
  );
  edges.position.copy(body.position);
  g.add(body, edges);
  for (let i = 0; i < 8; i++) {
    const u = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.12, 1.4),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.3 }));
    u.position.set(0, 0.4 + i * 0.3, 0);
    g.add(u);
  }
  return g;
}

// H100 风冷机柜（对照）：4 台 5RU HGX 服务器 + 大空隙
function buildH100Rack() {
  const W = 1.2, D = 2.0;
  [[-W/2, -D/2], [W/2, -D/2], [-W/2, D/2], [W/2, D/2]].forEach(([x, z]) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.2, 0.07), mat(M.darkMetal));
    post.position.set(x, 1.6, z);
    levelGroup.add(post);
  });
  const servers = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.42, D - 0.3), mat(M.metal));
    s.position.set(0, 0.5 + i * 0.62, 0);
    servers.add(s);
    // 风扇格栅暗示
    for (let f = 0; f < 5; f++) {
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 12), mat(M.darkMetal));
      fan.rotation.x = Math.PI / 2;
      fan.position.set(-0.4 + f * 0.2, 0.5 + i * 0.62, (D - 0.3) / 2 + 0.02);
      servers.add(fan);
    }
  }
  const tor = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.1, D - 0.3), mat(M.green));
  tor.position.set(0, 3.0, 0);
  servers.add(tor);
  levelGroup.add(servers);
  makePickable(servers, 'compute-tray');
}

function buildSchematicRack(color, trayCount) {
  const W = 1.2, D = 2.0;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, 3.2, D),
    new THREE.MeshStandardMaterial({ color: 0x252b33, transparent: true, opacity: 0.35 }));
  body.position.y = 1.7;
  levelGroup.add(body);
  const trays = new THREE.Group();
  for (let i = 0; i < trayCount; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.18, D - 0.3),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    t.position.set(0, 0.5 + i * 0.34, 0);
    trays.add(t);
  }
  levelGroup.add(trays);
}

function buildCPURack() {
  const W = 1.2, D = 2.0;
  [[-W/2, -D/2], [W/2, -D/2], [-W/2, D/2], [W/2, D/2]].forEach(([x, z]) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.2, 0.07), mat(M.darkMetal));
    post.position.set(x, 1.6, z);
    levelGroup.add(post);
  });
  const servers = new THREE.Group();
  for (let i = 0; i < 20; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.11, D - 0.3), mat(M.metal));
    s.position.set(0, 0.3 + i * 0.14, 0);
    servers.add(s);
  }
  const tor = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.1, D - 0.3), mat(M.chipGold));
  tor.position.set(0, 0.3 + 20 * 0.14 + 0.05, 0);
  servers.add(tor);
  levelGroup.add(servers);
}

// ============================================================
// 第 3 层：计算托盘内部（按 SemiAnalysis/Pegatron 规格）
// 2 块 Bianca 板（各 1 Grace + 2 Blackwell）+ 前部 E1.S 存储位 +
// NIC mezz + DPU + 风扇排 + 后部 PDB/母排连接器/背板连接器
// ============================================================
function buildTray() {
  setPose([1.15, 1.75, 2.3], [0, 0.2, 0]);
  setLegend([
    ['#d4a017', 'GPU die'], ['#7c3aed', 'HBM'], ['#1f2937', 'CPU/DPU'], ['#166534', 'NIC/内存'],
    ['#0e7490', 'E1.S 存储'], ['#b87333', '冷板/连接器'],
  ]);
  setCaption('GB200 计算托盘 ×18/柜 · 2 块 Bianca 板（各 1 Grace + 2 B200）· 6.3kW/托盘 · 后段液冷 85% + 前段风冷 15%');

  const ground = new THREE.Mesh(new THREE.BoxGeometry(6, 0.05, 5), mat(M.floor));
  ground.position.y = -0.03;
  levelGroup.add(ground);

  // 托盘底盘（前 z+ 后 z-）
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 1.9), mat(M.darkMetal));
  chassis.position.y = 0.03;
  levelGroup.add(chassis);
  makePickable(chassis, 'rack-frame');

  // ===== 后段（z: -0.9 ~ 0.1）：2 块 Bianca 板（液冷区）=====
  [-0.62, 0.62].forEach(mx => {
    // Bianca 板
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.95), mat(M.pcb));
    board.position.set(mx, 0.08, -0.4);
    levelGroup.add(board);
    makePickable(board, 'pcb');

    // Grace CPU（板后部中央）
    const cpuG = new THREE.Group();
    const cpu = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.28), mat(M.chipDark));
    cpu.position.set(mx, 0.125, -0.7);
    cpuG.add(cpu);
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.1), mat(M.green));
      d.position.set(mx - 0.22 + (i % 3) * 0.22, 0.115, -0.7 + (i < 3 ? -0.2 : 0.2));
      cpuG.add(d);
    }
    levelGroup.add(cpuG);
    makePickable(cpuG, 'cpu');

    // 2 颗 B200 GPU（板前部并排）
    [-0.2, 0.24].forEach(dx => {
      const gpuG = new THREE.Group();
      const sub = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.30), mat(M.chipDark));
      sub.position.set(mx + dx, 0.10, -0.18);
      gpuG.add(sub);
      [-0.06, 0.06].forEach(ddx => {
        const die = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.14), mat(M.chipGold));
        die.position.set(mx + dx + ddx, 0.13, -0.18);
        gpuG.add(die);
      });
      levelGroup.add(gpuG);
      makePickable(gpuG, 'gpu');

      // HBM 围两侧
      const hbmG = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        [-0.145, 0.145].forEach(hx => {
          const h = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.055), mat(M.hbm));
          h.position.set(mx + dx + hx, 0.135, -0.28 + i * 0.07);
          hbmG.add(h);
        });
      }
      levelGroup.add(hbmG);
      makePickable(hbmG, 'hbm');
    });

    // 冷板（覆盖整块 Bianca 板，半透明）
    const cp = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.04, 0.9),
      new THREE.MeshStandardMaterial({ color: 0xb87333, transparent: true, opacity: 0.32, metalness: 0.7, roughness: 0.3 }));
    plate.position.set(mx, 0.21, -0.4);
    cp.add(plate);
    const hose1 = pipe([mx - 0.1, 0.23, -0.85], [mx - 0.1, 0.23, -1.0], 0.025, mat(M.blue));
    const hose2 = pipe([mx + 0.1, 0.23, -0.85], [mx + 0.1, 0.23, -1.0], 0.025, mat(M.red));
    cp.add(hose1, hose2);
    levelGroup.add(cp);
    makePickable(cp, 'coldplate');

    // MLCC 散布
    const mlccG = new THREE.Group();
    const mlccGeo = new THREE.BoxGeometry(0.02, 0.013, 0.013);
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(mlccGeo, mat(M.chipDark));
      m.material.color = new THREE.Color(0x97700f);
      const ang = Math.random() * Math.PI * 2;
      const r = 0.18 + Math.random() * 0.26;
      m.position.set(mx + Math.cos(ang) * r * 0.8, 0.105, -0.4 + Math.sin(ang) * r);
      mlccG.add(m);
    }
    levelGroup.add(mlccG);
    makePickable(mlccG, 'mlcc');
  });

  // ===== 中段：风扇排（液冷/风冷分界）=====
  const fanG = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 14), mat(M.darkMetal));
    f.rotation.x = Math.PI / 2;
    f.position.set(-1.0 + i * 0.29, 0.13, 0.18);
    fanG.add(f);
  }
  levelGroup.add(fanG);
  makePickable(fanG, 'fan');

  // ===== 前段（z: 0.3 ~ 0.95，风冷区）：NIC + DPU + E1.S 存储 + OSFP =====
  // 4 张 ConnectX mezz
  const nicG = new THREE.Group();
  [-0.95, -0.7, 0.7, 0.95].forEach(x => {
    const nic = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.3), mat(M.green));
    nic.position.set(x, 0.11, 0.45);
    nicG.add(nic);
  });
  levelGroup.add(nicG);
  makePickable(nicG, 'nic');

  // 2 颗 BlueField-3
  const dpuG = new THREE.Group();
  [-0.3, 0.3].forEach(x => {
    const dpu = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.28), mat(M.chipDark));
    dpu.position.set(x, 0.115, 0.45);
    dpuG.add(dpu);
  });
  levelGroup.add(dpuG);
  makePickable(dpuG, 'dpu');

  // 8 个 E1.S 存储位（前面板左侧，小竖条）
  const ssdG = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.3), mat(M.ssd));
    s.position.set(-1.05 + i * 0.085, 0.12, 0.78);
    ssdG.add(s);
  }
  levelGroup.add(ssdG);
  makePickable(ssdG, 'e1s-storage');

  // 前面板 + OSFP 笼（右侧）
  const osfpG = new THREE.Group();
  const faceplate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.04), mat(M.darkMetal));
  faceplate.position.set(0, 0.12, 0.97);
  osfpG.add(faceplate);
  for (let i = 0; i < 6; i++) {
    const cage = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.1), mat(M.metal));
    cage.position.set(0.05 + i * 0.19, 0.12, 1.0);
    osfpG.add(cage);
  }
  levelGroup.add(osfpG);
  makePickable(osfpG, 'osfp');

  // 后缘：母排连接器（中央）+ 背板连接器
  const busG = new THREE.Group();
  const busConn = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.07), mat(M.copper));
  busConn.position.set(0, 0.12, -0.92);
  busG.add(busConn);
  levelGroup.add(busG);
  makePickable(busG, 'busbar');

  const bpcG = new THREE.Group();
  [-0.75, -0.45, 0.45, 0.75].forEach(x => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.07), mat(M.copper));
    c.material.color = new THREE.Color(0x8a5a28);
    c.position.set(x, 0.12, -0.92);
    bpcG.add(c);
  });
  levelGroup.add(bpcG);
  makePickable(bpcG, 'backplane-connector');

  // 引线标注：细线 + 小标签，指向关键部件
  const leadM = new THREE.MeshBasicMaterial({ color: 0x8b949e });
  function leader(text, x, y, z, h, s = 0.085) {
    levelGroup.add(pipe([x, y, z], [x, y + h - 0.05, z], 0.003, leadM));
    addLabel(text, x, y + h, z, s);
  }
  leader('B200 GPU ×4', -0.82, 0.16, -0.18, 0.42);
  leader('HBM', -0.42, 0.17, -0.32, 0.25);
  leader('Grace CPU ×2', 0.62, 0.15, -0.7, 0.5);
  leader('冷板（液冷）', 0.95, 0.24, -0.25, 0.32);
  leader('风扇 ×8', -1.0, 0.16, 0.18, 0.34, 0.075);
  leader('ConnectX-7 ×4', -0.7, 0.13, 0.45, 0.5, 0.07);
  leader('BlueField-3 ×2', 0.3, 0.14, 0.45, 0.3, 0.07);
  leader('E1.S 盘位', -1.0, 0.18, 0.78, 0.62, 0.065)
  leader('OSFP 笼', 0.7, 0.16, 0.97, 0.36, 0.06);
  leader('母排取电', 0, 0.17, -0.92, 0.26);
  addLabel('后：Bianca×2 (液冷 85%)', -1.55, 0.32, -0.9, 0.1);
  addLabel('前：网络/存储 (风冷 15%)', -1.35, 0.5, 1.1, 0.07);
}

// ============================================================
// 第 3b 层：NVSwitch 托盘内部
// ============================================================
function buildSwitchTray() {
  setPose([0.9, 1.5, 2.0], [0, 0.2, 0]);
  setCaption('NVSwitch 托盘 ×9/柜 · 每托盘 2 颗 28.8Tb/s NVSwitch5 · NVL72 柜内交换不需要光模块，前面板只有管理口');
  setLegend([
    ['#d4a017', 'NVSwitch5 芯片'], ['#b87333', '冷板/背板连接器'], ['#14532d', 'PCB'], ['#1f2937', 'VRM/被动件'],
  ]);

  const ground = new THREE.Mesh(new THREE.BoxGeometry(6, 0.05, 5), mat(M.floor));
  ground.position.y = -0.03;
  levelGroup.add(ground);

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 1.9), mat(M.darkMetal));
  chassis.position.y = 0.03;
  levelGroup.add(chassis);
  makePickable(chassis, 'rack-frame');

  const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 1.5), mat(M.pcb));
  board.position.set(0, 0.08, -0.1);
  levelGroup.add(board);
  makePickable(board, 'pcb');

  [-0.5, 0.5].forEach(x => {
    const chipG = new THREE.Group();
    const sub = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.5), mat(M.chipDark));
    sub.position.set(x, 0.115, -0.1);
    chipG.add(sub);
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.38), mat(M.chipGold));
    chip.position.set(x, 0.16, -0.1);
    chipG.add(chip);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xb87333, transparent: true, opacity: 0.35, metalness: 0.7 }));
    plate.position.set(x, 0.22, -0.1);
    chipG.add(plate);
    levelGroup.add(chipG);
    makePickable(chipG, 'nvswitch-chip');

    // 芯片两侧 VRM 条 + MLCC 点
    const vrmG = new THREE.Group();
    [-0.38, 0.38].forEach(dx => {
      for (let i = 0; i < 4; i++) {
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.1), mat(M.chipDark));
        v.position.set(x + dx, 0.12, -0.32 + i * 0.15);
        vrmG.add(v);
      }
    });
    levelGroup.add(vrmG);
    makePickable(vrmG, 'mlcc');
  });

  // 后缘 4 个 144DP 背板连接器（贴着托盘后缘）
  const bpcG = new THREE.Group();
  [-0.8, -0.3, 0.3, 0.8].forEach(x => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.12), mat(M.copper));
    c.position.set(x, 0.12, -0.86);
    bpcG.add(c);
  });
  levelGroup.add(bpcG);
  makePickable(bpcG, 'backplane-connector');

  // 前面板：把手 + 管理口 RJ45
  const faceG = new THREE.Group();
  const faceplate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.04), mat(M.darkMetal));
  faceplate.position.set(0, 0.12, 0.87);
  faceG.add(faceplate);
  [-1.0, 1.0].forEach(x => {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.05), mat(M.metal));
    handle.position.set(x, 0.12, 0.9);
    faceG.add(handle);
  });
  const rj = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.04), mat(M.chipDark));
  rj.position.set(0, 0.12, 0.9);
  faceG.add(rj);
  levelGroup.add(faceG);
  makePickable(faceG, 'rack-frame');

  // 引线标注
  const leadM = new THREE.MeshBasicMaterial({ color: 0x8b949e });
  function leader(text, x, y, z, h, s = 0.085) {
    levelGroup.add(pipe([x, y, z], [x, y + h - 0.05, z], 0.003, leadM));
    addLabel(text, x, y + h, z, s);
  }
  leader('NVSwitch5 ×2（各 72 个 NVLink 口）', -0.5, 0.24, -0.1, 0.5);
  leader('冷板（液冷）', 0.5, 0.24, -0.1, 0.32);
  leader('背板连接器 4×144 差分对', -0.3, 0.18, -0.86, 0.6);
  leader('VRM/被动件', 0.88, 0.14, -0.2, 0.28, 0.07);
  leader('管理口（无光模块）', 0, 0.16, 0.9, 0.34, 0.065);
}

// ============================================================
// 第 4 层：集群网络（8 柜 = 1 个 SuperPOD scalable unit）
// ============================================================
function buildCluster() {
  setPose([10, 8, 14], [0, 2, 0]);
  setLegend([
    ['#2563eb', 'NVL72 机柜（柜内铜缆）'], ['#3a424d', 'Leaf 交换机'], ['#4b5563', 'Spine'], ['#d4a017', '光纤/光模块'],
  ]);
  setCaption('集群网络：8× NVL72 = 1 个 DGX SuperPOD 可扩展单元 · 柜内=NVLink 铜缆（蓝光柜体）· 柜间=光纤上行到 leaf/spine');

  const ground = new THREE.Mesh(new THREE.BoxGeometry(30, 0.1, 20), mat(M.floor));
  ground.position.y = -0.05;
  levelGroup.add(ground);

  // 8 个 NVL72 机柜成排
  const rackXs = [];
  const nvDomain = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const x = -8.4 + i * 2.4;
    rackXs.push(x);
    const r = new THREE.Mesh(new THREE.BoxGeometry(1.3, 3.4, 2.0), mat(M.darkMetal));
    r.position.set(x, 1.7, 2.5);
    nvDomain.add(r);
    const led = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.8, 0.05), mat(M.blue));
    led.material.emissive = new THREE.Color(0x2563eb);
    led.material.emissiveIntensity = 0.45;
    led.position.set(x, 1.7, 3.53);
    nvDomain.add(led);
  }
  levelGroup.add(nvDomain);
  makePickable(nvDomain, 'nvlink-domain');

  // leaf 交换机排（中间层）
  const leafG = new THREE.Group();
  const leafXs = [-6, -2, 2, 6];
  leafXs.forEach(x => {
    const sw = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.2), mat(M.metal));
    sw.position.set(x, 4.8, -1.5);
    leafG.add(sw);
  });
  levelGroup.add(leafG);
  makePickable(leafG, 'ib-fabric');

  // spine 交换机排（顶层）
  const spineG = new THREE.Group();
  [-3, 3].forEach(x => {
    const sw = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 1.2), mat(M.grayBox));
    sw.position.set(x, 7.0, -4.5);
    spineG.add(sw);
  });
  levelGroup.add(spineG);
  makePickable(spineG, 'ib-fabric');

  // 光纤连线：每柜→最近2台leaf，leaf→每台spine
  const fiberG = new THREE.Group();
  const fiberMat = new THREE.MeshStandardMaterial({ color: 0xd4a017, emissive: 0xd4a017, emissiveIntensity: 0.3, roughness: 0.5 });
  rackXs.forEach((rx, i) => {
    const targets = [leafXs[Math.floor(i / 2)], leafXs[(Math.floor(i / 2) + 1) % 4]];
    targets.forEach(lx => {
      fiberG.add(pipe([rx, 3.4, 2.0], [lx, 4.6, -1.2], 0.018, fiberMat));
    });
  });
  leafXs.forEach(lx => {
    [-3, 3].forEach(sx => {
      fiberG.add(pipe([lx, 5.05, -1.6], [sx, 6.8, -4.2], 0.018, fiberMat));
    });
  });
  levelGroup.add(fiberG);
  makePickable(fiberG, 'cluster-optics', true);

  // 数据流脉冲：机柜→leaf→spine
  [[rackXs[1], leafXs[0]], [rackXs[4], leafXs[2]], [rackXs[6], leafXs[3]]].forEach(([rx, lx]) => {
    addFlow([[rx, 3.4, 2.0], [lx, 4.6, -1.2], [lx, 5.05, -1.6], [(lx > 0 ? 3 : -3), 6.8, -4.2]],
            0xfbbf24, 2, 0.18, 0.08);
  });

  addLabel('8× NVL72（每柜内部 = NVLink 域，纯铜缆）', 0, 0.4, 4.6, 0.55);
  addLabel('Leaf 交换机', -8.6, 4.8, -1.5, 0.45);
  addLabel('Spine', -6, 7.0, -4.5, 0.45);
  addLabel('金线 = 光纤/光模块（双击看技术路线）', 8.2, 5.8, -2.5, 0.45);
}

// ============================================================
// 第 5 层：光互联技术（可插拔 → LPO → NPO → CPO）
// 四台交换机切面并排，展示光电转换位置不断向 ASIC 前移：
// 电链路 几十cm → 数cm → 毫米，1.6T 端口 30W → 9W
// ============================================================
function buildOptics() {
  setPose([0, 12.5, 15], [0, 0, 0.4]);
  setLegend([
    ['#d4a017', '交换 ASIC / DSP / ELS'], ['#06b6d4', '硅光引擎'], ['#16a34a', 'Driver/TIA'],
    ['#b91c1c', '长电链路（高损耗）'], ['#67e8f9', '光纤'],
  ]);
  setCaption('光互联四条路线 · 看光引擎（青色）的位置：前面板 → 前面板(无DSP) → ASIC 旁 → ASIC 上 · 1.6T 端口功耗 30W → 9W');

  const ground = new THREE.Mesh(new THREE.BoxGeometry(26, 0.1, 16), mat(M.floor));
  ground.position.y = -0.05;
  levelGroup.add(ground);

  // 通用：画一台交换机切面（开盖俯视）
  // 返回 {group, asicPos}，front 在 +z
  const SW_W = 4.2, SW_D = 4.4;
  function switchChassis(cx, schemeId) {
    const g = new THREE.Group();
    // 底板
    const base = new THREE.Mesh(new THREE.BoxGeometry(SW_W, 0.08, SW_D), mat(M.darkMetal));
    base.position.set(cx, 0.04, -1);
    g.add(base);
    // 三面围墙（front 开口朝观众）
    const wallM = mat(M.metal);
    const wallBack = new THREE.Mesh(new THREE.BoxGeometry(SW_W, 0.5, 0.08), wallM);
    wallBack.position.set(cx, 0.33, -1 - SW_D / 2);
    g.add(wallBack);
    [-1, 1].forEach(s => {
      const wallSide = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, SW_D), mat(M.metal));
      wallSide.position.set(cx + s * SW_W / 2, 0.33, -1);
      g.add(wallSide);
    });
    // 前面板（薄板）
    const face = new THREE.Mesh(new THREE.BoxGeometry(SW_W, 0.55, 0.07), mat(M.chipDark));
    face.position.set(cx, 0.33, -1 + SW_D / 2);
    g.add(face);
    levelGroup.add(g);
    makePickable(g, schemeId);
    return { cx, faceZ: -1 + SW_D / 2 };
  }

  // ASIC：交换芯片（金色大方块 + 标签）
  function asic(cx, z) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.16, 1.0), mat(M.chipGold));
    a.material.emissive = new THREE.Color(0xd4a017);
    a.material.emissiveIntensity = 0.25;
    a.position.set(cx, 0.16, z);
    levelGroup.add(a);
    return a;
  }
  // 电链路走线（颜色按长短：长=红 热损耗大，短=绿）
  function trace(cx, z1, z2, color, n = 5) {
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.6 });
    for (let i = 0; i < n; i++) {
      const x = cx - 0.5 + i * (1.0 / (n - 1));
      levelGroup.add(pipe([x, 0.1, z1], [x, 0.1, z2], 0.018, m));
    }
  }

  const ASIC_Z = -2.4;
  const colLong = 0xb91c1c, colMid = 0xd97706, colShort = 0x16a34a;

  // ===== 方案① 可插拔（最左）=====
  {
    const { cx, faceZ } = switchChassis(-7.8, 'optics-pluggable');
    asic(cx, ASIC_Z);
    trace(cx, ASIC_Z + 0.55, faceZ - 0.25, colLong);
    // 前面板 6 个光模块，DSP（金色块）顶置展示
    const dsps = new THREE.Group();
    const mods = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const x = cx - 1.4 + i * 0.56;
      const mod = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.6), mat(M.metal));
      mod.position.set(x, 0.33, faceZ + 0.25);
      mods.add(mod);
      const dsp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.24), mat(M.chipGold));
      dsp.material.emissive = new THREE.Color(0xd4a017);
      dsp.material.emissiveIntensity = 0.3;
      dsp.position.set(x, 0.48, faceZ + 0.25);
      dsps.add(dsp);
    }
    levelGroup.add(mods, dsps);
    makePickable(mods, 'optics-pluggable');
    makePickable(dsps, 'opt-dsp');
    // 电信号脉冲：长链路，慢且红（损耗大）
    addFlow([[cx, 0.14, ASIC_Z + 0.5], [cx, 0.12, faceZ - 0.2]], 0xef4444, 2, 0.25, 0.07);
    addLabel('① 可插拔 (DSP)', cx, 2.6, -1, 0.55);
    addLabel('1.6T口 ~30W · 现在的主力', cx, 2.0, -1, 0.38);
    addLabel('金块=DSP', cx + 1.6, 1.0, faceZ + 0.3, 0.28);
  }

  // ===== 方案② LPO =====
  {
    const { cx, faceZ } = switchChassis(-2.6, 'optics-lpo');
    asic(cx, ASIC_Z);
    trace(cx, ASIC_Z + 0.55, faceZ - 0.25, colMid);
    const mods = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const x = cx - 1.4 + i * 0.56;
      const mod = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.6), mat(M.metal));
      mod.position.set(x, 0.33, faceZ + 0.25);
      mods.add(mod);
      // 只有小小的 Driver/TIA（绿色），没有 DSP
      const drv = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.12), mat(M.green));
      drv.material.emissive = new THREE.Color(0x16a34a);
      drv.material.emissiveIntensity = 0.4;
      drv.position.set(x, 0.46, faceZ + 0.25);
      mods.add(drv);
    }
    levelGroup.add(mods);
    makePickable(mods, 'optics-lpo');
    addFlow([[cx, 0.14, ASIC_Z + 0.5], [cx, 0.12, faceZ - 0.2]], 0xf59e0b, 2, 0.35, 0.06);
    addLabel('② LPO (去 DSP)', cx, 2.6, -1, 0.55);
    addLabel('-30~50% 功耗 · 保住可插拔', cx, 2.0, -1, 0.38);
    addLabel('绿点=Driver/TIA', cx + 1.6, 1.0, faceZ + 0.3, 0.28);
  }

  // ===== 方案③ NPO =====
  {
    const { cx, faceZ } = switchChassis(2.6, 'optics-npo');
    asic(cx, ASIC_Z);
    // 光引擎搬到 ASIC 附近（青色小块，围一圈但有距离）
    const engines = new THREE.Group();
    const engM = new THREE.MeshStandardMaterial({ color: 0x06b6d4, emissive: 0x06b6d4, emissiveIntensity: 0.3, roughness: 0.4 });
    [[-1.0, ASIC_Z], [1.0, ASIC_Z], [-1.0, ASIC_Z + 1.0], [1.0, ASIC_Z + 1.0]].forEach(([dx, z]) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.35), engM.clone());
      e.position.set(cx + dx, 0.14, z);
      engines.add(e);
    });
    levelGroup.add(engines);
    makePickable(engines, 'opt-engine');
    // 短电链路（ASIC→引擎）
    trace(cx, ASIC_Z, ASIC_Z + 0.0, colShort, 0); // 占位不画
    const shortM = new THREE.MeshStandardMaterial({ color: colMid, emissive: colMid, emissiveIntensity: 0.25 });
    [[-1.0], [1.0]].forEach(([dx]) => {
      levelGroup.add(pipe([cx + dx * 0.45, 0.1, ASIC_Z], [cx + dx * 0.82, 0.1, ASIC_Z], 0.02, shortM));
    });
    // 光纤从引擎到前面板（青色细线）
    const fibM = new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x67e8f9, emissiveIntensity: 0.3 });
    [[-1.0, ASIC_Z], [1.0, ASIC_Z], [-1.0, ASIC_Z + 1.0], [1.0, ASIC_Z + 1.0]].forEach(([dx, z]) => {
      levelGroup.add(pipe([cx + dx, 0.16, z + 0.18], [cx + dx * 0.5, 0.16, faceZ], 0.012, fibM.clone()));
    });
    // 前面板光纤口
    const ports = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.06), mat(M.ssd));
      p.position.set(cx - 1.5 + i * 0.43, 0.33, faceZ + 0.06);
      ports.add(p);
    }
    levelGroup.add(ports);
    makePickable(ports, 'opt-mpo');
    // 光信号脉冲（青色，快）：引擎→前面板
    addFlow([[cx - 1.0, 0.18, ASIC_Z + 0.2], [cx - 0.5, 0.18, faceZ]], 0x67e8f9, 2, 0.5, 0.05);
    addLabel('③ NPO (近封装)', cx, 2.6, -1, 0.55);
    addLabel('光引擎搬进机箱 · 过渡方案', cx, 2.0, -1, 0.38);
  }

  // ===== 方案④ CPO（最右）=====
  {
    const { cx, faceZ } = switchChassis(7.8, 'optics-cpo');
    const a = asic(cx, ASIC_Z);
    // 光引擎直接贴着 ASIC：6 组件 ×3 引擎（仿 Quantum-X800）
    const engines = new THREE.Group();
    const engM = new THREE.MeshStandardMaterial({ color: 0x06b6d4, emissive: 0x06b6d4, emissiveIntensity: 0.45, roughness: 0.4 });
    const ring = [
      [-0.62, -0.42], [-0.62, 0], [-0.62, 0.42],
      [0.62, -0.42], [0.62, 0], [0.62, 0.42],
      [-0.42, -0.62], [0, -0.62], [0.42, -0.62],
      [-0.42, 0.62], [0, 0.62], [0.42, 0.62],
    ];
    ring.forEach(([dx, dz]) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.26), engM.clone());
      e.position.set(cx + dx, 0.15, ASIC_Z + dz);
      engines.add(e);
    });
    levelGroup.add(engines);
    makePickable(engines, 'opt-engine');
    // 光纤束：从封装直接到前面板
    const fibM = new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x67e8f9, emissiveIntensity: 0.35 });
    for (let i = 0; i < 5; i++) {
      levelGroup.add(pipe([cx - 0.5 + i * 0.25, 0.18, ASIC_Z + 0.7], [cx - 1.0 + i * 0.5, 0.18, faceZ], 0.012, fibM.clone()));
    }
    // 前面板：MPO 光纤口一排 + ELS 金色激光模块一排
    const ports = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.06), mat(M.ssd));
      p.position.set(cx - 1.5 + i * 0.43, 0.42, faceZ + 0.06);
      ports.add(p);
    }
    levelGroup.add(ports);
    makePickable(ports, 'opt-mpo');
    const elsG = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const els = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.4), mat(M.chipGold));
      els.position.set(cx - 1.0 + i * 0.65, 0.18, faceZ + 0.15);
      elsG.add(els);
    }
    levelGroup.add(elsG);
    makePickable(elsG, 'opt-els');
    // 光信号脉冲：封装直出前面板（最快最轻）
    addFlow([[cx, 0.2, ASIC_Z + 0.7], [cx, 0.18, faceZ]], 0x67e8f9, 3, 0.65, 0.05);
    addLabel('④ CPO (共封装)', cx, 2.6, -1, 0.55);
    addLabel('1.6T口 ~9W (-70%) · 2025H2 起出货', cx, 2.0, -1, 0.38);
    addLabel('金色=ELS 外置激光', cx, 1.4, faceZ + 0.6, 0.3);
  }

  // 底部演进箭头
  addLabel('—— 光电转换位置向 ASIC 前移 · 电链路 几十cm → 毫米 ——→', 0, 0.3, 2.6, 0.55);

  // 功耗对比条：每方案正下方一根竖条，高度 ∝ 1.6T 端口功耗（z 推远避免遮挡演进箭头文字）
  // 可插拔 30W / LPO ~18W(按-40%) / NPO ~14W(估) / CPO 9W
  const powerBars = [
    { x: -7.8, w: 30, label: '30W', color: 0xb91c1c },
    { x: -2.6, w: 18, label: '~18W', color: 0xd97706 },
    { x: 2.6,  w: 14, label: '~14W', color: 0xeab308 },
    { x: 7.8,  w: 9,  label: '9W', color: 0x16a34a },
  ];
  const barH = w => w / 30 * 1.6;
  powerBars.forEach(b => {
    const h = barH(b.w);
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, h, 0.45),
      new THREE.MeshStandardMaterial({ color: b.color, emissive: b.color, emissiveIntensity: 0.3, roughness: 0.5 })
    );
    bar.position.set(b.x, h / 2 + 0.02, 5.2);
    levelGroup.add(bar);
    addLabel(b.label, b.x, h + 0.35, 5.2, 0.38);
  });
  addLabel('1.6T 端口功耗对比（LPO/NPO 为估算）', 0, -0.5, 5.2, 0.4);
}

// ============================================================
// 交互：hover / click / 双击进入
// ============================================================
function resolveInfo(id) {
  if (id.startsWith('zone:')) return CAMPUS_ZONES.find(z => z.id === id.slice(5));
  if (id.startsWith('comp:')) return COMPONENTS[id.slice(5)];
  return COMPONENTS[id];
}

function pick(e) {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, true);
  if (!hits.length) return null;
  let fallback = null;
  for (const h of hits) {
    let obj = h.object;
    while (obj && !pickables.includes(obj)) obj = obj.parent;
    if (!obj) continue;
    if (obj.userData.id === 'zone:land') { fallback = fallback || obj; continue; }
    return obj;
  }
  return fallback;
}

renderer.domElement.addEventListener('pointermove', e => {
  const obj = pick(e);
  if (obj !== hovered) {
    if (hovered && hovered !== selected) setEmissive(hovered, 0x000000, 0);
    hovered = obj;
    if (hovered && hovered !== selected) setEmissive(hovered, 0x58a6ff, 0.35);
    document.body.style.cursor = hovered ? 'pointer' : 'default';
  }
  if (hovered) {
    const info = resolveInfo(hovered.userData.id);
    if (info) {
      const val = info.perRackK != null ? info.perRackK : info.value?.perRackK;
      tooltip.innerHTML = info.name + (val != null ? `<span class="tv">$${val >= 1000 ? (val/1000).toFixed(2) + 'M' : val + 'K'}/柜</span>` : '');
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 14) + 'px';
      tooltip.style.top = (e.clientY + 14) + 'px';
    }
  } else {
    tooltip.style.display = 'none';
  }
});

renderer.domElement.addEventListener('click', e => {
  const obj = pick(e);
  if (!obj) return;
  if (selected) setEmissive(selected, 0x000000, 0);
  selected = obj;
  setEmissive(selected, 0x58a6ff, 0.7);
  const id = obj.userData.id;
  if (id.startsWith('zone:')) panelForZone(id.slice(5));
  else if (id.startsWith('comp:')) panelForComponent(id.slice(5));
  else panelForComponent(id);
});

renderer.domElement.addEventListener('dblclick', e => {
  const obj = pick(e);
  if (!obj) return;
  const id = obj.userData.id;
  if (id === 'zone:whitespace') goto('rack');
  else if (id === 'compute-tray' && (currentRackType === 'gb200' || currentRackType === 'gb300' || currentRackType === 'rubin')) goto('tray');
  else if (id === 'nvswitch-tray') goto('switchTray');
  else if (id === 'network-rack') goto('cluster');
  else if (id === 'cluster-optics') goto('optics');
});

// ---------- 渲染循环 ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();
  // 相机过渡（缓出）
  if (camTween) {
    camTween.t += dt / 1.0;
    const k = camTween.t >= 1 ? 1 : 1 - Math.pow(1 - camTween.t, 3);
    camera.position.lerpVectors(camTween.fp, camTween.tp, k);
    controls.target.lerpVectors(camTween.ft, camTween.tt, k);
    if (camTween.t >= 1) camTween = null;
  }
  controls.update();
  // 链路脉冲
  for (const f of flows) {
    f.spheres.forEach((s, i) => {
      const u = ((t * f.speed) + i / f.spheres.length + f.offset) % 1;
      s.position.copy(f.curve.getPoint(u));
    });
  }
  // 可进入对象呼吸发光
  const glow = 0.12 + Math.sin(t * 2.2) * 0.08;
  pulseSet.forEach(o => {
    if (o !== hovered && o !== selected) setEmissive(o, 0x2563eb, glow);
  });
  renderer.render(scene, camera);
}

// ---------- 启动 ----------
goto('campus');
renderSwitcher();
switcherEl.style.display = 'none';
animate();
