/* ============================================================
 * DSP_INPUT — Pointer Events 统一输入（鼠标 + 触摸）v2
 * 契约：SPEC-v2 §2（节点方块模型）。经典脚本，挂载 globalThis.DSP_INPUT。
 * 交互总表：
 *   - 左键空白拖拽 = 平移；滚轮 / 双指捏合 = 缩放（以捏合中心为锚点）
 *   - 点击方块（建筑/矿脉）/ 传送带 = 选中；点击空白 = 取消选中
 *   - 按住方块拖动 = 移动换位（松手 app.move / 引擎 moveBuilding；
 *     同型合并、非法位 toast 拒绝）
 *   - 从方块输出口（右缘中点）按住拖到另一方块 = 连接传送带
 *     （类型化端口：不匹配时松手 toast itemMismatch）
 *   - 建造面板进入 mode='place' 后点击画布放置：采矿机自动吸附最近矿脉
 *   - placeType='belt'（传送带工具）：点起点 → 点终点，两段式连接
 *   - 触摸长按建筑 = 底部快捷菜单（通过 DSP_UI.openQuickMenu，若可用）
 *   - 快捷键：1-9 选建筑、Del/Backspace 删除选中、空格暂停、Esc 取消/关面板
 * 写入 app 的字段：mode / placeType / selected / connectFrom / _dragMove（移动预览，扩展字段）。
 * ============================================================ */
