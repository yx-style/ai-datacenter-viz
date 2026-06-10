// ============================================================
// AI 数据中心可视化 — 场景与交互层
// 三层结构：园区(campus) → 机柜(rack) → 托盘(tray/switchTray)
// 所有数据来自 data.js；这里只负责画和交互
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { META, CAMPUS_ZONES, RACK_TYPES, COMPONENTS, RACK_SUMMARY_GB200 } from './data.js';

// ---------- 基础场景 ----------
const wrap = document.getElementById('canvas-wrap');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
scene.fog = new THREE.Fog(0x0d1117, 60, 160);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
wrap.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
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
};
// 每个可点击对象 clone 材质，避免高亮互相污染
function mat(base) { return base.clone(); }

// ---------- 交互注册 ----------
// pickables: 当前层所有可点击 mesh；mesh.userData = {id, enterable}
let pickables = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null, selected = null;
const pulseSet = new Set(); // 可进入下一层的对象，做呼吸发光

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

// ---------- 层级状态机 ----------
// view: 'campus' | 'rack' | 'tray' | 'switchTray'
let view = 'campus';
let currentRackType = 'gb200';
let levelGroup = new THREE.Group();
scene.add(levelGroup);

const breadcrumbEl = document.getElementById('breadcrumb');
const captionEl = document.getElementById('scene-caption');
function setCaption(html) { captionEl.innerHTML = html || ''; }
const backBtn = document.getElementById('back-btn');
const panel = document.getElementById('panel');
const tooltip = document.getElementById('tooltip');
const switcherEl = document.getElementById('rack-switcher');

const VIEW_PARENT = { rack: 'campus', tray: 'rack', switchTray: 'rack' };
const VIEW_LABEL = {
  campus: '数据中心全景',
  rack: () => RACK_TYPES[currentRackType].name,
  tray: '计算托盘内部',
  switchTray: 'NVSwitch 托盘内部',
};

function clearLevel() {
  scene.remove(levelGroup);
  levelGroup.traverse(c => {
    if (c.isMesh) { c.geometry.dispose(); }
  });
  levelGroup = new THREE.Group();
  scene.add(levelGroup);
  pickables = [];
  pulseSet.clear();
  hovered = null; selected = null;
  hidePanel();
}

