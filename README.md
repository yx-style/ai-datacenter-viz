# AI 数据中心交互式三维拆解

可交互的 AI 数据中心物理构成可视化：园区全景 → 机柜（GB200/GB300/Rubin/TPU/昇腾/CPU 对照） → 托盘内部，每个部件可点击查看价值量、作用、形态与主要玩家。

## 本地运行

```bash
python3 -m http.server 8765
# 访问 http://localhost:8765/index.html
```

## 结构

- `data.js` — 所有数字与文案（更新数据只改这个文件）
- `main.js` — Three.js 场景与交互
- `index.html` — 页面框架
- `lib/` — Three.js 本地依赖
- `build/` — 单文件打包产物（standalone.html）

数据口径：GB200/NVL72，单机柜 BOM 与每 GW capex 双口径，置信度分级 A/B/C。