(function (global) {
  'use strict';

  var CLICK_SLOP = 8;        // px：位移小于该值视为点击
  var DRAG_SLOP = 12;        // px：按住方块位移超过该值进入拖动/连线
  var BELT_HIT_PX = 42;      // 屏幕像素：点选传送带的距离阈值（除以 zoom 转世界单位，参考 DSPONLINE）
  var PORT_HIT_PX = 26;      // 屏幕像素：端口识别半径（= UI 端口点大小略大，参考 DSPONLINE connectionHitRadius 标准 24px）
  var PORT_HIT_MIN = 14;     // 世界单位：识别半径下限（防止极小缩放时物理上难点中）
  var BLOCK_HALF = 110;       // 方块半边长（与渲染器一致）
  var SNAP_GRID = 15;        // 放置/移动吸附网格
  var LONG_PRESS_MS = 550;   // 触摸长按建筑触发快捷菜单
  var WHEEL_FACTOR = 0.0013;

  function setMode(app, mode) {
    app.mode = mode;
    if (mode !== 'connect') app.connectFrom = null;
    if (mode !== 'place') app.placeType = null;
    if (typeof app.refreshUI === 'function') {
      try { app.refreshUI(); } catch (e) { /* UI 未就绪时忽略 */ }
    }
  }

  function cancelToSelect(app) {
    if (app.mode !== 'select') setMode(app, 'select');
    app.connectFrom = null;
    app._dragMove = null;
  }

  function attach(canvas, app) {
    if (!canvas || !app) {
      if (typeof console !== 'undefined') console.error('[DSP_INPUT] attach 需要 canvas 与 app');
      return;
    }

    var pointers = new Map();     // pointerId -> {x, y, startX, startY, moved}
    var gesture = null;           // {type:'pan'|'pinch'|'move'|'connect'|'place', ...}
    var longPressTimer = null;
    var longPressFired = false;

    /* ---------------- 命中检测（只读） ---------------- */
    function worldAt(sx, sy) {
      return app.camera.screenToWorld(sx, sy);
    }
    function nodeById(id) {
      var st = app.state || {};
      if (st.buildings && st.buildings[id]) return { kind: 'building', node: st.buildings[id] };
      if (st.veins && st.veins[id]) return { kind: 'vein', node: st.veins[id] };
      return null;
    }
    // 方块命中：220x220（建筑在上层，先查建筑）
    function nodeHitAt(wx, wy) {
      var st = app.state || {};
      var bs = st.buildings || {};
      var keys = Object.keys(bs);
      for (var i = keys.length - 1; i >= 0; i--) {
        var b = bs[keys[i]];
        if (Math.abs(wx - b.x) <= BLOCK_HALF && Math.abs(wy - b.y) <= BLOCK_HALF) {
          return { kind: 'building', id: keys[i] };
        }
      }
      var vs = st.veins || {};
      var vk = Object.keys(vs);
      for (i = vk.length - 1; i >= 0; i--) {
        var v = vs[vk[i]];
        if (Math.abs(wx - v.x) <= BLOCK_HALF && Math.abs(wy - v.y) <= BLOCK_HALF) {
          return { kind: 'vein', id: vk[i] };
        }
      }
      return null;
    }
    // 端口命中：全图扫描最近端口，识别半径 = UI 端口点大小略大（屏幕像素除以 zoom，参考 DSPONLINE）；
    // out=右缘中点，in=左缘中点。识别半径与点一致后不再需要中心保留区（端口点远离方块中心）。
    function nearestPortAt(wx, wy, port) {
      var st = app.state || {};
      var lists = [
        { kind: 'building', nodes: st.buildings || {} },
        { kind: 'vein', nodes: st.veins || {} }
      ];
      var zoom = (app.camera && typeof app.camera.zoom === 'number') ? app.camera.zoom : 1;
      var R = Math.max(PORT_HIT_MIN, PORT_HIT_PX / Math.max(0.3, zoom));
      var best = null, bestD2 = R * R;
      for (var li = 0; li < lists.length; li++) {
        var keys = Object.keys(lists[li].nodes);
        for (var i = 0; i < keys.length; i++) {
          var n = lists[li].nodes[keys[i]];
          // 端口存在性过滤：矿脉只有输出口；发电建筑只收燃料（无输出口）；容量为 0 亦无
          var isVein = lists[li].kind === 'vein';
          if (isVein && port === 'in') continue;
          if (!isVein) {
            var bd = app.content && app.content.BUILDINGS ? app.content.BUILDINGS[n.typeId] : null;
            if (!bd) continue;
            if (bd.kind === 'power' && port === 'out') continue;
            var cap = port === 'out' ? (bd.outputCapacity || 0) : (bd.inputCapacity || 0);
            if (!(cap > 0)) continue;
          }
          var px = port === 'out' ? n.x + BLOCK_HALF : n.x - BLOCK_HALF;
          var dpx = wx - px, dpy = wy - n.y;
          var d2 = dpx * dpx + dpy * dpy;
          if (d2 >= bestD2) continue;
          bestD2 = d2;
          best = { kind: lists[li].kind, id: keys[i], port: port };
        }
      }
      return best;
    }
    // 输出口命中：方块右缘中点附近
    function outPortAt(wx, wy) {
      return nearestPortAt(wx, wy, 'out');
    }
    // 输入口命中：方块左缘中点附近（v2：双端口均可起拖连线）
    function inPortAt(wx, wy) {
      return nearestPortAt(wx, wy, 'in');
    }
    // 点到二次贝塞尔折线的最小距离（与渲染曲线一致，采样 12 段）
    function distToQuadBezier(px, py, g) {
      var steps = 12, prev = null, best = Infinity;
      for (var i = 0; i <= steps; i++) {
        var t = i / steps, u = 1 - t;
        var x = u * u * g.p0.x + 2 * u * t * g.p1.x + t * t * g.p2.x;
        var y = u * u * g.p0.y + 2 * u * t * g.p1.y + t * t * g.p2.y;
        if (prev) {
          var d = distToSegment(px, py, prev.x, prev.y, x, y);
          if (d < best) best = d;
        }
        prev = { x: x, y: y };
      }
      return best;
    }
    function beltAt(wx, wy) {
      var belts = app.state ? (app.state.belts || {}) : {};
      var keys = Object.keys(belts);
      if (!keys.length) return null;
      // 阈值 = 固定屏幕像素 / zoom → 任何缩放级别手感一致
      var zoom = (app.camera && typeof app.camera.zoom === 'number') ? app.camera.zoom : 1;
      var limit = BELT_HIT_PX / Math.max(0.3, zoom);
      var R = global.DSP_RENDERER;
      var inst = R && R.instance;
      var best = null, bestD = limit;
      for (var i = 0; i < keys.length; i++) {
        var bl = belts[keys[i]];
        var d = Infinity;
        if (inst && typeof inst.beltGeomOf === 'function') {
          var g = inst.beltGeomOf(app.state, bl);
          if (!g) continue;
          d = distToQuadBezier(wx, wy, g); // 对实际渲染曲线求距
        } else {
          var f = nodeById(bl.fromId), t = nodeById(bl.toId);
          if (!f || !t) continue;
          d = distToSegment(wx, wy, f.node.x, f.node.y, t.node.x, t.node.y);
        }
        if (d > limit) continue;
        // 平局按 id 字典序取小 → 重叠带选中结果稳定（参考 DSPONLINE）
        if (!best || d < bestD || (d === bestD && String(bl.id) < String(best.id))) {
          bestD = d; best = bl;
        }
      }
      return best ? { belt: best, dist: bestD } : null;
    }
    // 端口点坐标（用于与带命中比距离）
    function portPoint(hit) {
      var st = app.state || {};
      var n = (st.buildings && st.buildings[hit.id]) || (st.veins && st.veins[hit.id]);
      if (!n) return null;
      return {
        x: hit.port === 'out' ? n.x + BLOCK_HALF : n.x - BLOCK_HALF,
        y: n.y
      };
    }
    function distToSegment(px, py, ax, ay, bx, by) {
      var dx = bx - ax, dy = by - ay;
      var len2 = dx * dx + dy * dy;
      var t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      var cx = ax + dx * t - px, cy = ay + dy * t - py;
      return Math.sqrt(cx * cx + cy * cy);
    }

    /* ---------------- 命令代理（优先走 app 门面，缺失时兜底引擎） ---------------- */
    function appFn(name) { return typeof app[name] === 'function' ? app[name] : null; }
    function callApp(name, args, fallback) {
      var fn = appFn(name);
      if (fn) { try { return fn.apply(app, args); } catch (e) { /* 继续兜底 */ } }
      return fallback ? fallback() : undefined;
    }
    function engine() { return global.DSP_ENGINE || null; }
    function rinst() { var R = global.DSP_RENDERER; return (R && R.instance) || null; }

    function doPlace(typeId, x, y) {
      var res = callApp('place', [typeId, x, y], function () {
        var E = engine();
        return E ? E.placeBuilding(app.state, app.content, { typeId: typeId, x: x, y: y }) : { ok: false };
      });
      if (res && res.ok && typeof app.refreshUI === 'function') {
        try { app.refreshUI(); } catch (e) { /* 忽略 */ }
      }
      return res;
    }
    function doMove(id, x, y) {
      var res = callApp('move', [id, x, y], function () {
        var E = engine();
        return E ? E.moveBuilding(app.state, app.content, id, x, y) : { ok: false };
      });
      if (res && res.ok && typeof app.refreshUI === 'function') {
        try { app.refreshUI(); } catch (e) { /* 忽略 */ }
      }
      return res;
    }
    function doConnect(fromId, toId) {
      var tier = app.beltTier || 1;
      var res = callApp('connect', [fromId, toId], function () {
        var E = engine();
        return E ? E.connectBelt(app.state, app.content, { fromId: fromId, toId: toId, tier: tier }) : { ok: false };
      });
      if (res && res.ok && typeof app.refreshUI === 'function') {
        try { app.refreshUI(); } catch (e) { /* 忽略 */ }
      }
      return res;
    }
    function doRemoveSelected() {
      var sel = app.selected;
      if (!sel) return;
      if (sel.kind === 'belt') {
        callApp('removeBelt', [sel.id], function () {
          var E = engine();
          return E ? E.removeBelt(app.state, sel.id) : { ok: false };
        });
      } else {
        callApp('remove', [sel.id], function () {
          var E = engine();
          return E ? E.removeBuilding(app.state, app.content, sel.id) : { ok: false };
        });
      }
      app.selected = null;
      if (typeof app.refreshUI === 'function') { try { app.refreshUI(); } catch (e) { /* 忽略 */ } }
    }
    function select(kind, id) {
      hideCardRecipeMenu();
      app.selected = { kind: kind, id: id };
      app.selectedSet = null; // 单选覆盖框选集合
      if (typeof app.refreshUI === 'function') { try { app.refreshUI(); } catch (e) { /* 忽略 */ } }
      var UI = global.DSP_UI;
      if (UI && typeof UI.openSidebarTab === 'function') UI.openSidebarTab('inspector');
    }

    /** 收起画布上的建筑卡配方下拉（存在时） */
    function hideCardRecipeMenu() {
      var UI = global.DSP_UI;
      if (UI && typeof UI.hideCardRecipeMenu === 'function') UI.hideCardRecipeMenu();
    }

    /* ---------------- 框选（鼠标左键拖拽空白处） ---------------- */
    // 线段与矩形相交：端点/中点在矩形内，或与任一边缘线段相交
    function segIntersectsRect(ax, ay, bx, by, r) {
      function inRect(x, y) { return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }
      if (inRect(ax, ay) || inRect(bx, by)) return true;
      var mx = (ax + bx) / 2, my = (ay + by) / 2;
      if (inRect(mx, my)) return true;
      function segSeg(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
        var d = (p2x - p1x) * (p4y - p3y) - (p2y - p1y) * (p4x - p3x);
        if (d === 0) return false;
        var t = ((p3x - p1x) * (p4y - p3y) - (p3y - p1y) * (p4x - p3x)) / d;
        var u = ((p3x - p1x) * (p2y - p1y) - (p3y - p1y) * (p2x - p1x)) / d;
        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
      }
      return segSeg(ax, ay, bx, by, r.x0, r.y0, r.x1, r.y0) ||
             segSeg(ax, ay, bx, by, r.x1, r.y0, r.x1, r.y1) ||
             segSeg(ax, ay, bx, by, r.x1, r.y1, r.x0, r.y1) ||
             segSeg(ax, ay, bx, by, r.x0, r.y1, r.x0, r.y0);
    }
    // 框选落地：世界矩形与建筑/矿脉 AABB、传送带几何段求交 → 选中集合
    function applyBoxSelect(x0, y0, x1, y1) {
      var r = {
        x0: Math.min(x0, x1), y0: Math.min(y0, y1),
        x1: Math.max(x0, x1), y1: Math.max(y0, y1)
      };
      var st = app.state || {};
      var found = [];
      var ids, i, n;
      var bs = st.buildings || {};
      ids = Object.keys(bs);
      for (i = 0; i < ids.length; i++) {
        n = bs[ids[i]];
        if (n.x + BLOCK_HALF >= r.x0 && n.x - BLOCK_HALF <= r.x1 &&
            n.y + BLOCK_HALF >= r.y0 && n.y - BLOCK_HALF <= r.y1) {
          found.push({ kind: 'building', id: ids[i] });
        }
      }
      var vs = st.veins || {};
      ids = Object.keys(vs);
      for (i = 0; i < ids.length; i++) {
        n = vs[ids[i]];
        if (n.x + BLOCK_HALF >= r.x0 && n.x - BLOCK_HALF <= r.x1 &&
            n.y + BLOCK_HALF >= r.y0 && n.y - BLOCK_HALF <= r.y1) {
          found.push({ kind: 'vein', id: ids[i] });
        }
      }
      var belts = st.belts || {};
      var bks = Object.keys(belts);
      for (i = 0; i < bks.length; i++) {
        var bl = belts[bks[i]];
        var f = nodeById(bl.fromId), t = nodeById(bl.toId);
        if (!f || !t) continue;
        if (segIntersectsRect(f.node.x, f.node.y, t.node.x, t.node.y, r)) {
          found.push({ kind: 'belt', id: bks[i] });
        }
      }
      if (found.length === 1) {
        select(found[0].kind, found[0].id); // 单一命中 → 走常规单选（检查器直接显示详情）
        return;
      }
      app.selected = null;
      app.selectedSet = found.length ? found : null;
      if (typeof app.refreshUI === 'function') { try { app.refreshUI(); } catch (e2) { /* 忽略 */ } }
    }

    /* ---------------- 长按（触摸快捷菜单，仅建筑） ---------------- */
    function clearLongPress() {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }
    function armLongPress(kind, id, e) {
      clearLongPress();
      longPressFired = false;
      if (e.pointerType !== 'touch' || kind !== 'building') return;
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        longPressFired = true;
        var UI = global.DSP_UI;
        if (UI && typeof UI.openQuickMenu === 'function') {
          select(kind, id);
          UI.openQuickMenu(id);
        }
      }, LONG_PRESS_MS);
    }

    /* ---------------- 指针事件 ---------------- */
    function localPos(e) {
      var rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function twoPointerInfo() {
      var arr = [];
      pointers.forEach(function (p) { arr.push(p); });
      if (arr.length < 2) return null;
      var a = arr[0], b = arr[1];
      return {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2
      };
    }

    function onPointerDown(e) {
      if (e.button === 2) return; // 右键交给 contextmenu 取消模式
      var pos = localPos(e);
      hideCardRecipeMenu(); // 相机/手势即将变化 → 收起画布配方下拉
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 某些环境可能失败 */ }
      pointers.set(e.pointerId, { x: pos.x, y: pos.y, startX: pos.x, startY: pos.y, moved: false });

      // 进入双指 → 无条件切换为捏合
      var two = twoPointerInfo();
      if (two) {
        clearLongPress();
        gesture = { type: 'pinch', lastDist: two.dist, lastMidX: two.midX, lastMidY: two.midY };
        app._dragMove = null;
        return;
      }

      var wp = worldAt(pos.x, pos.y);

      // place 模式：按下即记录（松手时位移极小则放置），空白拖动仍可平移
      if (app.mode === 'place' && app.placeType) {
        gesture = { type: 'place', lastX: pos.x, lastY: pos.y, startX: pos.x, startY: pos.y };
        return;
      }

      // 端口拖线（v2：输出口与输入口均可起拖；类型不匹配只是松手连接失败，线仍可拉出）
      var portHit = outPortAt(wp.x, wp.y) || inPortAt(wp.x, wp.y);
      if (portHit) {
        // 点落在端口圈 ∩ 带走廊：带更近 → 待定带点击（轻点选中带，拖拽转连线）
        var beltNear = beltAt(wp.x, wp.y);
        var pp = portPoint(portHit);
        var portD = pp ? Math.hypot(wp.x - pp.x, wp.y - pp.y) : Infinity;
        if (beltNear && beltNear.dist < portD) {
          gesture = { type: 'beltTap', id: beltNear.belt.id, fromId: portHit.id, fromPort: portHit.port || 'out', startX: pos.x, startY: pos.y, dragging: false };
          return;
        }
        gesture = { type: 'connect', fromId: portHit.id, fromPort: portHit.port || 'out', startX: pos.x, startY: pos.y, dragging: false };
        armLongPress(portHit.kind, portHit.id, e);
        return;
      }

      // 建筑卡输入/输出行拾取（搬运材料：松手在库存面板 → withdrawFromStock；
      // src='out' 时从输出缓存回收产物，对齐参考 pickFromEntityInput）
      var ri0 = rinst();
      var rowHit = (ri0 && ri0.hitIORow) ? ri0.hitIORow(wp.x, wp.y) : null;
      if (rowHit && app.state && app.state.buildings && app.state.buildings[rowHit.buildingId]) {
        var gb0 = app.state.buildings[rowHit.buildingId];
        var gbuf0 = rowHit.src === 'out' ? (gb0.outBuf || {}) : (gb0.inBuf || {});
        if (Math.floor(gbuf0[rowHit.itemId] || 0) > 0) {
          gesture = { type: 'carry', id: rowHit.buildingId, itemId: rowHit.itemId, src: rowHit.src, startX: pos.x, startY: pos.y, dragging: false };
          return;
        }
      }

      // 方块拖动换位
      var hit = nodeHitAt(wp.x, wp.y);
      if (hit) {
        armLongPress(hit.kind, hit.id, e);
        gesture = { type: 'move', kind: hit.kind, id: hit.id, startX: pos.x, startY: pos.y, dragging: false };
        return;
      }

      // 空白处：鼠标左键拖拽 → 框选；鼠标中/右键与触摸单指 → 平移
      if (app.mode === 'select' && !app.placeType && e.pointerType === 'mouse' &&
          (e.button == null || e.button === 0)) {
        gesture = { type: 'box', startX: pos.x, startY: pos.y };
        app._boxSel = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
        return;
      }
      if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2) && e.preventDefault) {
        e.preventDefault(); // 中键防自动滚动；右键菜单已在 contextmenu 拦截
      }
      gesture = { type: 'pan', lastX: pos.x, lastY: pos.y, startX: pos.x, startY: pos.y };
    }

    function onPointerMove(e) {
      var p = pointers.get(e.pointerId);
      if (!p) return;
      var pos = localPos(e);
      if (Math.abs(pos.x - p.startX) > 6 || Math.abs(pos.y - p.startY) > 6) p.moved = true;

      if (gesture && gesture.type === 'pinch') {
        p.x = pos.x; p.y = pos.y;
        var two = twoPointerInfo();
        if (!two) return;
        if (gesture.lastDist > 0) {
          app.camera.zoomAt(two.midX, two.midY, two.dist / gesture.lastDist);
        }
        app.camera.panBy(two.midX - gesture.lastMidX, two.midY - gesture.lastMidY);
        gesture.lastDist = two.dist;
        gesture.lastMidX = two.midX;
        gesture.lastMidY = two.midY;
        return;
      }

      if (!gesture) { p.x = pos.x; p.y = pos.y; return; }

      if (gesture.type === 'box') {
        p.x = pos.x; p.y = pos.y;
        app._boxSel = { x0: gesture.startX, y0: gesture.startY, x1: pos.x, y1: pos.y };
        return;
      }

      if (gesture.type === 'pan' || gesture.type === 'place') {
        app.camera.panBy(pos.x - gesture.lastX, pos.y - gesture.lastY);
        gesture.lastX = pos.x;
        gesture.lastY = pos.y;
        return;
      }

      if (gesture.type === 'move') {
        p.x = pos.x; p.y = pos.y;
        var dist = Math.hypot(pos.x - gesture.startX, pos.y - gesture.startY);
        if (!gesture.dragging && dist > DRAG_SLOP) {
          clearLongPress();
          gesture.dragging = true;
          select(gesture.kind, gesture.id);
        }
        if (gesture.dragging) {
          var wp = worldAt(pos.x, pos.y);
          app._dragMove = { id: gesture.id, x: snapW(wp.x), y: snapW(wp.y) };
        }
        return;
      }

      if (gesture.type === 'beltTap') {
        p.x = pos.x; p.y = pos.y;
        var dTap = Math.hypot(pos.x - gesture.startX, pos.y - gesture.startY);
        if (!gesture.dragging && dTap > DRAG_SLOP) {
          // 拖拽 → 转为从端口起手的连线
          clearLongPress();
          gesture.dragging = true;
          gesture.type = 'connect';
          var fn2 = nodeById(gesture.fromId);
          if (fn2) select(fn2.kind, gesture.fromId);
          app.connectFrom = gesture.fromId;
          app.mode = 'connect';
          app.placeType = null;
          if (typeof app.refreshUI === 'function') { try { app.refreshUI(); } catch (err) { /* 忽略 */ } }
        }
        // 未转类型则继续等待；转了则落入下方 connect 分支处理本帧
      }

      if (gesture.type === 'carry') {
        p.x = pos.x; p.y = pos.y;
        var dC = Math.hypot(pos.x - gesture.startX, pos.y - gesture.startY);
        if (!gesture.dragging && dC > DRAG_SLOP) {
          gesture.dragging = true;
          var cb = app.state && app.state.buildings ? app.state.buildings[gesture.id] : null;
          var cbuf = cb ? (gesture.src === 'out' ? (cb.outBuf || {}) : (cb.inBuf || {})) : null;
          app._carried = {
            sourceId: gesture.id, itemId: gesture.itemId, src: gesture.src || 'in',
            amount: Math.floor((cbuf && cbuf[gesture.itemId]) || 0)
          };
          select('building', gesture.id);
        }
        if (gesture.dragging) {
          app._carriedPos = { sx: pos.x, sy: pos.y };
          setStockDropHint(overStockPanel(e)); // 悬停库存面板 → 高亮提示可投放
        }
        return;
      }

      if (gesture.type === 'connect') {
        p.x = pos.x; p.y = pos.y;
        var d2 = Math.hypot(pos.x - gesture.startX, pos.y - gesture.startY);
        if (!gesture.dragging && d2 > DRAG_SLOP) {
          clearLongPress();
          gesture.dragging = true;
          select(nodeById(gesture.fromId).kind, gesture.fromId);
          app.connectFrom = gesture.fromId;
          app.mode = 'connect';
          app.placeType = null;
          if (typeof app.refreshUI === 'function') { try { app.refreshUI(); } catch (err) { /* 忽略 */ } }
        }
        if (gesture.dragging) {
          // 识别中的端口高亮：起手端口 → 拖拽中随候选目标切换（对齐参考 connectionCandidateNode）
          var riC = rinst();
          if (riC && riC.setPortHighlight) {
            var wpC = worldAt(pos.x, pos.y);
            var cand = gesture.fromPort === 'in' ? outPortAt(wpC.x, wpC.y) : inPortAt(wpC.x, wpC.y);
            riC.setPortHighlight(cand || { kind: (nodeById(gesture.fromId) || {}).kind, id: gesture.fromId, port: gesture.fromPort || 'out' });
          }
        }
        return;
      }

      p.x = pos.x; p.y = pos.y;
    }

    function snapW(v) { return Math.round(v / SNAP_GRID) * SNAP_GRID; }

    // 指针是否悬停在侧栏库存面板上（搬运材料的投放判定）
    function overStockPanel(e) {
      var el = (typeof document !== 'undefined' && document.elementFromPoint)
        ? document.elementFromPoint(e.clientX, e.clientY) : null;
      return !!(el && el.closest && el.closest('#stock, .stock-list'));
    }
    function setStockDropHint(on) {
      if (typeof document === 'undefined') return;
      var list = document.querySelector('.stock-list');
      if (list) list.classList.toggle('drop-hint', !!on);
    }

    function finishGesture(e) {
      var p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      clearLongPress();
      var riE = rinst();
      if (riE && riE.setPortHighlight) riE.setPortHighlight(null); // 手势结束 → 清除端口识别高亮
      if (!gesture) return;
      if (!p) { gesture = null; return; }

      if (gesture.type === 'carry') {
        var cItem = gesture.itemId, cSrc = gesture.id, cDrag = gesture.dragging, cBuf = gesture.src || 'in';
        setStockDropHint(false);
        app._carried = null;
        app._carriedPos = null;
        gesture = null;
        if (!cDrag) { handleClickOnNode('building', cSrc, p.x, p.y); return; } // 未超过位移阈值 → 视为点击卡片
        if (overStockPanel(e)) {
          var E = engine();
          var resW = (E && E.withdrawFromStock)
            ? E.withdrawFromStock(app.state, app.content, cSrc, cItem, undefined, cBuf) : { ok: false, reason: 'nothingToWithdraw' };
          if (app.toast) {
            if (resW.ok) {
              var itW = ((app.content || {}).ITEMS || {})[cItem] || {};
              app.toast(global.DSP_I18N.t('stock.withdrawOk', { n: Math.floor(resW.moved || 0), item: itW.name || cItem }));
            } else {
              app.toast(global.DSP_I18N.t('stock.dropFail') + '：' + reasonText(resW.reason));
            }
          }
          if (resW.ok && typeof app.refreshUI === 'function') { try { app.refreshUI(); } catch (errW) { /* 忽略 */ } }
        }
        return;
      }

      if (gesture.type === 'pinch') {
        // 剩余一根手指 → 转为平移
        var rest = null;
        pointers.forEach(function (rp) { if (!rest) rest = rp; });
        if (rest && e.type !== 'pointercancel') {
          gesture = { type: 'pan', lastX: rest.x, lastY: rest.y, startX: rest.x, startY: rest.y };
        } else {
          gesture = null;
        }
        return;
      }

      if (gesture.type === 'box') {
        var rect = app._boxSel;
        app._boxSel = null;
        gesture = null;
        if (!rect) return;
        var movedBox = Math.hypot(rect.x1 - rect.x0, rect.y1 - rect.y0);
        if (movedBox < CLICK_SLOP) { handleClick(p.x, p.y); return; } // 位移过小视为点击
        var w0 = worldAt(rect.x0, rect.y0), w1 = worldAt(rect.x1, rect.y1);
        applyBoxSelect(w0.x, w0.y, w1.x, w1.y);
        return;
      }

      if (gesture.type === 'pan' || gesture.type === 'place') {
        var moved = Math.hypot(p.x - gesture.startX, p.y - gesture.startY);
        if (moved < CLICK_SLOP) handleClick(p.x, p.y);
        gesture = null;
        return;
      }

      if (gesture.type === 'move') {
        if (longPressFired) { longPressFired = false; gesture = null; return; }
        if (!gesture.dragging) {
          handleClickOnNode(gesture.kind, gesture.id, p.x, p.y);
        } else {
          var wp = worldAt(p.x, p.y);
          var res = doMove(gesture.id, snapW(wp.x), snapW(wp.y));
          if (res && !res.ok && app.toast) {
            app.toast(global.DSP_I18N.t('toast.moveFail', { reason: reasonText(res.reason) }));
          }
          app._dragMove = null;
          if (typeof app.refreshUI === 'function') { try { app.refreshUI(); } catch (err) { /* 忽略 */ } }
        }
        gesture = null;
        return;
      }

      if (gesture.type === 'beltTap') {
        if (longPressFired) { longPressFired = false; gesture = null; return; }
        if (!gesture.dragging) select('belt', gesture.id); // 轻点带走廊 → 选中传送带
        gesture = null;
        return;
      }

      if (gesture.type === 'connect') {
        if (longPressFired) { longPressFired = false; gesture = null; return; }
        if (gesture.dragging) {
          var wp2 = worldAt(p.x, p.y);
          var target = nodeHitAt(wp2.x, wp2.y);
          var fromNode = nodeById(gesture.fromId);
          if (target && String(target.id) !== String(gesture.fromId)) {
            if (target.kind !== 'building') {
              if (app.toast) app.toast(global.DSP_I18N.t('toast.connectFail', { reason: reasonText('itemMismatch') }));
            } else {
              // 从输入口起拖 → 反转方向（目标输出 → 源输入）；
              // 从输出口起拖 → 正向（源输出 → 目标输入）
              var cFrom = gesture.fromPort === 'in' ? target.id : gesture.fromId;
              var cTo = gesture.fromPort === 'in' ? gesture.fromId : target.id;
              var res = doConnect(cFrom, cTo);
              if (app.toast) {
                app.toast(res && res.ok
                  ? global.DSP_I18N.t('toast.connected')
                  : global.DSP_I18N.t('toast.connectFail', { reason: reasonText(res && res.reason) }));
              }
            }
          } else if (!target && fromNode && fromNode.kind === 'vein') {
            // 拖到空白处：矿脉跟随移动（矿脉可拖动）
            var w2 = wp2;
            doMove(gesture.fromId, snapW(w2.x), snapW(w2.y));
          }
          setMode(app, 'select');
        } else {
          // 原地点击输出口 → 视为点击方块选中
          handleClickOnNode(nodeById(gesture.fromId).kind, gesture.fromId, p.x, p.y);
        }
        gesture = null;
        return;
      }
      gesture = null;
    }

    /* ---------------- 点击语义 ---------------- */
    function handleClick(sx, sy) {
      var wp = worldAt(sx, sy);

      // v2：点击已选中矿脉卡片上的「🖐 采集」按钮 → 一键手动采集
      if (app.mode === 'select' && app.selected && app.selected.kind === 'vein') {
        var hitNode = nodeHitAt(wp.x, wp.y);
        if (hitNode && String(hitNode.id) === String(app.selected.id)) {
          var R = global.DSP_RENDERER && global.DSP_RENDERER.instance;
          if (R && typeof R.hitVeinMineButton === 'function') {
            var mineHit = R.hitVeinMineButton(wp.x, wp.y);
            if (mineHit) {
              var mres = callApp('manualMine', [mineHit], function () {
                var E = engine();
                return E ? E.manualMine(app.state, app.content, mineHit) : { ok: false };
              });
              if (app.toast) {
                var vItem = app.state.veins[mineHit] && app.state.veins[mineHit].itemId;
                var itDef = (app.content.ITEMS || {})[vItem] || {};
                app.toast(mres && mres.ok
                  ? global.DSP_I18N.t('toast.mined', { n: mres.gained, name: itDef.name || vItem })
                  : global.DSP_I18N.t('toast.placeFail', { reason: reasonText(mres && mres.reason) }));
              }
              return;
            }
          }
        }
      }

      var hit = nodeHitAt(wp.x, wp.y);

      if (app.mode === 'place' && app.placeType) {
        if (app.placeType === 'belt') {
          // 两段式：起点（建筑/矿脉）→ 终点（建筑）
          if (!hit) return;
          if (!app.connectFrom) {
            app.connectFrom = hit.id;
            if (app.toast) app.toast(global.DSP_I18N.t('hint.placeBelt2'));
          } else if (String(hit.id) === String(app.connectFrom)) {
            app.connectFrom = null;
          } else if (hit.kind !== 'building') {
            if (app.toast) app.toast(global.DSP_I18N.t('toast.connectFail', { reason: reasonText('itemMismatch') }));
          } else {
            var res = doConnect(app.connectFrom, hit.id);
            if (app.toast) {
              app.toast(res && res.ok
                ? global.DSP_I18N.t('toast.connected')
                : global.DSP_I18N.t('toast.connectFail', { reason: reasonText(res && res.reason) }));
            }
            app.connectFrom = null;
          }
          return;
        }
        // 放置（吸附网格；采矿机由引擎吸附到最近矿脉）
        var wx = snapW(wp.x), wy = snapW(wp.y);
        var res2 = doPlace(app.placeType, wx, wy);
        if (res2 && !res2.ok && app.toast) {
          app.toast(global.DSP_I18N.t('toast.placeFail', { reason: reasonText(res2.reason) }));
        } else {
          // Bug3 修复：放置成功后自动退出 place 模式，无需右键
          setMode(app, 'select');
        }
        return;
      }

      if (hit) { select(hit.kind, hit.id); return; }

      var beltHit = beltAt(wp.x, wp.y);
      if (beltHit) { select('belt', beltHit.belt.id); return; }

      // 空白：取消选中（含框选集合）
      if (app.selected || app.selectedSet) {
        app.selected = null;
        app.selectedSet = null;
        if (typeof app.refreshUI === 'function') { try { app.refreshUI(); } catch (e2) { /* 忽略 */ } }
      }
    }

    function handleClickOnNode(kind, id, sx, sy) {
      if (app.mode === 'place' && app.placeType && app.placeType !== 'belt') {
        // 放置模式下点到方块也照常放置（引擎校验吸附/重叠/科技）
        var wp = worldAt(sx, sy);
        doPlace(app.placeType, snapW(wp.x), snapW(wp.y));
        return;
      }
      if (app.mode === 'place' && app.placeType === 'belt') {
        if (!app.connectFrom) {
          app.connectFrom = id;
          if (app.toast) app.toast(global.DSP_I18N.t('hint.placeBelt2'));
        } else if (String(id) !== String(app.connectFrom)) {
          if (kind !== 'building') {
            if (app.toast) app.toast(global.DSP_I18N.t('toast.connectFail', { reason: reasonText('itemMismatch') }));
          } else {
            var res = doConnect(app.connectFrom, id);
            if (app.toast) {
              app.toast(res && res.ok
                ? global.DSP_I18N.t('toast.connected')
                : global.DSP_I18N.t('toast.connectFail', { reason: reasonText(res && res.reason) }));
            }
            app.connectFrom = null;
          }
        }
        return;
      }
      // === 点击已选中矿脉的「采集」按钮 ===
      if (app.mode === 'select' && kind === 'vein' && app.selected &&
          String(app.selected.id) === String(id)) {
        var wp2 = worldAt(sx, sy);
        var R = global.DSP_RENDERER && global.DSP_RENDERER.instance;
        if (R && typeof R.hitVeinMineButton === 'function') {
          var mineHit = R.hitVeinMineButton(wp2.x, wp2.y);
          if (mineHit) {
            var mres = callApp('manualMine', [mineHit], function () {
              var E = engine();
              return E ? E.manualMine(app.state, app.content, mineHit) : { ok: false };
            });
            if (app.toast) {
              var vItem = app.state.veins[mineHit] && app.state.veins[mineHit].itemId;
              var itDef = (app.content.ITEMS || {})[vItem] || {};
              app.toast(mres && mres.ok
                ? global.DSP_I18N.t('toast.mined', { n: mres.gained, name: itDef.name || vItem })
                : global.DSP_I18N.t('toast.placeFail', { reason: reasonText(mres && mres.reason) }));
            }
            return;
          }
        }
      }
      // 选中；若点在建筑卡「配方行」上 → 弹出画布上的配方下拉
      select(kind, id);
      if (kind === 'building') {
        var wpR = worldAt(sx, sy);
        var Rr = global.DSP_RENDERER && global.DSP_RENDERER.instance;
        if (Rr && typeof Rr.hitRecipeRow === 'function' &&
            Rr.hitRecipeRow(wpR.x, wpR.y) === String(id) &&
            global.DSP_UI && typeof global.DSP_UI.showCardRecipeMenu === 'function') {
          global.DSP_UI.showCardRecipeMenu(id);
        }
      }
    }

    function reasonText(reason) {
      if (!reason) return global.DSP_I18N.t('reason.unknown');
      var key = 'reason.' + reason;
      var txt = global.DSP_I18N.t(key);
      return (txt === key) ? reason : txt;
    }

    /* ---------------- 滚轮 / 右键 ---------------- */
    function onWheel(e) {
      e.preventDefault();
      var pos = localPos(e);
      var factor = Math.exp(-e.deltaY * WHEEL_FACTOR);
      app.camera.zoomAt(pos.x, pos.y, factor);
    }
    function onContextMenu(e) {
      e.preventDefault();
      cancelToSelect(app);
    }

    /* ---------------- 键盘 ---------------- */
    function isTypingTarget(el) {
      if (!el) return false;
      var tag = (el.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
    }
    function onKeyDown(e) {
      if (isTypingTarget(e.target)) return;
      var I18N = global.DSP_I18N;

      if (e.key === 'Escape') {
        var UI = global.DSP_UI;
        var closed = false;
        if (UI && typeof UI.escapeTop === 'function') closed = !!UI.escapeTop();
        if (!closed && app.mode !== 'select') { cancelToSelect(app); e.preventDefault(); }
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        app.paused = !app.paused;
        if (app.toast) app.toast(I18N.t(app.paused ? 'toast.paused' : 'toast.resumed'));
        if (typeof app.refreshUI === 'function') { try { app.refreshUI(); } catch (err) { /* 忽略 */ } }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (app.selected) {
          e.preventDefault();
          doRemoveSelected();
          if (app.toast) app.toast(I18N.t('toast.removed'));
        }
        return;
      }
      var digit = /^([1-9])$/.exec(e.key);
      if (digit) {
        var order = (app.content && app.content.BUILDING_ORDER) || [];
        var idx = parseInt(digit[1], 10) - 1;
        if (idx < order.length) {
          var typeId = order[idx];
          app.mode = 'place';
          app.placeType = typeId;
          app.selected = null;
          app.connectFrom = null;
          var UI2 = global.DSP_UI;
          if (UI2 && typeof UI2.highlightPlace === 'function') UI2.highlightPlace(typeId);
          if (typeof app.refreshUI === 'function') { try { app.refreshUI(); } catch (err) { /* 忽略 */ } }
        }
      }
    }

    /* ---------------- 挂载 ---------------- */
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', finishGesture);
    canvas.addEventListener('pointercancel', finishGesture);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    global.addEventListener('keydown', onKeyDown);

    return function detach() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', finishGesture);
      canvas.removeEventListener('pointercancel', finishGesture);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      global.removeEventListener('keydown', onKeyDown);
    };
  }

  global.DSP_INPUT = {
    attach: attach
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.DSP_INPUT;
  }
})(globalThis);