function goto(v) {
  view = v;
  clearLevel();
  setCaption('');
  if (v === 'campus') buildCampus();
  else if (v === 'rack') buildRack(currentRackType);
  else if (v === 'tray') buildTray();
  else if (v === 'switchTray') buildSwitchTray();
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
    b.textContent = rt.name.replace('NVIDIA ', '').replace('Google ', '').replace('华为昇腾 ', '昇腾 ').replace('（对照组）', '');
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
function showPanel(html) { panel.innerHTML = html; panel.classList.remove('hidden'); }
function hidePanel() { panel.classList.add('hidden'); }

function panelForComponent(id) {
  const c = COMPONENTS[id];
  if (!c) return;
  const v = c.value || {};
  let html = `<div class="cat">${c.cat}</div><h2>${c.name}</h2>`;
  html += `<div class="value-box">
    <div class="v"><b>${fmtK(v.perRackK)}</b><span>单机柜价值</span></div>
    <div class="v"><b>${v.bGW != null ? '$' + v.bGW + 'B' : '—'}</b><span>每 GW</span></div>
    <div class="v"><b>${v.pct != null ? v.pct + '%' : '—'}</b><span>占 DC capex</span></div>
  </div>`;
  if (c.valueNote) html += `<div class="vnote">${c.valueNote}</div>`;
  html += `<div class="sec">是什么 / 干什么</div><p>${c.desc}</p>`;
  html += `<div class="sec">长什么样</div><p>${c.shape}</p>`;
  html += `<div class="sec">主要玩家</div><div class="players">${c.players.map(p => `<span>${p}</span>`).join('')}</div>`;
  if (c.action === 'enterTray') html += `<div class="enter-hint" onclick="window.__enter('tray')">⊕ 双击托盘 / 点这里 → 进入托盘内部</div>`;
  if (c.action === 'enterSwitchTray') html += `<div class="enter-hint" onclick="window.__enter('switchTray')">⊕ 双击托盘 / 点这里 → 进入交换托盘内部</div>`;
  html += `<div class="conf">数据置信度：${c.conf}（A=报告表格原文 B=报告正文 C=待校准）<br>来源：${META.source}</div>`;
  showPanel(html);
}

function panelForZone(id) {
  const z = CAMPUS_ZONES.find(z => z.id === id);
  if (!z) return;
  let html = `<div class="cat">数据中心 · 园区层</div><h2>${z.name}</h2>`;
  html += `<div class="value-box">
    <div class="v"><b>${fmtK(z.perRackK)}</b><span>折合每机柜</span></div>
    <div class="v"><b>$${z.bGW}B</b><span>每 GW</span></div>
    <div class="v"><b>${z.pct}%</b><span>占 DC capex</span></div>
  </div>`;
  html += `<div class="sec">是什么 / 干什么</div><p>${z.desc}</p>`;
  html += `<div class="sec">角色</div><p>${z.role}</p>`;
  if (z.children) {
    html += `<div class="sec">内部拆分（$K/柜）</div><table>` +
      z.children.map(c => `<tr><td>${c.name}</td><td>${c.perRackK}</td><td>${c.pct}%</td></tr>`).join('') + `</table>`;
  }
  html += `<div class="sec">主要玩家</div><div class="players">${z.players.map(p => `<span>${p}</span>`).join('')}</div>`;
  if (z.action === 'enterRack') html += `<div class="enter-hint" onclick="window.__enter('rack')">⊕ 双击机房 / 点这里 → 进入机柜层</div>`;
  html += `<div class="conf">数据置信度：${z.conf}<br>来源：${META.source}</div>`;
  showPanel(html);
}

// 机柜总览（进入机柜层时默认展示）
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
  if (rt.id === 'gb200' || rt.id === 'gb300') {
    html += `<div class="sec">整柜 BOM 速览（GB200 口径，点行高亮）</div><table>` +
      RACK_SUMMARY_GB200.map(r =>
        `<tr class="clickable" data-comp="${r.id}"><td>${r.name}</td><td>$${r.perRackK}K</td><td>${r.pct}%</td></tr>`
      ).join('') + `</table>`;
  }
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

// 进入下一层的全局入口（面板里的按钮用）
window.__enter = (v) => goto(v);

// ============================================================
// 第 1 层：园区全景
// ============================================================
function buildCampus() {
  camera.position.set(34, 26, 38);
  controls.target.set(0, 2, 0);
  setCaption('数据中心全景 · 全口径 $5.9M/机柜、$35B/GW · 双击机房白区进入机柜层');

  // 地面
  const ground = new THREE.Mesh(new THREE.BoxGeometry(90, 0.5, 64), mat(M.floor));
  ground.position.y = -0.25;
  levelGroup.add(ground);

  // --- 建筑外壳（土地与建筑）---
  const shell = new THREE.Group();
  const shellWall = new THREE.Mesh(new THREE.BoxGeometry(46, 9, 30), mat(M.glass));
  shellWall.position.set(-8, 4.5, 0);
  shell.add(shellWall);
  const shellEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(46, 9, 30)),
    new THREE.LineBasicMaterial({ color: 0x30363d })
  );
  shellEdges.position.copy(shellWall.position);
  shell.add(shellEdges);
  levelGroup.add(shell);
  makePickable(shellWall, 'zone:land');

  // --- 机房白区：建筑内的机柜阵列 ---
  const whitespace = new THREE.Group();
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 10; col++) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(1.4, 4.6, 2.4), mat(M.darkMetal));
      r.position.set(-26 + col * 4.0, 2.3, -10.5 + row * 7);
      whitespace.add(r);
      // 正面指示灯
      const led = new THREE.Mesh(new THREE.BoxGeometry(1.0, 3.8, 0.06), mat(M.blue));
      led.material.emissive = new THREE.Color(0x2563eb);
      led.material.emissiveIntensity = 0.5;
      led.position.set(r.position.x, 2.3, r.position.z + 1.24);
      whitespace.add(led);
    }
  }
  levelGroup.add(whitespace);
  makePickable(whitespace, 'zone:whitespace', true);

  // --- 配电区（建筑旁：变压器 + 开关柜）---
  const power = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const tr = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3, 2.6), mat(M.grayBox));
    tr.position.set(20, 1.5, -10 + i * 5);
    power.add(tr);
    // 散热鳍片
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 2.2), mat(M.metal));
    fin.position.set(21.9, 1.5, -10 + i * 5);
    power.add(fin);
  }
  // 开关柜一排
  for (let i = 0; i < 4; i++) {
    const sg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 1.2), mat(M.metal));
    sg.position.set(25.5, 1.2, -9 + i * 3.4);
    power.add(sg);
  }
  levelGroup.add(power);
  makePickable(power, 'zone:power-distribution');

  // --- 备用电源 UPS 室（建筑内一角，画在建筑边上）---
  const ups = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const u = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 1.4), mat(M.white));
    u.position.set(12.2, 1.3, 9 - i * 2.6);
    ups.add(u);
  }
  levelGroup.add(ups);
  makePickable(ups, 'zone:backup-power');

  // --- 柴发阵列（集装箱式，建筑后侧）---
  const gens = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(6, 2.8, 2.4), mat(M.chipGold));
    g.material.color = new THREE.Color(0x8a6d1a);
    g.position.set(-24 + i * 8, 1.4, 22);
    gens.add(g);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.6), mat(M.darkMetal));
    pipe.position.set(-24 + i * 8 + 2, 3.6, 22);
    gens.add(pipe);
  }
  levelGroup.add(gens);
  makePickable(gens, 'zone:generators');

  // --- 热管理（冷却塔/干冷器，建筑另一侧）---
  const cooling = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2, 3.4), mat(M.metal));
    base.position.set(-30 + i * 6, 1, -24);
    cooling.add(base);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.5, 24), mat(M.darkMetal));
    fan.position.set(-30 + i * 6, 2.3, -24);
    cooling.add(fan);
  }
  levelGroup.add(cooling);
  makePickable(cooling, 'zone:thermal');

  // --- 其他基础设施（水罐+杂项，角落）---
  const other = new THREE.Group();
  const tank1 = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 4, 20), mat(M.white));
  tank1.position.set(24, 2, 12);
  other.add(tank1);
  const tank2 = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3, 20), mat(M.white));
  tank2.position.set(28.5, 1.5, 14);
  other.add(tank2);
  levelGroup.add(other);
  makePickable(other, 'zone:other-infra');

  // 区域文字标签（用 sprite 画 canvas 文字）
  addLabel('机房白区（点击进入机柜）', -8, 10.5, 0);
  addLabel('配电', 23, 5, -4);
  addLabel('UPS', 12.2, 4.5, 6);
  addLabel('柴油/燃气发电机', -8, 5.5, 22);
  addLabel('冷却', -21, 5, -24);
  addLabel('储水/杂项', 26, 6, 13);
}

