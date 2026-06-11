// ============================================================
// AI 数据中心可视化 — 数据层 V2 (2026-06-11)
// 所有数字、文案、玩家信息都在这个文件里，后续更新只改这里。
//
// V2 变更：
//  - 主数据源升级为 Bernstein 2026-06-08《AI Value Chain: How much
//    does a GW of Vera Rubin data center capacity actually cost?》
//    Exhibit 1/5/6：H100 DGXx8 / GB200 NVL72 / VR NVL72 三代对照
//  - GB200 整柜 $3.4M→$4.3M（存储 $85K→$832K，NAND 自 2023/4 低点涨 11.3 倍）
//  - VR NVL72 详细化：$9.1M/柜、$47B/GW（HBM4 按 $53/GB 计入 $1.09M）
//  - 物理结构按 SemiAnalysis《GB200 Hardware Architecture》(2024-07)
//    与 NVIDIA DGX 文档/OCP 规格校准
//  - 园区冷却链路按 SemiAnalysis《Datacenter Anatomy Part 2 Cooling》
//    与 Vertiv 360AI RD#020 校准
// 旧 V1 基准（Bernstein 2025-10-27 GB200 口径）已被覆盖，见 git 历史
//
// 置信度: A=报告表格原文  B=报告正文  C=公开常识/待校准
// ============================================================

export const META = {
  source: 'Bernstein 2026-06-08 (VR/GB200/H100 三代对照) + SemiAnalysis 物理规格',
  asOf: '2026-06-08',
};

// 三代机柜对照表（Bernstein Exhibit 5/6）
export const ARCH_COMPARE = {
  headers: ['', 'H100 DGX×8', 'GB200 NVL72', 'VR NVL72'],
  rows: [
    ['整柜价格 ($M)', '2.0', '4.3', '9.1'],
    ['机柜功率 (kW)', '41', '132', '220'],
    ['每 GW 机柜数', '12,175', '5,929', '3,557'],
    ['DC capex ($B/GW)', '37.0', '40.5', '47.3'],
    ['FP8 算力/柜 (PFLOPS)', '256', '720', '2,520'],
    ['每 $B capex 算力 (EFLOPS)', '84', '106', '189'],
  ],
};

// ------------------------------------------------------------
// 数据中心全景层（园区）：每 GW capex 拆分（GB200 口径，机柜外部分三代通用）
// 机柜外合计 $15B/GW（机电 11.2 + 土地 3.8），来自 Bernstein；
// 细项拆分沿用 2025-10 报告 Exhibit 2（两份报告口径一致）
// ------------------------------------------------------------
export const CAMPUS_TOTAL_BGW = 40.5; // GB200 口径全口径 $B/GW

