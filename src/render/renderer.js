/* ============================================================
 * DSP_RENDERER — Canvas 2D 渲染器 v2（节点方块卡片模型）
 * 契约：SPEC-v2 §2。经典脚本，挂载 globalThis.DSP_RENDERER。
 * 绘制层次：
 *   明亮背景（浅色网格 + 尘埃点）→ 传送带（类型化端口连线 + 负载点）
 *   → 矿脉卡片（物品色亮底 + 采矿机×N + 储量条）→ 建筑卡片（白底 +
 *   图标 + 配方/进度 + 缓存 + ×N 叠加徽章）→ 放置幽灵 → 连线预览。
 * v2 要点：
 *   - 所有文字按世界字号绘制（fontSize×zoom 随缩放同步变化，屏显钳 9–60px）。
 *   - 方块统一 220×220 世界单位圆角卡片；矿脉可选中/拖动，采矿机以 ×N 计数
 *     叠加在矿脉上（不画独立方块）。
 *   - 端口：右缘中点输出（实心）、左缘中点输入（空心），颜色=物品色，
 *     zoom<0.35 隐藏。
 * 附带：指针悬停自跟踪、nodeAt 命中查询、FPS 估算写入 app._fps。
 * ============================================================ */
(function (global) {
  'use strict';

  /* roundRect polyfill：优先本地实现，另为原型补一份（若缺失） */
  function roundRectPath(ctx, x, y, w, h, r) {
    if (w < 2) w = 2;
    if (h < 2) h = 2;
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
  if (typeof CanvasRenderingContext2D !== 'undefined' &&
      !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      roundRectPath(this, x, y, w, h, r);
      return this;
    };
  }

  /* ---------- 明亮画布调色板（v2 需求6） ---------- */
  var COL = {
    bg: '#eef2f8',
    gridMinor: 'rgba(148,166,196,0.16)',
    gridMajor: 'rgba(120,140,175,0.26)',
    gridOrigin: 'rgba(47,124,246,0.30)',
    dust: 'rgba(120,135,160,0.35)',
    cardFill: '#ffffff',
    cardLine: '#d7dfec',
    veinLine: 'rgba(120,135,160,0.45)',
    text: '#243044',
    textMuted: '#77839a',
    select: '#2f7cf6',
    stalled: '#e0524d',
    ok: '#35a35a',
    lowPower: '#e8a13f',
    fullWarn: '#e0b84d',
    hover: 'rgba(47,124,246,0.35)',
    ghostOk: 'rgba(60,180,100,0.30)',
    ghostOkLine: '#35a35a',
    ghostBad: 'rgba(224,82,77,0.30)',
    ghostBadLine: '#e0524d',
    connectOk: '#35a35a',
    connectBad: '#e0524d',
    barBg: 'rgba(90,110,140,0.18)',
    barFill: '#2f7cf6',
    divider: 'rgba(148,166,196,0.35)'
  };
  var BELT_TIERS = { 1: '#9aa7bd', 2: '#4f9be0', 3: '#b06fe0' };

  /* 统一状态 tone 映射（借鉴 DSPONLINE factory-node--status-*）：
     所有建筑/矿脉状态着色（边框、状态点、角标）一律经 toneOf → STATUS_TONE 驱动，
     ok=运行绿 / warn=缺电·投入不足黄 / bad=停滞红。
     取值与 styles/main.css 明亮主题 --status-*-text 三件套对齐（画布恒为浅色底）。 */
  var STATUS_TONE = { ok: '#2e9c4d', warn: '#c08a1a', bad: '#d8433d', off: '#8a93a6' };
  function toneOf(entity, powerRatio) {
    if (entity && entity.stalled) return 'bad';
    if (powerRatio != null && powerRatio < 0.999) return 'warn';
    return 'ok';
  }

  var BLOCK = 220;          // 方块统一边长（世界单位）
  var HALF = BLOCK / 2;
  var PORT_R = 12;          // 端口半径（世界单位，对齐参考 connectionPointScale：点比识别区略小）
  var PORT_HIDE_ZOOM = 0.35;

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : (d || 0); }

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function mixWhite(hex, k) { // 把颜色向白色混合 k（0-1）
    var h = hex.replace('#', '');
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    r = Math.round(r + (255 - r) * k); g = Math.round(g + (255 - g) * k); b = Math.round(b + (255 - b) * k);
    return '#' + [r, g, b].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }
  function fmtQty(n) {
    n = Math.floor(num(n, 0));
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
    if (n >= 1000) return n.toLocaleString('en');
    return String(n);
  }
  function fmtKwShort(kw) {
    return kw >= 1000 ? (kw / 1000).toFixed(kw % 1000 ? 1 : 0) + 'MW' : kw + 'kW';
  }
  function fmtPct(v) { return Math.round(num(v, 0) * 100) + '%'; }

  /* ============================================================ */

  function createRenderer(canvas, app) {
    var ctx = canvas.getContext('2d');
    var cam = null;             // 延迟获取：app.camera 可能晚于 renderer 创建
    var pointer = { inside: false, sx: -9999, sy: -9999, wx: 0, wy: 0 };
    var fpsAcc = 0, fpsN = 0, fpsAt = 0;
    var veinMineRects = {};     // 选中年矿脉的「采集」按钮热区（世界坐标，每帧重建）
    var recipeRowRects = {};    // 建筑卡「配方行」热区（世界坐标，每帧重建，供画布配方下拉命中）
    var ioRowRects = {};        // 建筑卡「输入/输出缓存行」热区（世界坐标，每帧重建，供搬运材料拾取）
    var portHighlight = null;   // 识别中的端口高亮 {kind,id,port}（连线/投放拖拽时由输入层设置）

    function onPointerMove(e) {
      var r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
      pointer.inside = true;
      pointer.sx = num(e.clientX, 0) - r.left;
      pointer.sy = num(e.clientY, 0) - r.top;
    }
    function onPointerLeave() { pointer.inside = false; pointer.sx = -9999; pointer.sy = -9999; }
    canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('pointerleave', onPointerLeave, { passive: true });

    function ensureSize() {
      var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      var cssW = canvas.clientWidth || canvas.width;
      var cssH = canvas.clientHeight || canvas.height;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      return { w: cssW, h: cssH, dpr: dpr };
    }
    function getCam() {
      if (!cam) cam = (app && app.camera) || null;
      return cam;
    }
    // 世界字号：随 zoom 缩放；屏显像素钳在 [5,60]。
    // 下限必须足够小：若下限过大，zoom<1 时字号被强制放大而卡片/行距不变，
    // 文字相对卡片会越缩越大并溢出重叠。
    function fs(baseWorldPx) {
      var c = getCam();
      var z = c ? num(c.zoom, 1) : 1;
      var screen = baseWorldPx * z;
      if (screen < 5) screen = 5;
      if (screen > 60) screen = 60;
      // 限制逻辑字体上限：低缩放时逻辑字体不能膨胀到超过卡片高度的 22%，
      // 否则多行文本在 220×220 卡片内会重叠
      var maxLogical = BLOCK * 0.22;
      return Math.min(screen / z, maxLogical);
    }
    function lineWidthWorld(base) {
      var c = getCam();
      var z = c ? num(c.zoom, 1) : 1;
      return Math.max(base, Math.min(base * z, 3 * base) / Math.max(z, 0.0001));
    }
    function content() { return (app && app.content) || {}; }
    function itemColor(itemId, dflt) {
      var it = content().ITEMS || {};
      return (it[itemId] && it[itemId].color) || dflt || '#8a9bb5';
    }
    function itemName(itemId) {
      var it = content().ITEMS || {};
      return (it[itemId] && it[itemId].name) || itemId;
    }
    function bdef(typeId) { return (content().BUILDINGS || {})[typeId] || null; }
    function shortName(typeId) {
      var d = bdef(typeId);
      return d ? (d.shortName || d.name) : typeId;
    }

    /* ---------- 命中/几何 ---------- */
    function nodeAt(state, wx, wy) {
      var d2 = HALF * HALF;
      var keys = Object.keys(state.veins || {});
      for (var i = keys.length - 1; i >= 0; i--) {
        var v = state.veins[keys[i]];
        var dx = v.x - wx, dy = v.y - wy;
        if (dx * dx + dy * dy <= d2) return { kind: 'vein', id: keys[i] };
      }
      var bks = Object.keys(state.buildings || {});
      for (i = bks.length - 1; i >= 0; i--) {
        var b = state.buildings[bks[i]];
        dx = b.x - wx; dy = b.y - wy;
        if (dx * dx + dy * dy <= d2) return { kind: 'building', id: bks[i] };
      }
      return null;
    }
    function snap(v) { return Math.round(v / 15) * 15; }
    function placementValid(state, typeId, x, y) {
      var def = bdef(typeId);
      if (!def) return false;
      var E = global.DSP_ENGINE || {};
      if (def.kind === 'miner') {
        // 矿机：附近须有矿脉，且该设备能采这种资源（判定与引擎 placeBuilding 保持一致，取最近的一条）
        var veins = state.veins || {};
        var ks = Object.keys(veins);
        var best = null, bestD = Infinity;
        for (var i = 0; i < ks.length; i++) {
          var v = veins[ks[i]];
          var dx = v.x - x, dy = v.y - y;
          var d2 = dx * dx + dy * dy;
          if (d2 <= BLOCK * BLOCK && d2 < bestD) { bestD = d2; best = v; }
        }
        if (!best) return false;
        if (E.minerAcceptsItem && !E.minerAcceptsItem(content(), def, best.itemId)) return false;
        return true;
      }
      if (E.occupiedBy) return !E.occupiedBy(state, content(), x, y, null);
      // 兜底：重叠检查
      var ks2 = Object.keys(state.buildings || {});
      for (i = 0; i < ks2.length; i++) {
        var b = state.buildings[ks2[i]];
        var ddx = b.x - x, ddy = b.y - y;
        if (ddx * ddx + ddy * ddy < BLOCK * BLOCK) return false;
      }
      return true;
    }

    /* ---------- 背景 / 网格 / 尘埃 ---------- */
    function drawBackground(size) {
      ctx.fillStyle = COL.bg;
      ctx.fillRect(0, 0, size.w, size.h);
    }
    function drawDust(size, time) {
      // 低频浅色尘埃（伪随机、缓慢漂移），替代 v1 星空
      var c = getCam();
      if (!c) return;
      var z = num(c.zoom, 1);
      var wx0 = c.x - size.w / 2 / z, wy0 = c.y - size.h / 2 / z;
      var cell = 260;
      var i0 = Math.floor(wx0 / cell), j0 = Math.floor(wy0 / cell);
      var ni = Math.ceil(size.w / z / cell) + 2, nj = Math.ceil(size.h / z / cell) + 2;
      ctx.fillStyle = COL.dust;
      for (var i = 0; i < ni; i++) {
        for (var j = 0; j < nj; j++) {
          var gx = (i0 + i) * cell, gy = (j0 + j) * cell;
          var s = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
          var f = s - Math.floor(s);
          if (f > 0.55) continue;
          var px = gx + f * cell, py = gy + ((f * 7919) % 1) * cell;
          var tw = 0.5 + 0.5 * Math.sin(time * 0.0006 + f * 40);
          ctx.globalAlpha = 0.25 + 0.35 * tw;
          ctx.beginPath();
          ctx.arc(px, py, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    function drawGrid(view, size) {
      var c = getCam();
      if (!c) return;
      var z = num(c.zoom, 1);
      var step = 80;
      while (step * z < 26) step *= 2;
      var x0 = Math.floor(view.x0 / step) * step, x1 = view.x1;
      var y0 = Math.floor(view.y0 / step) * step, y1 = view.y1;
      ctx.lineWidth = 1 / z;
      ctx.strokeStyle = COL.gridMinor;
      ctx.beginPath();
      for (var x = x0; x <= x1; x += step) { ctx.moveTo(x, view.y0); ctx.lineTo(x, view.y1); }
      for (var y = y0; y <= y1; y += step) { ctx.moveTo(view.x0, y); ctx.lineTo(view.x1, y); }
      ctx.stroke();
      // 主网格（5×）
      ctx.strokeStyle = COL.gridMajor;
      ctx.beginPath();
      for (x = Math.floor(view.x0 / (step * 5)) * step * 5; x <= x1; x += step * 5) { ctx.moveTo(x, view.y0); ctx.lineTo(x, view.y1); }
      for (y = Math.floor(view.y0 / (step * 5)) * step * 5; y <= y1; y += step * 5) { ctx.moveTo(view.x0, y); ctx.lineTo(view.x1, y); }
      ctx.stroke();
      // 原点轴
      ctx.strokeStyle = COL.gridOrigin;
      ctx.lineWidth = lineWidthWorld(1.5);
      ctx.beginPath();
      ctx.moveTo(view.x0, 0); ctx.lineTo(view.x1, 0);
      ctx.moveTo(0, view.y0); ctx.lineTo(0, view.y1);
      ctx.stroke();
    }

    /* ---------- 端口位置 ---------- */
    function outPortOf(node) { return { x: node.x + HALF, y: node.y }; }
    function inPortOf(node) { return { x: node.x - HALF, y: node.y }; }
    function firstOutputItem(state, nodeId) {
      var v = state.veins && state.veins[nodeId];
      if (v) return v.itemId;
      var b = state.buildings[nodeId];
      if (!b) return null;
      var r = b.recipeId ? ((content().RECIPES || {})[b.recipeId]) : null;
      return (r && r.outputs && r.outputs[0]) ? r.outputs[0].itemId : null;
    }
    function firstInputItem(state, nodeId) {
      var b = state.buildings[nodeId];
      if (!b) return null;
      var r = b.recipeId ? ((content().RECIPES || {})[b.recipeId]) : null;
      return (r && r.inputs && r.inputs[0]) ? r.inputs[0].itemId : null;
    }
    // 建筑是否有可用的输入/输出端口（发电建筑可入燃料不可输出；容量为 0 亦无）
    function hasInPort(state, node) {
      var b = state.buildings && state.buildings[node.id];
      if (!b) return false;
      var def = bdef(b.typeId);
      return !!(def && num(def.inputCapacity, 0) > 0);
    }
    function hasOutPort(state, node) {
      if (state.veins && state.veins[node.id]) return true;
      var b = state.buildings && state.buildings[node.id];
      if (!b) return false;
      var def = bdef(b.typeId);
      return !!(def && def.kind !== 'power' && num(def.outputCapacity, 0) > 0);
    }
    function drawPorts(state, node, kind, z) {
      if (z < PORT_HIDE_ZOOM) return;
      var r = PORT_R;
      var hl = portHighlight && portHighlight.id === node.id && (portHighlight.kind || 'building') === kind;
      if (kind === 'vein' || (kind === 'building' && hasOutPort(state, node))) {
        var op = outPortOf(node);
        var oc = itemColor(firstOutputItem(state, node.id), '#8a9bb5');
        ctx.fillStyle = oc;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = lineWidthWorld(2);
        ctx.beginPath(); ctx.arc(op.x, op.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (hl && (portHighlight.port || 'out') === 'out') drawPortHighlightRing(op, r);
      }
      if (kind === 'building' && hasInPort(state, node)) {
        var ip = inPortOf(node);
        var ic = itemColor(firstInputItem(state, node.id), '#8a9bb5');
        ctx.strokeStyle = ic;
        ctx.lineWidth = lineWidthWorld(2.5);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(ip.x, ip.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (hl && portHighlight.port === 'in') drawPortHighlightRing(ip, r);
      }
    }
    // 识别中的端口：高亮轮廓圈（对齐参考 connectionCandidateNode）
    function drawPortHighlightRing(p, r) {
      ctx.save();
      ctx.shadowColor = COL.select;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = COL.select;
      ctx.lineWidth = lineWidthWorld(3);
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    /* ---------- 传送带（类型化端口 → 端口弧线 + 物品点） ---------- */
    function beltGeom(state, belt) {
      var a = nodeById(state, belt.fromId), b = nodeById(state, belt.toId);
      if (!a || !b) return null;
      var p0 = outPortOf(a), p2 = inPortOf(b);
      var mx = (p0.x + p2.x) / 2, my = (p0.y + p2.y) / 2;
      var dx = p2.x - p0.x, dy = p2.y - p0.y;
      var len = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
      var k = Math.min(40, len * 0.12);
      var nx = -dy / len, ny = dx / len;
      return { p0: p0, p1: { x: mx + nx * k, y: my + ny * k }, p2: p2, len: len };
    }
    function nodeById(state, id) {
      return (state.buildings && state.buildings[id]) || (state.veins && state.veins[id]) || null;
    }
    function bezPoint(g, t) {
      var u = 1 - t;
      return {
        x: u * u * g.p0.x + 2 * u * t * g.p1.x + t * t * g.p2.x,
        y: u * u * g.p0.y + 2 * u * t * g.p1.y + t * t * g.p2.y
      };
    }
    function tierSpeed(tier) {
      var belts = content().BELTS || [];
      for (var i = 0; i < belts.length; i++) { if (num(belts[i].tier, 1) === num(tier, 1)) return num(belts[i].speed, 6); }
      return 6;
    }
    function drawBelts(state, view, time, multiKeys) {
      var c = getCam();
      var z = c ? num(c.zoom, 1) : 1;
      var keys = Object.keys(state.belts || {});
      for (var i = 0; i < keys.length; i++) {
        var belt = state.belts[keys[i]];
        var g = beltGeom(state, belt);
        if (!g) continue;
        if ((g.p0.x < view.x0 - 200 && g.p2.x < view.x0 - 200) ||
            (g.p0.x > view.x1 + 200 && g.p2.x > view.x1 + 200) ||
            (g.p0.y < view.y0 - 200 && g.p2.y < view.y0 - 200) ||
            (g.p0.y > view.y1 + 200 && g.p2.y > view.y1 + 200)) continue;
        var col = itemColor(belt.itemId, BELT_TIERS[num(belt.tier, 1)] || '#9aa7bd');
        // 底衬 + 彩色带面（框选命中的传送带外加一圈选中色描边）
        ctx.lineCap = 'round';
        if (multiKeys && multiKeys['belt:' + belt.id]) {
          ctx.lineWidth = lineWidthWorld(10);
          ctx.strokeStyle = COL.select;
          strokePath(g);
        }
        ctx.lineWidth = lineWidthWorld(7);
        ctx.strokeStyle = 'rgba(90,105,130,0.25)';
        strokePath(g);
        ctx.lineWidth = lineWidthWorld(4);
        ctx.strokeStyle = col;
        strokePath(g);
        // 负载点（信贷模型，借鉴 DSPONLINE：无独立在途物品，点由流量折算）
        var dotR = Math.max(3.5, 5);
        var perSec = (state._beltLast && state._beltLast[belt.id]) || 0;
        var capHint = tierSpeed(num(belt.tier, 1)); // 带速即吞吐上限（items/s）
        var load = Math.min(1, capHint > 0 ? perSec / capHint : 0);
        var count = Math.max(0, Math.round(4 * load)); // 至多 4 个点表示流负载
        if (count > 0) {
          // 点沿带均匀错开 + 随时间流动相位（有负载才有流动感）
          var flowPhase = (time * 0.6) % 1;
          for (var k = 0; k < count; k++) {
            var tt = clamp01(((k / count) + flowPhase) % 1);
            var p = bezPoint(g, tt);
            ctx.fillStyle = itemColor(belt.itemId, col);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = lineWidthWorld(1.4);
            ctx.beginPath(); ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
        }
      }
      function strokePath(g) {
        ctx.beginPath();
        ctx.moveTo(g.p0.x, g.p0.y);
        ctx.quadraticCurveTo(g.p1.x, g.p1.y, g.p2.x, g.p2.y);
        ctx.stroke();
      }
    }
    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

    // 框选橡皮筋（app._boxSel 为屏幕坐标 → 转世界坐标画虚线矩形）
    function drawBoxSelRect() {
      var r = app && app._boxSel;
      if (!r) return;
      var c = getCam();
      if (!c || typeof c.screenToWorld !== 'function') return;
      var a = c.screenToWorld(r.x0, r.y0);
      var b = c.screenToWorld(r.x1, r.y1);
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = lineWidthWorld(1.5);
      ctx.strokeStyle = COL.select;
      ctx.fillStyle = hexA(COL.select, 0.08);
      ctx.beginPath();
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y),
               Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    /* ---------- 卡片公共骨架 ---------- */
    function drawCardBase(x, y, fill, line, lw) {
      roundRectPath(ctx, x - HALF, y - HALF, BLOCK, BLOCK, 18);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = line;
      ctx.lineWidth = lineWidthWorld(lw || 2);
      ctx.stroke();
    }
    function drawIconTile(x, y, tileX, tileY, size, bg, glyph, glyphPx, glyphColor) {
      roundRectPath(ctx, tileX, tileY, size, size, size * 0.24);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.font = Math.round(fs(glyphPx)) + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = glyphColor || '#ffffff';
      ctx.fillText(glyph, tileX + size / 2, tileY + size / 2 + fs(glyphPx) * 0.05);
    }

    /* ---------- 矿脉卡片 ---------- */
    function drawVeinCard(state, v, selected, hover, powerRatio) {
      var x = v.x, y = v.y;
      var base = itemColor(v.itemId, '#8a9bb5');
      var fill = mixWhite(base, 0.80);
      var line = selected ? COL.select : (v.stalled ? STATUS_TONE.bad : hexA(base, 0.75));
      var cam = getCam();
      var z = cam ? num(cam.zoom, 1) : 1;
      var lod = z < 0.4 ? 0 : (z < 0.7 ? 1 : 2);
      if (selected) {
        ctx.save();
        ctx.shadowColor = hexA(COL.select, 0.55);
        ctx.shadowBlur = 24;
        drawCardBase(x, y, fill, line, 3);
        ctx.restore();
      } else {
        drawCardBase(x, y, fill, line, 2);
      }
      if (hover && !selected) {
        roundRectPath(ctx, x - HALF, y - HALF, BLOCK, BLOCK, 18);
        ctx.strokeStyle = COL.hover;
        ctx.lineWidth = lineWidthWorld(2.5);
        ctx.stroke();
      }
      var it = content().ITEMS[v.itemId] || {};
      var glyph = it.symbol || '?';
      // 头行：图标块 + 名称 + 右上百分比（LOD0/1/2 都画）
      drawIconTile(x, y, x - HALF + 12, y - HALF + 12, 34, base, glyph, 17);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = COL.text;
      ctx.font = '600 ' + fs(16) + 'px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(it.name || v.itemId, x - HALF + 54, y - HALF + 30);
      ctx.textAlign = 'right';
      ctx.font = '600 ' + fs(13) + 'px "Segoe UI",sans-serif';
      ctx.fillStyle = COL.textMuted;
      ctx.fillText(fmtPct((v.buffer || 0) / (v.cap || 300)), x + HALF - 12, y - HALF + 28);
      // 中行：采矿机 ×N（LOD0 省略）
      if (lod >= 1) {
        ctx.textAlign = 'left';
        ctx.font = fs(13) + 'px "Segoe UI","PingFang SC",sans-serif';
        ctx.fillStyle = COL.text;
        ctx.fillText('采矿机 ×' + (v.miners || 0), x - HALF + 12, y - HALF + 68);
        ctx.textAlign = 'right';
        ctx.fillStyle = COL.textMuted;
        ctx.fillText('可手动采集', x + HALF - 12, y - HALF + 68);
      }
      // 储量条（LOD0/1/2 都画，LOD0 贴底缩细）
      var barW = BLOCK - 24, barH = lod === 0 ? 5 : 8;
      var by = lod === 0 ? y + HALF - 16 : y + HALF - 44;
      roundRectPath(ctx, x - HALF + 12, by, barW, barH, barH / 2);
      ctx.fillStyle = COL.barBg; ctx.fill();
      var pct = Math.min(1, (v.buffer || 0) / (v.cap || 300));
      if (pct > 0.003) {
        roundRectPath(ctx, x - HALF + 12, by, Math.max(barH, barW * pct), barH, barH / 2);
        ctx.fillStyle = base; ctx.fill();
      }
      // 储量数据行（LOD0 省略）
      if (lod >= 1) {
        ctx.textAlign = 'left';
        ctx.font = fs(11.5) + 'px "Segoe UI",sans-serif';
        ctx.fillStyle = COL.textMuted;
        ctx.fillText('储量 ' + fmtQty((v.buffer || 0)) + ' / ' + fmtQty(v.cap || 300), x - HALF + 12, y + HALF - 18);
        ctx.textAlign = 'right';
        ctx.fillText(v.stalled ? '缓存已满' : (v.miners > 0 ? (fmtNum((5 * v.miners) * (powerRatio == null ? 1 : powerRatio), 1) + '/s') : '待放置采矿机'), x + HALF - 12, y + HALF - 18);
      }
      // ⛏×N 徽章（左上角外沿，LOD0 缩小）
      if (v.miners > 0) {
        var bx = x - HALF + 6, byy = y - HALF - 2;
        var badgeW = lod === 0 ? 40 : 52;
        var badgeH = lod === 0 ? 18 : 22;
        roundRectPath(ctx, bx, byy, badgeW, badgeH, badgeH / 2);
        ctx.fillStyle = COL.text; ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 ' + fs(lod === 0 ? 9 : 11.5) + 'px "Segoe UI",sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('⛏ ×' + v.miners, bx + badgeW / 2, byy + badgeH / 2);
        ctx.textBaseline = 'alphabetic';
      }
      // 选中态：卡片内画「🖐 采集」按钮（点击热区注册给 pointer，一键手动采集）
      if (selected) {
        var btn = { x: x - HALF + 12, y: y + HALF - 76, w: BLOCK - 24, h: 26 };
        veinMineRects[v.id] = btn;
        roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, 13);
        ctx.fillStyle = hexA(COL.select, 0.14);
        ctx.fill();
        ctx.strokeStyle = COL.select;
        ctx.lineWidth = lineWidthWorld(1.6);
        ctx.stroke();
        ctx.fillStyle = COL.select;
        ctx.font = '600 ' + fs(13) + 'px "Segoe UI","PingFang SC",sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        var mineLabel = (global.DSP_I18N && global.DSP_I18N.t('inspector.mineBtn')) || '🖐 采集';
        ctx.fillText(mineLabel, x, btn.y + btn.h / 2 + 1);
        ctx.textBaseline = 'alphabetic';
      }
    }
    function fmtNum(n, d) {
      if (n >= 100) return String(Math.round(n));
      return n.toFixed(d == null ? 1 : d);
    }

    /* ---------- 建筑卡片 ---------- */
    var IO_ROW_H = 15;      // 输入/输出徽章行高（世界单位，竖排）
    var IO_MAX_ROWS = 3;    // 单栏最多显示的物品条数，超出显示 +N
    var UI_FONT = '"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';

    // 按可用宽度截断文本（超出部分用 ... 省略）
    function ellipsize(text, maxW) {
      var s = String(text == null ? '' : text);
      if (maxW <= 0) return '';
      if (ctx.measureText(s).width <= maxW) return s;
      while (s.length > 1 && ctx.measureText(s + '...').width > maxW) s = s.slice(0, -1);
      return s + '...';
    }

    // 单条物品徽章（竖排中的一行）: [符号色块] 名称 ...... 数量
    function drawItemBadgeRow(ent, buf, x, row, colW, isInput, perCap) {
      var itemId = ent.itemId || ent.item || ent;
      var it = (content().ITEMS || {})[itemId];
      var color = (it && it.color) || '#8a9bb5';
      var symbol = (it && it.symbol) || '?';
      var name = (it && it.name) || itemId;
      var amt = Math.floor((buf && buf[itemId]) || 0);
      ctx.textBaseline = 'middle';
      // 符号色块（宽度随符号长度自适应，长化学式也不会溢出）
      ctx.font = '700 ' + fs(8) + 'px ' + UI_FONT;
      var symW = Math.min(26, Math.max(16, ctx.measureText(symbol).width + 6));
      roundRectPath(ctx, x, row - 6, symW, 12, 3);
      ctx.fillStyle = color; ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(symbol, x + symW / 2, row);
      // 名称（按栏宽截断） + 数量（右对齐到栏右缘）
      ctx.font = fs(9) + 'px ' + UI_FONT;
      // 多输入：输入缓存按种类均分，行内显示“存量/单格上限”
      var qtyText = (isInput && perCap > 0) ? (amt + '/' + perCap) : String(amt);
      var qtyW = ctx.measureText(qtyText).width;
      var nameMax = colW - symW - 4 - qtyW - 8;
      ctx.textAlign = 'left';
      ctx.fillStyle = COL.text;
      ctx.fillText(ellipsize(name, nameMax), x + symW + 4, row);
      ctx.textAlign = 'right';
      ctx.fillStyle = isInput && amt < (ent.amount || 1) ? STATUS_TONE.warn : COL.textMuted;
      ctx.fillText(qtyText, x + colW, row);
      ctx.textAlign = 'left';
    }

    // 输入/输出栏: 标题(名称 + 缓存量) + 竖排物品徽章，返回实际占用行数
    function drawIOColumn(title, sum, cap, entries, buf, x, colW, top, isInput, perCap, bId) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = '600 ' + fs(10) + 'px ' + UI_FONT;
      ctx.fillStyle = COL.textMuted;
      ctx.fillText(title + ' ' + fmtQty(sum) + '/' + fmtQty(cap), x, top);
      var list = entries || [];
      if (!list.length) {
        ctx.font = fs(10) + 'px ' + UI_FONT;
        ctx.fillStyle = COL.textMuted;
        ctx.fillText('-', x, top + 16);
        return 1;
      }
      var n = Math.min(list.length, IO_MAX_ROWS);
      for (var i = 0; i < n; i++) {
        var rowY = top + 16 + i * IO_ROW_H;
        drawItemBadgeRow(list[i], buf, x, rowY, colW, isInput, perCap);
        // 输入/输出行热区（世界坐标）→ 供指针层拾取搬运材料（src 区分进/出端）
        if (bId) {
          var rowItemId = list[i].itemId || list[i].item || list[i];
          if (!(ioRowRects[bId])) ioRowRects[bId] = [];
          ioRowRects[bId].push({ src: isInput ? 'in' : 'out', itemId: rowItemId, x: x - 4, y: rowY - IO_ROW_H / 2, w: colW + 8, h: IO_ROW_H });
        }
      }
      if (list.length > n) { // 超出上限位时提示剩余条数
        ctx.textAlign = 'left';
        ctx.font = fs(9) + 'px ' + UI_FONT;
        ctx.fillStyle = COL.textMuted;
        ctx.fillText('+' + (list.length - n), x, top + 16 + n * IO_ROW_H);
        n += 1;
      }
      return n;
    }
    // 未设配方时的引导文案（配方统一在详情面板选择）
    function recipeHintText() {
      return (global.DSP_I18N && global.DSP_I18N.t('inspector.recipeHint')) || '在详情面板选择配方';
    }

    function drawBuildingCard(state, b, selected, hover, powerRatio) {
      var x = b.x, y = b.y;
      var def = bdef(b.typeId);
      var accent = (def && def.color) || '#8a9bb5';
      var tone = toneOf(b, powerRatio);
      var paused = (b.enabled === false);
      if (paused) tone = 'off';
      var line = selected ? COL.select : (tone === 'bad' ? STATUS_TONE.bad : (tone === 'warn' ? STATUS_TONE.warn : (tone === 'off' ? STATUS_TONE.off : COL.cardLine)));
      var recipe = b.recipeId ? ((content().RECIPES || {})[b.recipeId]) : null;
      var cnt = Math.max(1, num(b.count, 1));
      var stallTexts = { no_recipe: '待配方', no_input: '待料', no_power: '待电', output_full: '输出已满', no_fuel: '待燃料', no_dyson: '待戴森云' };
      var recipeCapable = !!(def && (def.kind === 'machine' || def.kind === 'lab' || def.kind === 'station') && def.id !== 'spray_coater');
      var stalledText = recipeCapable
        ? (recipe ? (b.stalled ? (stallTexts[b.stallReason] || '停滞') : '运行中') : '待配方')
        : (b.stalled ? (stallTexts[b.stallReason] || '停滞') : '运行中');
      var stallText = paused
        ? ((global.DSP_I18N && global.DSP_I18N.t) ? global.DSP_I18N.t('status.off') : '已停用')
        : stalledText;
      var pct = (paused || b.stalled) ? 0 : clamp01(num(b.progress, 0));
      var inSum = sumBuf(b.inBuf), outSum = sumBuf(b.outBuf);
      var inCap = (def ? num(def.inputCapacity, 0) : 0) * cnt;
      var outCap = (def ? num(def.outputCapacity, 0) : 0) * cnt;
      var powerKw = def && def.powerDemandKw ? def.powerDemandKw * cnt : 0;
      var genKw = def && def.powerGenerationKw ? def.powerGenerationKw * cnt : 0;
      var isGen = !!(def && def.kind === 'power' && genKw > 0); // 发电建筑：卡片显示发电量而非耗电
      var speed = def && def.speed ? def.speed : 1;
      var eff = (speed * cnt * (powerRatio || 1)).toFixed(2);

      // 卡片底色 + 边框（选中用蓝色加粗，其余按状态着色）
      drawCardBase(x, y, COL.cardFill, line, selected ? 3 : 2);
      if (hover && !selected) {
        roundRectPath(ctx, x - HALF, y - HALF, BLOCK, BLOCK, 18);
        ctx.strokeStyle = COL.hover; ctx.lineWidth = lineWidthWorld(2.5); ctx.stroke();
      }
      if (selected) {
        ctx.save();
        ctx.shadowColor = hexA(COL.select, 0.4);
        ctx.shadowBlur = 16;
        roundRectPath(ctx, x - HALF, y - HALF, BLOCK, BLOCK, 18);
        ctx.strokeStyle = COL.select; ctx.lineWidth = lineWidthWorld(3); ctx.stroke();
        ctx.restore();
      }

      var left = x - HALF + 14;
      var right = x + HALF - 14;
      var row = y - HALF + 26;

      // 第1行: 图标 + 建筑名 + 已选中标签(仅选中)
      drawIconTile(x, y, left, row - 10, 28, accent, (def && def.icon) || '🏭', 14);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = COL.text;
      ctx.font = '600 ' + fs(14) + 'px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(def ? (def.shortName || def.name) : b.typeId, left + 34, row);
      if (selected) {
        ctx.textAlign = 'right';
        ctx.font = '600 ' + fs(10) + 'px "Segoe UI",sans-serif';
        var badgeW = ctx.measureText('已选中').width + 10;
        roundRectPath(ctx, right - badgeW, row - 9, badgeW, 18, 6);
        ctx.fillStyle = '#2f7cf6'; ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText('已选中', right - 5, row);
      } else if (cnt > 1) {
        ctx.textAlign = 'right';
        ctx.font = '700 ' + fs(11) + 'px "Segoe UI",sans-serif';
        ctx.fillStyle = accent;
        ctx.fillText('x' + cnt, right, row);
      }

      // 第2行: 配方名（可点击 → 弹出画布上的配方下拉；仅支持配方的建筑类型显示）
      row += 32; // 标题图标块高 28px（底 row+18），配方框半高 11px → 至少 +29 才不压标题
      if (recipeCapable) {
        var recipeRowY = row;
        var recipeRowH = 22;
        var recipeBoxPad = 6;
        var recipeBoxX = left - recipeBoxPad;
        var recipeBoxW = BLOCK - 28 + recipeBoxPad * 2;
        // 下拉框背景与边框，让点击区域更明显
        roundRectPath(ctx, recipeBoxX, recipeRowY - recipeRowH / 2, recipeBoxW, recipeRowH, 5);
        ctx.fillStyle = recipe ? hexA(COL.select, 0.10) : 'rgba(120,135,160,0.08)';
        ctx.fill();
        ctx.strokeStyle = recipe ? hexA(COL.select, 0.50) : 'rgba(120,135,160,0.40)';
        ctx.lineWidth = lineWidthWorld(1);
        ctx.stroke();
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.font = fs(12) + 'px "Segoe UI","PingFang SC",sans-serif';
        ctx.fillStyle = recipe ? COL.text : COL.textMuted;
        var recipeText = recipe ? recipe.name : recipeHintText();
        // 过长截断，留出箭头空间
        var maxRecipeTextW = recipeBoxW - recipeBoxPad * 2 - 22;
        if (ctx.measureText(recipeText).width > maxRecipeTextW) {
          for (var ti = recipeText.length; ti > 0; ti--) {
            var sub = recipeText.slice(0, ti) + '…';
            if (ctx.measureText(sub).width <= maxRecipeTextW) { recipeText = sub; break; }
          }
        }
        ctx.fillText(recipeText, left, recipeRowY);
        // 下拉提示箭头
        ctx.textAlign = 'right';
        ctx.fillStyle = COL.textMuted;
        ctx.fillText('▾', right, recipeRowY);
        ctx.textAlign = 'left';
        // 记录热区（覆盖整个下拉框）
        if (def && (def.kind === 'machine' || def.kind === 'lab' || def.kind === 'station') && def.id !== 'spray_coater') {
          recipeRowRects[b.id] = { x: recipeBoxX, y: recipeRowY - recipeRowH / 2, w: recipeBoxW, h: recipeRowH };
        }
      }

      // 第3行: 状态点 + 状态文本 + 进度百分比
      row += 24;
      ctx.beginPath();
      ctx.arc(left + 4, row, 4, 0, Math.PI * 2);
      ctx.fillStyle = STATUS_TONE[tone];
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.font = '500 ' + fs(12) + 'px "Segoe UI",sans-serif';
      ctx.fillStyle = tone === 'bad' ? STATUS_TONE.bad : COL.text;
      ctx.fillText(stallText, left + 14, row);
      ctx.textAlign = 'right';
      ctx.font = fs(11) + 'px "Segoe UI",sans-serif';
      ctx.fillStyle = COL.textMuted;
      ctx.fillText(fmtPct(pct), right, row);

      // 第4行: 进度条
      row += 16;
      var barW = BLOCK - 28, barH = 7;
      roundRectPath(ctx, left, row, barW, barH, barH / 2);
      ctx.fillStyle = COL.barBg; ctx.fill();
      if (pct > 0.003) {
        roundRectPath(ctx, left, row, Math.max(barH, barW * pct), barH, barH / 2);
        ctx.fillStyle = COL.barFill; ctx.fill();
      }

      // 第5行: 左栏=输入端 / 右栏=输出端（竖排徽章，中间用分隔线隔开）
      // 无物流能力的建筑（发电/零容量）不显示 IO 区
      var inPerCap = 0;
      if (recipe && (recipe.inputs || []).length > 1 && global.DSP_ENGINE && global.DSP_ENGINE.inputItemCapOf) {
        inPerCap = global.DSP_ENGINE.inputItemCapOf(content(), b, recipe.inputs[0].itemId) || 0;
      }
      var showIn = inCap > 0 || inSum > 0;
      var showOut = outCap > 0 || outSum > 0;
      var rowsIn = 0, rowsOut = 0, ioTop = row;
      if (showIn || showOut) {
        row += 22;
        ioTop = row;
        var colGap = 10;
        var colW = (BLOCK - 28 - colGap) / 2;
        if (showIn) rowsIn = drawIOColumn('输入', inSum, inCap, recipe && recipe.inputs, b.inBuf, left, colW, ioTop, true, inPerCap, b.id);
        if (showOut) rowsOut = drawIOColumn('输出', outSum, outCap, recipe && recipe.outputs, b.outBuf, left + colW + colGap, colW, ioTop, false, 0, b.id);
        // 分栏分隔线（仅两栏同时显示时）
        if (showIn && showOut) {
          ctx.beginPath();
          ctx.moveTo(left + colW + colGap / 2, ioTop - 8);
          ctx.lineTo(left + colW + colGap / 2, ioTop + 16 + IO_ROW_H * Math.max(rowsIn, rowsOut) - 8);
          ctx.strokeStyle = COL.divider || 'rgba(148,166,196,0.35)';
          ctx.lineWidth = lineWidthWorld(1);
          ctx.stroke();
        }
        row = ioTop + 16 + IO_ROW_H * Math.max(rowsIn, rowsOut) + 8;
      }

      // 第6行: 电力 + 倍率（紧随输入/输出区；发电建筑显示发电量）
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = fs(11) + 'px "Segoe UI",sans-serif';
      ctx.fillStyle = isGen ? '#e8c35a' : COL.text;
      ctx.fillText(isGen ? ('⚡ 发电 ' + fmtKwShort(genKw)) : ('⚡ ' + fmtKwShort(powerKw)), left, row);
      ctx.textAlign = 'right';
      ctx.fillStyle = COL.textMuted;
      ctx.fillText(eff + 'x', right, row);

      ctx.textBaseline = 'alphabetic';
    }


    function sumBuf(buf) {
      var s = 0;
      for (var k in (buf || {})) { if (buf.hasOwnProperty(k)) s += buf[k]; }
      return s;
    }

    /* ---------- 幽灵 / 连线预览 ---------- */
    function drawGhost(state, view) {
      if (!app || app.mode !== 'place' || !app.placeType) return;
      var p = pointerToWorld();
      if (!p) return;
      var x = snap(p.x), y = snap(p.y);
      var def = bdef(app.placeType);
      if (!def) return;
      var ok = placementValid(state, app.placeType, x, y);
      var base = def.color || '#8a9bb5';
      ctx.globalAlpha = 0.55;
      drawCardBase(x, y, def.kind === 'miner' ? mixWhite(itemColor(veinUnder(state, x, y) || '', '#8a9bb5'), 0.8) : COL.cardFill,
        ok ? COL.ghostOkLine : COL.ghostBadLine, 3);
      ctx.globalAlpha = 1;
      ctx.fillStyle = ok ? COL.ghostOkLine : COL.ghostBadLine;
      ctx.font = '600 ' + fs(14) + 'px "Segoe UI","PingFang SC",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((def.icon || '') + ' ' + (def.shortName || def.name) + (ok ? '' : ' ×'), x, y - HALF - 10);
      if (app.placeType && bdef(app.placeType) && bdef(app.placeType).kind === 'miner') {
        var v = veinNear(state, x, y, 300);
        if (v) {
          ctx.strokeStyle = COL.connectOk;
          ctx.lineWidth = lineWidthWorld(2);
          ctx.setLineDash([8, 6]);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(v.x, v.y); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
    function veinUnder(state, x, y) {
      var v = veinNear(state, x, y, BLOCK);
      return v ? v.itemId : null;
    }
    // 搬运中的材料幽灵（跟随指针；对齐参考 CargoCursor）
    function drawCarriedGhost() {
      if (!app || !app._carried || !app._carriedPos) return;
      var c = getCam(); if (!c) return;
      var w = c.screenToWorld(app._carriedPos.sx, app._carriedPos.sy);
      var it = (content().ITEMS || {})[app._carried.itemId] || {};
      var label = (it.symbol || '?') + ' ' + (it.name || app._carried.itemId) + ' ×' + (app._carried.amount || 0);
      ctx.font = '600 ' + fs(12) + 'px ' + UI_FONT;
      var tw = ctx.measureText(label).width;
      roundRectPath(ctx, w.x + 14, w.y - 30, tw + 18, 24, 6);
      // 浅色面板 + 投影：深空背景上保持高对比（原近黑底在暗背景上糊成一片）
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(255,255,255,0.97)';
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = it.color || COL.select;
      ctx.lineWidth = lineWidthWorld(1.5);
      ctx.stroke();
      ctx.fillStyle = COL.text;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(label, w.x + 23, w.y - 18);
      ctx.textBaseline = 'alphabetic';
    }
    function veinNear(state, x, y, maxDist) {
      var veins = state.veins || {};
      var best = null, bestD = maxDist * maxDist;
      var ks = Object.keys(veins);
      for (var i = 0; i < ks.length; i++) {
        var v = veins[ks[i]];
        var dx = v.x - x, dy = v.y - y;
        var d2 = dx * dx + dy * dy;
        if (d2 <= bestD) { bestD = d2; best = v; }
      }
      return best;
    }
    function drawConnectPreview(state) {
      if (!app || app.mode !== 'connect' || !app.connectFrom) return;
      var from = nodeById(state, app.connectFrom);
      var p = pointerToWorld();
      if (!from || !p) return;
      var op = outPortOf(from);
      var E = global.DSP_ENGINE || {};
      var target = nodeAt(state, p.x, p.y);
      var ok = false, targetNode = null;
      if (target && String(target.id) !== String(app.connectFrom)) {
        targetNode = nodeById(state, target.id);
        ok = E.canConnect ? !!E.canConnect(state, content(), app.connectFrom, target.id) : true;
      }
      ctx.strokeStyle = ok ? COL.connectOk : COL.connectBad;
      ctx.lineWidth = lineWidthWorld(3);
      ctx.setLineDash([10, 7]);
      ctx.beginPath();
      ctx.moveTo(op.x, op.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (targetNode) {
        roundRectPath(ctx, targetNode.x - HALF, targetNode.y - HALF, BLOCK, BLOCK, 18);
        ctx.strokeStyle = ok ? COL.connectOk : COL.connectBad;
        ctx.lineWidth = lineWidthWorld(3);
        ctx.stroke();
      }
    }
    // 移动预览幽灵（拖动方块换位时，合法绿 / 非法红）
    function drawMoveGhost(state) {
      if (!app || !app._dragMove) return;
      var d = app._dragMove;
      var node = nodeById(state, d.id);
      if (!node) return;
      var isVein = !!((state.veins || {})[d.id]);
      var ok = true;
      // 占位检查：其他方块落在 75 内即冲突（同型建筑=合并，显示绿色“并入”）
      var merge = false;
      var bks = Object.keys(state.buildings || {});
      for (var i = 0; i < bks.length; i++) {
        if (String(bks[i]) === String(d.id)) continue;
        var b = state.buildings[bks[i]];
        var dx = b.x - d.x, dy = b.y - d.y;
        if (dx * dx + dy * dy < BLOCK * BLOCK) {
          ok = false;
          if (!isVein && b.typeId === node.typeId) { ok = true; merge = true; }
          break;
        }
      }
      if (ok && !merge) {
        var vk = Object.keys(state.veins || {});
        for (i = 0; i < vk.length; i++) {
          if (String(vk[i]) === String(d.id)) continue;
          var v = state.veins[vk[i]];
          var ddx = v.x - d.x, ddy = v.y - d.y;
          if (ddx * ddx + ddy * ddy < BLOCK * BLOCK) { ok = false; break; }
        }
      }
      ctx.save();
      ctx.globalAlpha = 0.75;
      roundRectPath(ctx, d.x - HALF, d.y - HALF, BLOCK, BLOCK, 18);
      ctx.fillStyle = ok ? COL.ghostOk : COL.ghostBad;
      ctx.fill();
      ctx.strokeStyle = ok ? COL.ghostOkLine : COL.ghostBadLine;
      ctx.lineWidth = lineWidthWorld(3);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (merge) {
        ctx.fillStyle = COL.ghostOkLine;
        ctx.font = '600 ' + fs(14) + 'px "Segoe UI","PingFang SC",sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('并入 ×' + (num(node.count, 1) + 1), d.x, d.y - HALF - 10);
      }
      ctx.restore();
    }
    function pointerToWorld() {
      var c = getCam();
      if (!c || !pointer.inside) return null;
      return c.screenToWorld(pointer.sx, pointer.sy);
    }

    /* ---------- 主渲染 ---------- */
    function render() {
      var size = ensureSize();
      var c = getCam();
      var dpr = size.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawBackground(size);
      if (!app || !app.state || !c) return;
      var z = num(c.zoom, 1);
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (size.w / 2 - c.x * z), dpr * (size.h / 2 - c.y * z));
      var view = {
        x0: c.x - size.w / 2 / z - HALF, x1: c.x + size.w / 2 / z + HALF,
        y0: c.y - size.h / 2 / z - HALF, y1: c.y + size.h / 2 / z + HALF
      };
      var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      drawGrid(view, size);
      drawDust(size, now);
      drawBelts(app.state, view, now, multiKeys);

      var power = (global.DSP_ENGINE && global.DSP_ENGINE.powerStats)
        ? global.DSP_ENGINE.powerStats(app.state, content()) : { ratio: 1 };
      var grids = power.grids || { a: { ratio: power.ratio || 1 }, b: { ratio: 1 }, c: { ratio: 1 } };
      var sel = app.selected || {};
      // 框选集合（无单选时生效）：一次性建 key 集合供各绘制器查询
      var multiKeys = null;
      if (!app.selected && app.selectedSet && app.selectedSet.length) {
        multiKeys = {};
        for (var mi = 0; mi < app.selectedSet.length; mi++) {
          multiKeys[app.selectedSet[mi].kind + ':' + app.selectedSet[mi].id] = true;
        }
      }
      // 矿脉卡片（每帧重建采集按钮热区）
      veinMineRects = {};
      ioRowRects = {};
      var vks = Object.keys(app.state.veins || {});
      for (var i = 0; i < vks.length; i++) {
        var v = app.state.veins[vks[i]];
        if (v.x < view.x0 - HALF || v.x > view.x1 + HALF || v.y < view.y0 - HALF || v.y > view.y1 + HALF) continue;
        var vSel = (sel.kind === 'vein' && String(sel.id) === String(vks[i])) ||
                   (!!multiKeys && !!multiKeys['vein:' + vks[i]]);
        var vHov = pointer.inside ? (function () {
          var w = pointerToWorld();
          if (!w) return false;
          var dx = v.x - w.x, dy = v.y - w.y;
          return dx * dx + dy * dy <= HALF * HALF;
        })() : false;
        drawVeinCard(app.state, v, vSel, vHov, grids['a'] ? grids['a'].ratio : 1);
        drawPorts(app.state, v, 'vein', z);
      }
      // 建筑卡片
      var bks = Object.keys(app.state.buildings || {});
      for (i = 0; i < bks.length; i++) {
        var b = app.state.buildings[bks[i]];
        if (b.x < view.x0 - HALF || b.x > view.x1 + HALF || b.y < view.y0 - HALF || b.y > view.y1 + HALF) continue;
        var bSel = (sel.kind === 'building' && String(sel.id) === String(bks[i])) ||
                   (!!multiKeys && !!multiKeys['building:' + bks[i]]);
        var bHov = false;
        if (pointer.inside) {
          var w2 = pointerToWorld();
          if (w2) {
            var ddx = b.x - w2.x, ddy = b.y - w2.y;
            bHov = ddx * ddx + ddy * ddy <= HALF * HALF;
          }
        }
        drawBuildingCard(app.state, b, bSel, bHov, grids[(b.grid || 'a')] ? grids[(b.grid || 'a')].ratio : 1);
        drawPorts(app.state, b, 'building', z);
      }
      drawGhost(app.state, view);
      drawMoveGhost(app.state);
      drawConnectPreview(app.state);
      drawBoxSelRect();
      drawCarriedGhost();

      // FPS 指数滑动平均 → app._fps
      fpsAcc++; var dt = now - fpsAt;
      if (dt >= 500) {
        var fps = Math.round(fpsAcc * 1000 / dt);
        app._fps = app._fps == null ? fps : Math.round(app._fps * 0.6 + fps * 0.4);
        fpsAcc = 0; fpsAt = now;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    return {
      render: render,
      /** 供输入层命中测试：返回与渲染一致的传送带几何（p0/p1/p2 二次贝塞尔） */
      beltGeomOf: function (state, belt) { return beltGeom(state, belt); },
      /** 点位是否落在某建筑卡的「配方行」上 → 返回建筑 id 或 null */
      hitRecipeRow: function (wx, wy) {
        var keys = Object.keys(recipeRowRects);
        for (var i = 0; i < keys.length; i++) {
          var r = recipeRowRects[keys[i]];
          if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return keys[i];
        }
        return null;
      },
      /** 建筑卡配方行热区（世界坐标）→ 供 UI 定位画布配方下拉 */
      recipeRowRectOf: function (id) { return recipeRowRects[id] || null; },
      /** 设置识别中的端口高亮（hit = {kind,id,port} 或 null；输入层在连线/投放拖拽时调用） */
      setPortHighlight: function (hit) { portHighlight = hit || null; },
      /** 点位是否落在某建筑卡的输入/输出缓存行上 → {buildingId,itemId,src:'in'|'out'} 或 null（供搬运材料拾取） */
      hitIORow: function (wx, wy) {
        var ids = Object.keys(ioRowRects);
        for (var i = 0; i < ids.length; i++) {
          var rows = ioRowRects[ids[i]];
          for (var j = 0; j < rows.length; j++) {
            var r = rows[j];
            if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) {
              return { buildingId: ids[i], itemId: r.itemId, src: r.src };
            }
          }
        }
        return null;
      },
      /** @deprecated 兼容旧名：输入行命中（不含输出端） */
      hitInputRow: function (wx, wy) {
        var hit = this.hitIORow(wx, wy);
        return (hit && hit.src === 'in') ? hit : null;
      },
      /** 最近的输入口点位命中（世界半径 = 点半径 + 余量）→ {id,port:'in'} 或 null（供库存投放识别） */
      portHitAt: function (wx, wy) {
        var st = app && app.state; if (!st) return null;
        var bs = st.buildings || {}, best = null, bestD2 = (PORT_R + 8) * (PORT_R + 8);
        var keys = Object.keys(bs);
        for (var i = 0; i < keys.length; i++) {
          var b = bs[keys[i]];
          if (!hasInPort(st, b)) continue;
          var ip = inPortOf(b);
          var dx = wx - ip.x, dy = wy - ip.y, d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; best = { id: keys[i], port: 'in' }; }
        }
        return best;
      },
      nodeAt: function (state, wx, wy) { return nodeAt(state, wx, wy); },
      /** 点位是否落在选中矿脉的「采集」按钮上 → 返回矿脉 id 或 null */
      hitVeinMineButton: function (wx, wy) {
        if (!app || !app.selected || app.selected.kind !== 'vein') return null;
        var r = veinMineRects[app.selected.id];
        if (!r) return null;
        var w = pointerToWorld();
        var px = (wx == null && w) ? w.x : wx;
        var py = (wy == null && w) ? w.y : wy;
        if (px == null) return null;
        return (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) ? app.selected.id : null;
      },
      hoverBuildingId: function () {
        var c = getCam();
        if (!c || !pointer.inside || !app || !app.state) return null;
        var w = c.screenToWorld(pointer.sx, pointer.sy);
        var hit = nodeAt(app.state, w.x, w.y);
        return hit ? hit.id : null;
      }
    };
  }

  global.DSP_RENDERER = { createRenderer: createRenderer };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.DSP_RENDERER;
})(globalThis);