function addLabel(text, x, y, z, scale = 1) {
  // 按文字实际宽度建画布，避免截断；高分辨率画布避免模糊
  const fontSize = 56;
  const pad = 24;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = `${fontSize}px -apple-system, PingFang SC, sans-serif`;
  const textW = Math.ceil(ctx.measureText(text).width);
  cv.width = textW + pad * 2;
  cv.height = fontSize + pad;
  ctx.font = `${fontSize}px -apple-system, PingFang SC, sans-serif`;
  ctx.fillStyle = 'rgba(230,237,243,.95)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cv.width / 2, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  // 世界尺寸与画布等比，文字不变形
  const worldH = 1.0 * scale;
  sp.scale.set(worldH * cv.width / cv.height, worldH, 1);
  sp.position.set(x, y, z);
  levelGroup.add(sp);
}

// ============================================================
// 第 2 层：机柜
// ============================================================
function buildRack(type) {
  renderSwitcher();
  camera.position.set(4.2, 2.6, 5.2);
  controls.target.set(0, 1.5, 0);

  const ground = new THREE.Mesh(new THREE.BoxGeometry(14, 0.1, 12), mat(M.floor));
  ground.position.y = -0.05;
  levelGroup.add(ground);

  if (type === 'gb200' || type === 'gb300') {
    buildNVL72Rack();
    setCaption('银色 = GB 计算托盘 ×18 · 金色 = NVSwitch 托盘 ×9 · 双击托盘进入内部');
  } else if (type === 'rubin') {
    buildNVL72Rack();
    setCaption('Vera Rubin NVL144（借用 NVL72 结构示意） · 柜内电源价值量 2-3 倍 → Rubin Ultra 7-8 倍 · <span class="warn">⚠ 整柜 BOM 待材料补充</span>');
  } else if (type === 'tpu') {
    buildSchematicRack('TPU 托盘', 0x4285f4, 8);
    setCaption('Google TPU v7 机柜（示意） · <span class="warn">⚠ 框架占位，等材料补 BOM</span>');
  } else if (type === 'ascend') {
    buildSchematicRack('昇腾计算托盘', 0xc94a3d, 8);
    setCaption('华为 CloudMatrix 单计算柜（示意，超节点共 16 柜） · <span class="warn">⚠ 框架占位，等材料补 BOM</span>');
  } else if (type === 'cpu') {
    buildCPURack();
    setCaption('通用 CPU 机柜（对照组）：约 20 台 2U 双路服务器 + TOR 交换机 · 整柜 ~$0.3-0.5M ≈ NVL72 的 1/8');
  }

  showRackOverview();
}