export const CAMPUS_ZONES = [
  {
    id: 'whitespace',
    name: '机房白区（IT 机柜）',
    perRackK: 4296, bGW: 25.5, pct: 63.0, conf: 'A',
    desc: '放服务器机柜的主机房。GB200 口径下机柜占全口径 capex 的 63%（VR 时代升到 68%）。Vertiv 参考设计里一个 7MW 数据厅是 48 个 130kW 计算柜 + 48 个 14kW 支持柜。点进去看机柜内部拆分。',
    role: '承载全部计算、网络、存储设备',
    players: ['（见机柜内部各部件）'],
    action: 'enterRack',
  },
  {
    id: 'power-distribution',
    name: '配电系统',
    perRackK: 587, bGW: 3.5, pct: 8.6, conf: 'A',
    desc: '电力链路的中段：市电进园区后经变压器降压（5.1%↗占比按 V1 口径）、中低压开关柜、母线槽/电缆分配到每排机柜。链路：市电→变压器→开关柜(MSB)→UPS→母线槽→机柜电源架。',
    role: '电从电网到机柜的"最后一公里"',
    players: ['伊顿', '施耐德', 'Vertiv', 'ABB', '台达', '金盘科技(C)'],
    children: [
      { name: '变压器', perRackK: 306 },
      { name: '中低压开关柜', perRackK: 110 },
      { name: '电缆', perRackK: 93 },
      { name: '母线槽 Busway', perRackK: 50 },
      { name: 'PDU/切换开关等', perRackK: 29 },
    ],
  },
  {
    id: 'backup-power',
    name: '备用电源（UPS + BBU）',
    perRackK: 272, bGW: 1.6, pct: 4.0, conf: 'A',
    desc: '市电断后、柴发启动前的几十秒由 UPS 顶上。UPS 也是非 IT 电力损耗的主要来源之一（电力系统占非 IT 耗电的 15-30%）。Rubin 时代 BBU/超级电容需求大增。',
    role: '断电瞬间的无缝衔接',
    players: ['伊顿', '施耐德', 'Vertiv', '台达'],
    children: [
      { name: 'UPS 硬件', perRackK: 258 },
      { name: '电池备份单元 BBU', perRackK: 14 },
    ],
  },
  {
    id: 'generators',
    name: '柴油/燃气发电机',
    perRackK: 365, bGW: 2.2, pct: 5.4, conf: 'A',
    desc: '长时间停电的冗余电源，经 ATS（自动切换开关）接入配电链路，通常是一排集装箱式机组。注意：电网级燃气轮机（GE Vernova、西门子能源、三菱重工，合计全球产能 70-80%）不在数据中心 capex 口径内，但是当前最大的产业瓶颈。',
    role: '长时间断电的兜底冗余',
    players: ['卡特彼勒', '康明斯', '劳斯莱斯 MTU', '科勒', 'Generac'],
  },
  {
    id: 'thermal',
    name: '热管理（机房级冷却链路）',
    perRackK: 211, bGW: 1.3, pct: 3.2, conf: 'A',
    desc: '完整热链路：芯片冷板→托盘歧管(CDM)→机柜→CDU（液-液换热，单台 >1MW）→设施水管路→冷机(chiller，单台可达 15-20MW)→冷却塔排到大气。冷机是数据中心除 IT 外最耗电的设备（占非 IT 耗电 60-80%）。Vertiv 7MW 参考设计：72% 直达芯片液冷 + 28% 周边风冷。',
    role: '把芯片的热搬到大气里',
    players: ['Vertiv', 'Johnson Controls(C)', '英维克(C)', '申菱环境(C)', '台达', 'Stulz(C)'],
    children: [
      { name: '风冷（CRAH 等）', perRackK: 110 },
      { name: '液冷（CDU/管路）', perRackK: 44 },
      { name: '配套设施', perRackK: 57 },
    ],
  },
  {
    id: 'other-infra',
    name: '其他物理基础设施',
    perRackK: 459, bGW: 2.7, pct: 6.7, conf: 'A',
    desc: '管道/水泵/机器人等杂项、DCIM 软件与传感器、物理安防、消防、KVM、天花板地板、照明等。',
    role: '机房正常运转的各种配套',
    players: ['分散，无集中玩家'],
    children: [
      { name: '管道、泵、机器人等', perRackK: 319 },
      { name: 'DCIM 软件与传感器', perRackK: 55 },
      { name: '安防/消防/其他', perRackK: 85 },
    ],
  },
  {
    id: 'land',
    name: '土地与建筑',
    perRackK: 636, bGW: 3.8, pct: 9.4, conf: 'A',
    desc: '地皮和厂房本身。折旧周期最长（10-25 年），从真实经济成本（TCO）看权重比现金 capex 显示的更低——IT 硬件按 6 年折旧，一个 GW 的年折旧约 $7.9B（VR 口径），是主导性的运营成本。',
    role: '物理载体',
    players: ['开发商/REITs：Equinix、Digital Realty、万国数据(C)'],
  },
];