// 标准 NVL72 机柜
function buildNVL72Rack() {
  const W = 1.2, D = 2.4; // 柜宽（含两侧）、柜深（放大比例便于观察）
  // 框架
  const frame = new THREE.Group();
  const frameGeo = [
    [-W/2, 0, -D/2], [W/2, 0, -D/2], [-W/2, 0, D/2], [W/2, 0, D/2],
  ];
  frameGeo.forEach(([x, , z]) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.2, 0.08), mat(M.darkMetal));
    post.position.set(x, 1.6, z);
    frame.add(post);
  });
  const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.07, D), mat(M.darkMetal));
  top.position.y = 3.2;
  frame.add(top);
  const base = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, D), mat(M.darkMetal));
  base.position.y = 0.06;
  frame.add(base);
  levelGroup.add(frame);
  makePickable(frame, 'rack-frame');

  // 托盘布局（从下往上）：电源架2 + 计算9 + 交换9(中间) + 计算9 + 电源架2
  const trayH = 0.082, gap = 0.012;
  let y = 0.22;
  const slots = [];
  for (let i = 0; i < 2; i++) slots.push('power');
  for (let i = 0; i < 9; i++) slots.push('compute');
  for (let i = 0; i < 9; i++) slots.push('switch');
  for (let i = 0; i < 9; i++) slots.push('compute');
  for (let i = 0; i < 2; i++) slots.push('power');

  const computeGroup = new THREE.Group();
  const switchGroup = new THREE.Group();
  const powerGroup = new THREE.Group();

  slots.forEach(kind => {
    let m, g;
    if (kind === 'compute') {
      m = mat(M.metal); g = computeGroup;
    } else if (kind === 'switch') {
      m = mat(M.chipGold); g = switchGroup;
    } else {
      m = mat(M.grayBox); g = powerGroup;
    }
    const tray = new THREE.Mesh(new THREE.BoxGeometry(W - 0.18, trayH, D - 0.3), m);
    tray.position.set(0, y + trayH / 2, 0);
    g.add(tray);
    // 前面板细节：一条深色槽
    const face = new THREE.Mesh(new THREE.BoxGeometry(W - 0.24, trayH * 0.6, 0.02), mat(M.chipDark));
    face.position.set(0, y + trayH / 2, (D - 0.3) / 2 + 0.012);
    g.add(face);
    y += trayH + gap;
  });
  levelGroup.add(computeGroup, switchGroup, powerGroup);
  makePickable(computeGroup, 'compute-tray', true);
  makePickable(switchGroup, 'nvswitch-tray', true);
  makePickable(powerGroup, 'power-shelf');

  // 液冷歧管：柜后两根竖管（蓝进红回）
  const manifold = new THREE.Group();
  const blue = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 3.0), mat(M.blue));
  blue.position.set(-W/2 + 0.13, 1.6, -D/2 + 0.07);
  const red = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 3.0), mat(M.red));
  red.position.set(W/2 - 0.13, 1.6, -D/2 + 0.07);
  manifold.add(blue, red);
  levelGroup.add(manifold);
  makePickable(manifold, 'manifold');

  // 铜缆背板：柜后中部一块铜色密集体
  const backplane = new THREE.Group();
  const bp = new THREE.Mesh(new THREE.BoxGeometry(W - 0.35, 2.6, 0.1), mat(M.copper));
  bp.position.set(0, 1.65, -D/2 + 0.16);
  backplane.add(bp);
  // 几束缆线的视觉暗示
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 2.4), mat(M.copper));
    c.material.color = new THREE.Color(0x8a5a28);
    c.position.set(-0.36 + i * 0.12, 1.65, -D/2 + 0.24);
    backplane.add(c);
  }
  levelGroup.add(backplane);
  makePickable(backplane, 'copper-backplane');

  // 旁边的幽灵柜：网络柜 + 存储柜（半透明示意）
  const netRack = ghostRack(0x58a6ff, 2.6);
  netRack.position.set(2.6, 0, 0);
  levelGroup.add(netRack);
  makePickable(netRack, 'network-rack');
  addLabel('网络机柜(scale-out)', 2.6, 3.5, 0, 0.22);

  const stoRack = ghostRack(0x8b949e, 2.6);
  stoRack.position.set(-2.6, 0, 0);
  levelGroup.add(stoRack);
  makePickable(stoRack, 'storage-tray');
  addLabel('存储机柜', -2.6, 3.5, 0, 0.22);

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

// 示意机柜（TPU / 昇腾：框架占位）
function buildSchematicRack(trayName, color, trayCount) {
  const W = 1.2, D = 2.0;
  const frame = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, 3.2, D),
    new THREE.MeshStandardMaterial({ color: 0x252b33, transparent: true, opacity: 0.35 }));
  body.position.y = 1.7;
  frame.add(body);
  levelGroup.add(frame);

  const trays = new THREE.Group();
  for (let i = 0; i < trayCount; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.18, D - 0.3),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    t.position.set(0, 0.5 + i * 0.34, 0);
    trays.add(t);
  }
  levelGroup.add(trays);
}

// 通用 CPU 机柜（对照组）
function buildCPURack() {
  const W = 1.2, D = 2.0;
  const frame = new THREE.Group();
  [-W/2, W/2].forEach(x => [-D/2, D/2].forEach(z => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.2, 0.07), mat(M.darkMetal));
    post.position.set(x, 1.6, z);
    frame.add(post);
  }));
  levelGroup.add(frame);

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
// 第 3 层：计算托盘内部
// ============================================================
function buildTray() {
  camera.position.set(0.9, 1.5, 1.9);
  controls.target.set(0, 0.25, 0);
  setCaption('GB200 计算托盘 ×18/柜 · 每托盘 2 组超级芯片（各 1 Grace CPU + 2 B200 GPU） · 点击部件看详情');

  const ground = new THREE.Mesh(new THREE.BoxGeometry(6, 0.05, 5), mat(M.floor));
  ground.position.y = -0.03;
  levelGroup.add(ground);

  // 托盘底盘
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 1.8), mat(M.darkMetal));
  chassis.position.y = 0.03;
  levelGroup.add(chassis);
  makePickable(chassis, 'rack-frame');

  // 主板 PCB
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 1.6), mat(M.pcb));
  board.position.y = 0.08;
  levelGroup.add(board);
  makePickable(board, 'pcb');

  // 2 个 GB200 超级芯片模组：每个 = 1 CPU + 2 GPU
  // 布局：左右两个模组
  [-0.62, 0.62].forEach(mx => {
    // CPU（Grace）
    const cpuG = new THREE.Group();
    const cpu = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.3), mat(M.chipDark));
    cpu.position.set(mx, 0.13, -0.45);
    cpuG.add(cpu);
    // LPDDR 颗粒围一圈
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.12), mat(M.green));
      d.position.set(mx - 0.25 + (i % 3) * 0.25, 0.12, -0.45 + (i < 3 ? -0.26 : 0.26));
      cpuG.add(d);
    }
    levelGroup.add(cpuG);
    makePickable(cpuG, 'cpu');

    // 2 颗 GPU
    [0.0, 0.5].forEach(gz => {
      const gpuG = new THREE.Group();
      // GPU 双 die
      const die1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.2), mat(M.chipGold));
      die1.position.set(mx - 0.09, 0.13, gz);
      const die2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.2), mat(M.chipGold));
      die2.position.set(mx + 0.09, 0.13, gz);
      gpuG.add(die1, die2);
      // 基板
      const sub = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.03, 0.42), mat(M.chipDark));
      sub.position.set(mx, 0.105, gz);
      gpuG.add(sub);
      levelGroup.add(gpuG);
      makePickable(gpuG, 'gpu');

      // HBM 8 颗围在 die 两侧
      const hbmG = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.085), mat(M.hbm));
        h1.position.set(mx - 0.215, 0.135, gz - 0.15 + i * 0.1);
        const h2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.085), mat(M.hbm));
        h2.position.set(mx + 0.215, 0.135, gz - 0.15 + i * 0.1);
        hbmG.add(h1, h2);
      }
      levelGroup.add(hbmG);
      makePickable(hbmG, 'hbm');
    });

    // 冷板：盖在每个模组上方（半透明，能看到下面芯片）
    const cp = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 1.25),
      new THREE.MeshStandardMaterial({ color: 0xb87333, transparent: true, opacity: 0.35, metalness: 0.7, roughness: 0.3 }));
    plate.position.set(mx, 0.22, 0.05);
    cp.add(plate);
    // 进出水软管
    const hose1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5), mat(M.blue));
    hose1.rotation.x = Math.PI / 2;
    hose1.position.set(mx - 0.1, 0.24, -0.85);
    const hose2 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5), mat(M.red));
    hose2.rotation.x = Math.PI / 2;
    hose2.position.set(mx + 0.1, 0.24, -0.85);
    cp.add(hose1, hose2);
    levelGroup.add(cp);
    makePickable(cp, 'coldplate');
  });

  // NIC（ConnectX 小卡，前缘）
  const nicG = new THREE.Group();
  [-0.95, -0.75].forEach(x => {
    const nic = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.3), mat(M.green));
    nic.position.set(x, 0.115, 0.6);
    nicG.add(nic);
  });
  levelGroup.add(nicG);
  makePickable(nicG, 'nic');

  // DPU（BlueField，前缘另一侧）
  const dpuG = new THREE.Group();
  const dpu = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.3), mat(M.chipDark));
  dpu.position.set(0.9, 0.12, 0.6);
  dpuG.add(dpu);
  levelGroup.add(dpuG);
  makePickable(dpuG, 'dpu');

  // MLCC：芯片周围撒一片小点
  const mlccG = new THREE.Group();
  const mlccGeo = new THREE.BoxGeometry(0.022, 0.014, 0.014);
  for (let i = 0; i < 160; i++) {
    const m = new THREE.Mesh(mlccGeo, mat(M.chipDark));
    m.material.color = new THREE.Color(0x97700f);
    const ang = Math.random() * Math.PI * 2;
    const r = 0.32 + Math.random() * 0.42;
    const cx = Math.random() < 0.5 ? -0.62 : 0.62;
    m.position.set(cx + Math.cos(ang) * r * 0.7, 0.105, 0.05 + Math.sin(ang) * r * 0.8);
    mlccG.add(m);
  }
  levelGroup.add(mlccG);
  makePickable(mlccG, 'mlcc');

  // 前面板 + OSFP 笼
  const osfpG = new THREE.Group();
  const faceplate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.04), mat(M.darkMetal));
  faceplate.position.set(0, 0.12, 0.92);
  osfpG.add(faceplate);
  for (let i = 0; i < 8; i++) {
    const cage = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.1), mat(M.metal));
    cage.position.set(-0.85 + i * 0.24, 0.12, 0.95);
    osfpG.add(cage);
  }
  levelGroup.add(osfpG);
  makePickable(osfpG, 'osfp');

  // 背板连接器（托盘后缘）
  const bpcG = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.08), mat(M.copper));
    c.position.set(-0.75 + i * 0.3, 0.12, -0.86);
    bpcG.add(c);
  }
  levelGroup.add(bpcG);
  makePickable(bpcG, 'backplane-connector');

  addLabel('前面板 →', 0, 0.45, 1.15, 0.3);
}