// ------------------------------------------------------------
// 机柜方案（可切换）
// ------------------------------------------------------------
export const RACK_TYPES = {
  gb200: {
    id: 'gb200',
    name: 'NVIDIA GB200 NVL72',
    short: 'GB200',
    status: 'detailed',
    rackPriceK: 4296, pctOfDC: 63.0, conf: 'A',
    tagline: '72 颗 Blackwell GPU + 36 颗 Grace CPU，单柜 132kW 全液冷，当前部署主力。2026-06 报告把整柜上修到 $4.3M（旧口径 $3.4M）——主因是存储：NAND 价格自 2023 年 4 月低点涨了 11.3 倍，柜内 2.2PB NVMe 从 $85K 变成 $832K。',
    spec: '物理结构（SemiAnalysis/NVIDIA/OCP）：48RU、600×1068×2236mm、承重 1.6 吨级；18 个 1U 计算托盘（每个 2 块 Bianca 板 = 2 Grace + 4 Blackwell）+ 9 个 NVSwitch 托盘（中部）+ 4 个 33kW 电源架（顶 2 底 2 对称）+ 顶部管理 TOR；后部：1200A 48V 直流母排 + 液冷歧管 + 5184 根 NVLink 铜缆背板。',
  },
  rubin: {
    id: 'rubin',
    name: 'NVIDIA Vera Rubin NVL72',
    short: 'VR NVL72',
    status: 'detailed',
    rackPriceK: 9093, pctOfDC: 68.3, conf: 'A',
    tagline: '2026H2 起的下一代：整柜 $9.1M（媒体说的 $8M 用的是过时内存价）。Rubin GPU 单价 $55K×72 = $396 万占近一半；HBM4 按 2027 年 $53/GB 算贡献 $1.09M（涨价是上修的最大驱动）；内存+存储合计 ~$3.2M（占 35%）。算力 2520 PFLOPS = GB200 的 3.5 倍，每美元算力仍在加速。',
    spec: '220kW/柜（GB200 的 1.7 倍），3557 柜/GW，$47B/GW。结构与 NVL72 同族；电源价值量 $150K（GB200 的 3 倍+），800V HVDC 一代预计 2H26 部署；SOCAMM LPDDR5X 54TB（内存容量 +320%）。',
  },
  h100: {
    id: 'h100',
    name: 'H100 DGX ×8（上代对照）',
    short: 'H100',
    status: 'brief',
    rackPriceK: 2026, pctOfDC: null, conf: 'A',
    tagline: '上一代风冷方案：一柜约 8 台 HGX 服务器 64 颗 GPU，41kW 风冷（3D 均热腔+风扇，9-10RU 高的服务器）。对照看演进：单柜价值 $2M→$4.3M→$9.1M，功率 41→132→220kW，算力每 $B capex 84→106→189 EFLOPS——越贵越值。',
    spec: '服务器级参考架构（非机柜级），机柜形态差异较大；风冷是它和 NVL72 的本质区别',
  },
  gb300: {
    id: 'gb300',
    name: 'NVIDIA GB300 NVL72',
    short: 'GB300',
    status: 'brief',
    rackPriceK: null, pctOfDC: null, conf: 'C',
    tagline: 'GB200 升级款（B300 GPU、HBM3e 288GB/颗）。结构与电源规格与 GB200 相近；BBU 渗透率提升使单柜电源价值量到约 $46K。整柜价格待材料校准（介于 GB200 与 VR 之间）。',
    spec: '结构与 GB200 NVL72 基本一致',
  },
  tpu: {
    id: 'tpu',
    name: 'Google TPU 机柜',
    short: 'TPU',
    status: 'framework',
    rackPriceK: null, pctOfDC: null, conf: 'C',
    tagline: '自研 ASIC 路线代表。TPU 由 Google 设计、博通（部分转联发科）做后端，台积电代工；机柜间用 OCS 光交换组网。ASIC 毛利率 ~50%（vs 英伟达 70%+），同样 capex 能买到约 19% 更多算力。具体 BOM 待你给材料。',
    spec: '示意结构：TPU 托盘 + ICI 互联 + OCS 光路交换',
  },
  ascend: {
    id: 'ascend',
    name: '华为昇腾 CloudMatrix 384',
    short: '昇腾',
    status: 'framework',
    rackPriceK: null, pctOfDC: null, conf: 'C',
    tagline: '国产链代表。384 颗昇腾 910C，16 柜组成超节点（12 计算柜 + 4 交换柜），全光互联换规模。公开估算整系统 $8M 级别，待校准。',
    spec: '示意结构：16 柜超节点',
  },
  cpu: {
    id: 'cpu',
    name: '通用 CPU 服务器机柜（对照）',
    short: 'CPU柜',
    status: 'framework',
    rackPriceK: 400, pctOfDC: null, conf: 'C',
    tagline: '传统数据中心机柜：约 20 台 2U 双路 x86，10-15kW 风冷，整柜 $30-50 万 ≈ GB200 柜的 1/10、VR 柜的 1/20。',
    spec: '约 20× 2U 双路服务器 + TOR 交换机',
  },
};

// 各架构整柜 BOM 表（Bernstein 2026-06-08 Exhibit 1，$K/柜）
export const RACK_BOM = {
  gb200: [
    { id: 'cpu', name: 'CPU（含 LPDDR $252K）', perRackK: 345 },
    { id: 'gpu', name: 'GPU（含 HBM $185K）', perRackK: 2297 },
    { id: 'nvlink-domain', name: 'Scale-up 小计（NVSwitch+铜缆+背板）', perRackK: 287 },
    { id: 'network-rack', name: 'Scale-out（SpectrumX+以太网）', perRackK: 341 },
    { id: 'e1s-storage', name: '直连存储 2.2PB NVMe', perRackK: 832 },
    { id: 'manifold', name: '柜内液冷', perRackK: 51 },
    { id: 'rack-frame', name: '机箱 Chassis', perRackK: 100 },
    { id: 'power-shelf', name: '电源（4×33kW 电源架等）', perRackK: 44 },
  ],
  rubin: [
    { id: 'cpu', name: 'Vera CPU（含 LPDDR $802K）', perRackK: 982 },
    { id: 'gpu', name: 'Rubin GPU（含 HBM4 $1,093K）', perRackK: 5053 },
    { id: 'nvswitch-tray', name: 'NVLink 交换托盘', perRackK: 253 },
    { id: 'copper-backplane', name: '铜缆 $238K + 背板等 $380K', perRackK: 618 },
    { id: 'network-rack', name: 'Scale-out（SpectrumX+以太网）', perRackK: 396 },
    { id: 'e1s-storage', name: '直连存储 3.5PB NVMe', perRackK: 1282 },
    { id: 'manifold', name: '柜内液冷', perRackK: 158 },
    { id: 'rack-frame', name: '机箱 + 其他', perRackK: 200 },
    { id: 'power-shelf', name: '电源（800V HVDC 方向）', perRackK: 150 },
  ],
  h100: [
    { id: 'cpu', name: 'CPU（含 DRAM $238K）', perRackK: 271 },
    { id: 'gpu', name: 'H100 GPU（含 HBM $65K）', perRackK: 1519 },
    { id: 'copper-backplane', name: 'Scale-up（柜内 NVLink）', perRackK: 112 },
    { id: 'network-rack', name: 'Scale-out', perRackK: 22 },
    { id: 'e1s-storage', name: '直连存储', perRackK: 102 },
  ],
};