// ============================================================
// 第 3b 层：NVSwitch 托盘内部
// ============================================================
function buildSwitchTray() {
  camera.position.set(0.8, 1.4, 1.8);
  controls.target.set(0, 0.2, 0);
  setCaption('NVSwitch 托盘 ×9/柜 · 每托盘 2 颗 NVSwitch 芯片，把 72 颗 GPU 连成一台"大 GPU"');

  const ground = new THREE.Mesh(new THREE.BoxGeometry(6, 0.05, 5), mat(M.floor));
  ground.position.y = -0.03;
  levelGroup.add(ground);

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 1.8), mat(M.darkMetal));
  chassis.position.y = 0.03;
  levelGroup.add(chassis);
  makePickable(chassis, 'rack-frame');

  const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 1.6), mat(M.pcb));
  board.position.y = 0.08;
  levelGroup.add(board);
  makePickable(board, 'pcb');

  // 2 颗 NVSwitch 芯片
  [-0.5, 0.5].forEach(x => {
    const chipG = new THREE.Group();
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.4), mat(M.chipGold));
    chip.position.set(x, 0.14, 0);
    chipG.add(chip);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xb87333, transparent: true, opacity: 0.35, metalness: 0.7 }));
    plate.position.set(x, 0.2, 0);
    chipG.add(plate);
    levelGroup.add(chipG);
    makePickable(chipG, 'nvswitch-chip');
  });

  // 背板连接器：后缘一整排（NVSwitch 托盘的连接器最密集）
  const bpcG = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.1), mat(M.copper));
    c.position.set(-0.95 + i * 0.24, 0.13, -0.85);
    bpcG.add(c);
  }
  levelGroup.add(bpcG);
  makePickable(bpcG, 'backplane-connector');

}

// ============================================================
// 交互：hover / click / 双击进入
// ============================================================
function pick(e) {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, true);
  if (!hits.length) return null;
  // 找到注册过的顶层对象；玻璃外壳(zone:land)是包围体，优先选它内部的东西
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
    const id = hovered.userData.id;
    const info = id.startsWith('zone:')
      ? CAMPUS_ZONES.find(z => z.id === id.slice(5))
      : COMPONENTS[id];
    if (info) {
      const val = id.startsWith('zone:') ? info.perRackK : info.value?.perRackK;
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
  if (!obj) { return; }
  if (selected) setEmissive(selected, 0x000000, 0);
  selected = obj;
  setEmissive(selected, 0x58a6ff, 0.7);
  const id = obj.userData.id;
  if (id.startsWith('zone:')) panelForZone(id.slice(5));
  else panelForComponent(id);
});

renderer.domElement.addEventListener('dblclick', e => {
  const obj = pick(e);
  if (!obj) return;
  const id = obj.userData.id;
  if (id === 'zone:whitespace') goto('rack');
  else if (id === 'compute-tray') goto('tray');
  else if (id === 'nvswitch-tray') goto('switchTray');
});

// ---------- 渲染循环 ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  // 可进入对象呼吸发光
  const t = clock.getElapsedTime();
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