// ------------------------------------------------------------
// 部件库：所有可点击物体的信息
// value 口径（GB200 基准）：perRackK = $K/整柜, bGW = $B/GW, pct = 占 DC capex %
// vrK = VR NVL72 口径的 $K/柜（有意义时填写）
// ------------------------------------------------------------
export const COMPONENTS = {
  // ===== 机柜层 =====
  'compute-tray': {
    name: '计算托盘（Compute Tray）',
    cat: '机柜单元',
    desc: '1U 高的"刀片"，全柜 18 个。每个装 2 块 Bianca 板（每板 1 Grace CPU + 2 Blackwell GPU），单托盘 TDP 6.3kW。托盘约 85% 热量走液冷（Bianca 板上盖冷板），前部 NIC/DPU/管理板仍是风冷（8 个风扇）。前面板：8 个 E1.S 存储位 + OSFP 笼 + 管理口。点击进入托盘内部。',
    role: '算力的物理载体',
    shape: '1U 抽屉式金属托盘；内部两块 Bianca 板上盖液冷冷板，前部是存储位和网络接口',
    value: { perRackK: 2642, bGW: 15.7, pct: 38.7 }, vrK: 6035,
    valueNote: '计算小计（CPU+GPU 含内存与毛利）；VR $6.0M',
    players: ['ODM 组装：鸿海、广达、纬创', '品牌：Dell、HPE、SMCI'],
    conf: 'A',
    action: 'enterTray',
  },
  'nvswitch-tray': {
    name: 'NVSwitch 交换托盘',
    cat: '机柜单元',
    desc: '柜内 9 个（位于机柜中部），每个含 2 颗 28.8Tb/s NVSwitch5 芯片，把 72 颗 GPU 用 NVLink 连成一个"大 GPU"（scale-up）。NVL72 的交换托盘不需要跨柜互联，所以前面板没有光模块笼（NVL36×2 才有）。',
    role: 'GPU 之间的柜内高速互联',
    shape: '1U 托盘，两颗大芯片在中间压着冷板，背面是高密度背板连接器',
    value: { perRackK: 184, bGW: 1.1, pct: 2.7 }, vrK: 253,
    valueNote: '交换托盘合计（芯片+设计+整机毛利）；VR $253K',
    players: ['NVIDIA（芯片与设计）', '代工：台积电'],
    conf: 'A',
    action: 'enterSwitchTray',
  },
  'power-shelf': {
    name: '电源架（Power Shelf）×4',
    cat: '机柜单元',
    desc: 'NVL72 有 4 个电源架，顶部 2 个 + 底部 2 个对称布置。每个 = 6 颗 5.5kW PSU = 33kW，合计 132kW。输入 346-480V 交流（来自机房 power whip），输出 48/50V 直流给母排，单架最大 600A。机柜级集中整流比节点级 PSU 效率高约 2%。VR 时代电源价值量涨到 $150K（3 倍+），800V HVDC 在 2H26 启动——这是确定性最强的增量环节。',
    role: 'AC→DC 整流与柜内供电',
    shape: '1U 金属盒，里面 6 个可热插拔电源模块',
    value: { perRackK: 44, bGW: 0.3, pct: 0.6 }, vrK: 150,
    valueNote: 'VR $150K（+240%）；VRM 主力：MPS、瑞萨、英飞凌',
    players: ['台达', '光宝', 'Vicor', '麦格米特(C)', '欧陆通(C)'],
    conf: 'A',
  },
  'busbar': {
    name: '直流母排（Busbar）',
    cat: '机柜单元',
    desc: '机柜后部垂直贯通的铜排，48V 直流、载流 1200A。4 个电源架把电送上母排，每个托盘背后的盲插连接器从母排取电，托盘内 PDB 再把 48V 降到 12V 给 Bianca 板。集中母排是 NVL72 供电架构的核心（替代每台服务器自带 PSU）。',
    role: '柜内供电主干',
    shape: '机柜背部一根贯通上下的铜质扁排',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '计入电源/机箱项；800V HVDC 时代母排载流与价值量都会显著提升',
    players: ['伊顿', 'Molex(C)', '台达', 'Starline(C)'],
    conf: 'B',
  },
  'manifold': {
    name: '液冷歧管 + 冷板系统',
    cat: '机柜单元',
    desc: '柜内液冷回路：垂直歧管（蓝=进水/红=回水）经快接头（QD）连到每个托盘的分配歧管（CDM），冷却液流过芯片上的冷板把热带走，汇集后送往机房 CDU。Bianca 板 2700W 只有液冷能压住——这是 NVL72 全液冷的根本原因。',
    role: '芯片级散热（柜内段）',
    shape: '机柜后侧两根垂直管 + 每托盘的冷板和软管',
    value: { perRackK: 51, bGW: 0.3, pct: 0.7 }, vrK: 158,
    valueNote: 'VR $158K（+210%）；L2L（液-液）方案比 L2A（液-气 sidecar）经济得多',
    players: ['Vertiv', '台达', '奇鋐(C)', '双鸿(C)', '英维克(C)', 'CoolerMaster(C)'],
    conf: 'A',
  },
  'copper-backplane': {
    name: 'NVLink 铜缆背板',
    cat: '机柜单元',
    desc: '柜子后部的"电缆墙"：精确地说是 5184 根同轴铜缆（72 GPU × 72 对差分线，每根 200Gb/s 单向）把计算托盘和交换托盘全部直连。如果用光模块替代，需要 648 个 1.6T 收发器 ≈ $55 万成本（客户价 $220 万）外加 20kW 功耗——这就是铜赢的原因，也是 DGX H100 NVL256 没出货的原因。',
    role: '柜内 scale-up 互联的物理介质',
    shape: '机柜背面密密麻麻的黑色缆束（cable cartridge）和连接器矩阵',
    value: { perRackK: 225, bGW: 1.3, pct: 3.3 }, vrK: 618,
    valueNote: 'GB200：铜缆 $123K + 背板 $102K（注：报告 scale-up 小计 $287K 与细项加总存在口径差）；VR：$238K + $380K，接近 3 倍',
    players: ['安费诺 Amphenol', '立讯精密(C)', 'TE(C)', '沃尔核材/瑞可达(C)'],
    conf: 'A',
  },
  'e1s-storage': {
    name: '直连存储（E1.S NVMe）',
    cat: '机柜单元',
    desc: 'V2 大变化：每个计算托盘前面板 8 个 E1.S 盘位（15.36TB）+ 1 个 M.2 启动盘，全柜 2.2PB NAND。NAND 价格从 2023 年 4 月低点涨了 11.3 倍，这项从旧口径 $85K 暴涨到 $832K（占 capex 12%）——存储从"忽略不计"变成第三大件。VR 加 ICMS 后 3.5PB、$1.28M。运营商不愿换 HDD：性能下降会加重本就稀缺的内存负担，且 HDD 体积功耗更大。',
    role: '训练数据与 checkpoint 的本地高速存储',
    shape: '托盘前面板一排小竖条盘位；外部冷存储（80% 容量按 GB 计）在独立存储阵列走 HDD',
    value: { perRackK: 832, bGW: 4.9, pct: 12.2 }, vrK: 1282,
    valueNote: 'TLC NAND 按 $0.37/GB（含 30% AI 溢价）；价格波动大，需常更新',
    players: ['NAND：三星、SK海力士、美光、闪迪/Solidigm', '外部阵列 HDD：希捷、西数'],
    conf: 'A',
  },
  'rack-frame': {
    name: '机柜框架与机械件',
    cat: '机柜单元',
    desc: '柜体钢结构、滑轨、托盘底盘等。OCP MGX 规格：48RU，600mm 宽 × 1068mm 深 × 2236mm 高（可加深到 1200mm），承重 1600kg，支持盲插歧管、前部预留互连线缆区。',
    role: '结构件',
    shape: '比标准 19" 柜更深更重的 21" OCP 柜',
    value: { perRackK: 100, bGW: 0.6, pct: 1.5 }, vrK: 100,
    valueNote: 'Chassis 项；机柜其他杂项 VR 另有 ~$100K',
    players: ['鸿海', '广达', '纬创', 'Cheval(C)', '奇鋐(C)'],
    conf: 'A',
  },
  'tor-switch': {
    name: '管理 TOR 交换机',
    cat: '机柜单元',
    desc: '机柜顶部 2 台管理交换机（NVIDIA DGX 文档），走带外管理网（OOB）：BMC 遥测、固件、电源/CDU 监控都在这张网上。全柜有 51-87 颗 BMC 芯片（每计算托盘 2-4 颗 + 交换托盘/电源架各 1 颗）。',
    role: '带外管理网络',
    shape: '柜顶 1U 交换机',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '计入网络杂项；BMC 主要玩家 ASPEED(C)',
    players: ['NVIDIA/第三方以太网交换机', 'BMC：ASPEED(C)'],
    conf: 'B',
  },

  // ===== 机柜旁 =====
  'network-rack': {
    name: '网络机柜（Scale-out）',
    cat: '配套机柜',
    desc: '柜外组网：SpectrumX/InfiniBand 交换机 + 光模块把几千个机柜连成集群。GB200 口径 scale-out $341K/柜（SpectrumX 交换机 $188K + 以太网 fabric $154K）。超大客户最常见的"偏离参考设计"就是把 SpectrumX TOR 换成第三方（博通方案）交换机。双击进入集群网络视图。',
    role: '机柜之间、集群层面的互联',
    shape: '独立机柜装满交换机，前面板全是光模块端口',
    value: { perRackK: 341, bGW: 2.0, pct: 5.0 }, vrK: 396,
    valueNote: '网络合计（scale-up+out）约占机柜成本 13%：8% scale-up + 5% scale-out',
    players: ['交换机：NVIDIA、Arista、思科(C)', '交换芯片：博通', '光模块：中际旭创、新易盛、Coherent(C)'],
    conf: 'A',
    action: 'enterCluster',
  },

  // ===== 托盘层 =====
  'gpu': {
    name: 'GPU（Blackwell B200）',
    cat: '芯片',
    desc: '价值量的绝对核心：GB200 口径 GPU 合计 $2.3M/柜（占 capex 34%）；VR 口径 Rubin GPU $55K/颗 ×72 = $3.96M，仅 GPU 就占整柜近一半。每颗 B200 两个 reticle 极限 die + 8 颗 HBM3e，TSMC 4NP + CoWoS 封装。',
    role: '训练/推理的算力本体',
    shape: '名片大小的基板封装：中间两块大 die、四周 HBM，上面压液冷冷板',
    value: { perRackK: 2297, bGW: 13.6, pct: 33.6 }, vrK: 5053,
    valueNote: 'GB200 ≈$32K/颗（含 HBM 与毛利）；Rubin $55K/颗（双 die 单封装按颗计）',
    players: ['设计：NVIDIA（替代：AMD MI）', '代工：台积电'],
    conf: 'A',
  },
  'hbm': {
    name: 'HBM（高带宽内存）',
    cat: '芯片',
    desc: '堆叠 DRAM，紧贴 GPU die 封装，提供 TB/s 级带宽。GB200 全柜 13.4TB HBM3e（$185K）；VR 全柜 20.7TB HBM4——按 2027 年量产价 $48/GB + 英伟达 ~10% 加价 = $53/GB，贡献 $1.09M/柜，是 VR 整柜上修到 $9.1M 的最大单一驱动。',
    role: 'GPU 的"工作内存"，带宽决定算力发挥',
    shape: 'GPU 大 die 旁边的小方块，8-12 层 DRAM 垂直堆叠',
    value: { perRackK: 185, bGW: 1.1, pct: 2.7 }, vrK: 1093,
    valueNote: 'HBM4 现价 $16.6/GB → 2027E $53/GB（含加价）；价格波动需跟踪',
    players: ['SK海力士（主供）', '美光', '三星'],
    conf: 'A',
  },
  'cpu': {
    name: 'CPU（Grace / Vera）',
    cat: '芯片',
    desc: 'Arm 服务器 CPU，每块 Bianca 板 1 颗（配 2 GPU）。Vera CPU 单价约 $5K。大头其实是它带的内存：GB200 全柜 17TB LPDDR5X（$252K）；VR 暴增到 54TB（+320%），SOCAMM 形态比手机 LPDDR 溢价 30%（$14.85/GB），贡献 $802K。LPDDR 短缺可能反过来限制 VR 出货。',
    role: 'GPU 的管家：喂数据、跑系统、扩展内存',
    shape: '与 GPU 同板的另一颗大芯片，旁边一圈 LPDDR 颗粒',
    value: { perRackK: 345, bGW: 2.0, pct: 5.0 }, vrK: 982,
    valueNote: 'GB200：芯片 $92K + DRAM $252K；VR：$180K + $802K',
    players: ['NVIDIA（Arm 架构）', 'LPDDR：美光、三星、SK海力士'],
    conf: 'A',
  },
  'nic': {
    name: '网卡 NIC（ConnectX-7/8）',
    cat: '芯片/板卡',
    desc: '每托盘 4 张 ConnectX mezzanine 卡（Pegatron 规格：4× CX-7 400G OSFP），负责 scale-out 后端网络。托盘内成本大头是连接 mezz 板的 Mirror 连接器和通到前面板 OSFP 笼的 DensiLink 缆。',
    role: '托盘对外的网络出口',
    shape: '托盘前部小卡 + 前面板 OSFP 笼',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '计入 scale-out 项',
    players: ['NVIDIA（ConnectX）', '博通(C)'],
    conf: 'B',
  },
  'dpu': {
    name: 'DPU（BlueField-3）',
    cat: '芯片/板卡',
    desc: '参考设计每托盘 2 颗 BlueField-3 做前端网络卸载——但 SemiAnalysis 判断多数客户根本不会配 BF-3（或只配 1 颗），自建 Nitro 类方案或纯 NIC 更划算。看到 DPU 收入时注意打折。',
    role: '网络/存储/安全任务的卸载引擎（可选件）',
    shape: '类似网卡的板卡，带 Arm 核大芯片',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '参考设计含、实际部署常砍——价值量计入 scale-out 项',
    players: ['NVIDIA（BlueField）', 'AWS Nitro（自用）(C)'],
    conf: 'B',
  },
  'coldplate': {
    name: '液冷冷板 + 快接头',
    cat: '散热',
    desc: '铜板直压芯片，微通道液体带走热量；快接头（UQD）让托盘可以不漏液地热插拔。一块 Bianca 板 2700W 全靠它。供应链：冷板（奇鋐/双鸿/Boyd）、UQD（Staubli/CPC 等）、CDM 歧管。',
    role: '芯片表面的直接换热器',
    shape: '覆盖芯片的金属板 + 进出水软管 + 盲插快接头',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '计入柜内液冷项（GB200 $51K / VR $158K）',
    players: ['奇鋐', '双鸿', 'Boyd(C)', 'CoolerMaster', 'UQD：Staubli(C)、CPC(C)'],
    conf: 'B',
  },
  'pcb': {
    name: 'Bianca 主板 + 封装基板',
    cat: '板材',
    desc: '托盘核心是 2 块 Bianca 板（1 Grace + 2 Blackwell 直焊），高层数 HDI；GPU 下面还有 ABF 载板。板上 VRM（供电模块）主力是 MPS、瑞萨、英飞凌；PDB（配电板）供应商分散。Bernstein 认为基板含量持续增长，看好 Ibiden 和欣兴。',
    role: '所有芯片的物理连接层',
    shape: '黑色大板子，芯片、VRM、连接器都在上面',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '分散计入 GPU/CPU/机箱项；ABF 载板短缺是 2026 主题之一',
    players: ['载板：欣兴、Ibiden', 'PCB：金像电、沪电(C)', 'VRM：MPS、瑞萨、英飞凌'],
    conf: 'B',
  },
  'mlcc': {
    name: 'MLCC 与被动元件',
    cat: '元件',
    desc: '板上成千上万颗陶瓷电容做瞬时供电缓冲。Bernstein 原话：MLCC 是热门话题但"无法形成高置信度观点"——自上而下很难测算。AI 板卡用量是普通服务器数倍，方向确定、数字待补。',
    role: '供电质量的"毛细血管"',
    shape: '芯片周围密密麻麻的小黑点',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '待补充（两份报告都未单列）',
    players: ['村田', '三星电机', '国巨', '太诱(C)', '风华高科(C)'],
    conf: 'C',
  },
  'osfp': {
    name: '前面板 OSFP 笼 / 光模块',
    cat: '接口',
    desc: '托盘前面板的 OSFP 笼，插 800G/1.6T 光模块连到柜外 leaf 交换机（scale-out）。光模块单价高（1.6T 约 $850 成本价）但只用在柜间——柜内被铜缆替代了。CPO（共封装光学）是下一个形态变化。',
    role: 'scale-out 网络的物理端口',
    shape: '前面板金属笼 + 带拉环的光模块',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '计入 scale-out / 集群层（详见集群网络视图）',
    players: ['中际旭创', '新易盛', 'Coherent', '天孚通信（器件）(C)', 'Fabrinet(C)'],
    conf: 'A',
  },
  'fan': {
    name: '风扇（托盘前段）',
    cat: '散热',
    desc: '托盘 85% 热量走液冷，但前部的 NIC/DPU/管理板/存储仍是风冷，每托盘 8 个风扇。提醒：NVL72 不是 100% 液冷。',
    role: '前段元件的风冷',
    shape: '托盘中段一排小风扇',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '计入机箱项',
    players: ['台达', 'AVC 奇鋐', 'Nidec(C)'],
    conf: 'B',
  },

  // ===== NVSwitch 托盘内部 =====
  'nvswitch-chip': {
    name: 'NVSwitch5 芯片',
    cat: '芯片',
    desc: '每托盘 2 颗 28.8Tb/s NVSwitch5，9 个托盘 18 颗构成全柜 72 GPU 无阻塞全互联。交换芯片毛利率极高（~80%），交换环节在利润池里的分量大于 capex 占比。',
    role: 'NVLink 流量的十字路口',
    shape: '托盘中央两颗大芯片，各自压冷板',
    value: { perRackK: 184, bGW: 1.1, pct: 2.7 }, vrK: 253,
    valueNote: '含芯片+设计+整机毛利',
    players: ['NVIDIA', '代工：台积电', '对照：博通 Tomahawk（以太网路线）'],
    conf: 'A',
  },
  'backplane-connector': {
    name: '背板连接器',
    cat: '接口',
    desc: '托盘背面与铜缆背板对接的高密度连接器。每个交换托盘背后 4 个 144 差分对连接器（576 DP）。安费诺是代表玩家。',
    role: '托盘与背板缆线的对接口',
    shape: '托盘后缘一排金属高密度插座',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '计入铜缆+背板项',
    players: ['安费诺 Amphenol', 'TE(C)', '立讯精密(C)'],
    conf: 'A',
  },

  // ===== 园区层：电力/冷却链路节点 =====
  'cdu': {
    name: 'CDU（冷量分配单元）',
    cat: '冷却链路',
    desc: '液冷的"中转站"：液-液换热器 + 水泵 + 控制，内环接机柜冷板回路，外环接设施水。机房级 CDU 单台容量 >1MW（Vertiv 参考设计用 250kW 柜内 CDU / 1.3MW 列间 CDU 两种形态）。L2L 比 L2A sidecar（70-140kW，靠散热器+风扇）经济得多，新建大规模 AI 机房基本都走 L2L。',
    role: '把柜内冷却液的热量交换到设施水',
    shape: '机柜大小的金属柜（列间式）或柜底模块（柜内式），连着粗水管',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '计入园区热管理项',
    players: ['Vertiv', '台达', 'Boyd(C)', 'Motivair(C)', '英维克(C)'],
    conf: 'B',
  },
  'chiller': {
    name: '冷机（Chiller）',
    cat: '冷却链路',
    desc: '数据中心除 IT 外最耗电的单一设备（冷却占非 IT 耗电的 60-80%，冷机是大头）。压缩制冷循环把设施水降温，水冷离心式单台可达 15-20MW，COP 约 7。液冷允许更高的水温，能降低冷机能耗甚至部分时段"免费冷却"。',
    role: '主动制冷，决定 PUE 的关键',
    shape: '厂房内的大型卧式机组（水冷）或屋顶成排带风扇的机组（风冷）',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '计入园区热管理项',
    players: ['Carrier(C)', 'Trane(C)', 'York/JCI(C)', '美的/格力工业(C)'],
    conf: 'B',
  },
  'cooling-tower': {
    name: '冷却塔',
    cat: '冷却链路',
    desc: '热链路的终点：把冷机冷凝器的热量蒸发/对流排到大气。和水冷冷机配套，耗水量是数据中心环保争议的来源（也有干冷器等省水替代）。',
    role: '热量最终排向大气',
    shape: '园区外侧成排的方塔，顶部大风扇',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '计入园区热管理项',
    players: ['BAC(C)', 'SPX(C)', 'Evapco(C)'],
    conf: 'B',
  },

  // ===== 集群层 =====
  'nvlink-domain': {
    name: 'NVLink 域（柜内 scale-up）',
    cat: '集群网络',
    desc: '一个 NVL72 = 一个 NVLink 域：72 颗 GPU 每颗 900GB/s 互联，全部走柜内铜缆，零光模块。这是"纵向扩展"的边界——域内通信快一个数量级，域间就要走光了。',
    role: '单柜内的超高速互联',
    shape: '柜内 5184 根铜缆 + 18 颗 NVSwitch 芯片',
    value: { perRackK: 409, bGW: 2.4, pct: 6.0 }, vrK: 871,
    valueNote: 'scale-up 合计（交换托盘+铜缆+背板）≈ 机柜成本 8%',
    players: ['NVIDIA', '安费诺', '立讯(C)'],
    conf: 'A',
  },
  'ib-fabric': {
    name: '柜间网络（scale-out fabric）',
    cat: '集群网络',
    desc: '把 N 个机柜连成训练集群：每柜的 ConnectX 网卡经光模块上到 leaf 交换机，再到 spine（胖树拓扑，约每 4 柜配 9 台 leaf）。选择题：英伟达 InfiniBand/SpectrumX（贵）vs 博通方案以太网（便宜）——超大客户最常见的偏离就在这。8 柜 = 1 个 DGX SuperPOD scalable unit。',
    role: '集群层面的"横向扩展"',
    shape: '独立网络机柜 + 柜间成捆的光纤',
    value: { perRackK: 341, bGW: 2.0, pct: 5.0 }, vrK: 396,
    valueNote: 'scale-out ≈ 机柜成本 5%；另有存储网/带外管理网两张独立网络',
    players: ['NVIDIA（IB/SpectrumX）', 'Arista+博通（以太网）', '思科(C)'],
    conf: 'A',
  },
  'cluster-optics': {
    name: '光模块（柜间互联）',
    cat: '集群网络',
    desc: '光模块只出现在柜间（柜内被铜缆消灭了）。800G→1.6T 演进中，1.6T 成本价约 $850/个。一个柜对外的上行需求随 GPU 代际增长，CPO（共封装光学）会改变交换机侧形态——这是光模块厂商最关注的变量。',
    role: '柜间高速信号的电光转换',
    shape: '交换机和托盘前面板上带拉环的小金属块',
    value: { perRackK: null, bGW: null, pct: null },
    valueNote: '计入 scale-out 项；用量与网络拓扑（rail-optimized 与否）强相关',
    players: ['中际旭创', '新易盛', 'Coherent', 'Fabrinet(C)', '天孚通信(C)'],
    conf: 'B',
  },
};
