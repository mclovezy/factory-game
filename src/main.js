/* =========================================================================
 * DSP_BOOT — 外壳 / 装配 / 主循环  src/main.js
 * 团队契约 SPEC §4 §6 + SPEC-v2 §1 §5（D 外壳）—— 经典脚本挂载 globalThis.DSP_BOOT（含 boot()）
 * -------------------------------------------------------------------------
 * 职责划分（与 DSP_UI/DSP_INPUT 的实际实现联调对齐）：
 *  - D 组装 app 门面（SPEC §4 形状 + 视图层实际消费的命令面）：
 *      字段：content/state/camera/paused/speed/mode/placeType/beltTier/
 *            selected/connectFrom/menuOpen/_fps
 *      方法：toast/refreshUI + 命令代理 place/remove/connect/setRecipe/
 *            setBeltTier/removeBelt/research/travel/launchSail/launchRocket +
 *            v2 新增 move（moveBuilding：建筑/矿脉通用拖动换位）与
 *            manualMine（手动采集：引擎结算 + toast + refreshUI） +
 *            存档编排 save/saveToSlot/newGame/loadSlot/loadState
 *    所有代理经 DSP_ENGINE 调用，!ok 的 reason 经 DSP_I18N 翻译成 toast。
 *  - DOM 事件绑定与顶栏/状态栏/面板文本刷新由 DSP_UI 负责（init 内绑定并
 *    通过 app.refreshUI()/300ms 兜底自刷）；主循环只调 DSP_UI.refresh() 并
 *    提供 app._fps。main.js 不再重复绑定 btn-menu/btn-pause/btn-speed/
 *    workspace-tabs/导入导出/新建等（避免双绑定），仅绑定 C 未绑的 #btn-help。
 *  - 主菜单：boot 时调 DSP_UI.openMenu() 打开（槽位渲染/新建/继续由 DSP_UI
 *    完成，经 app.newGame / app.loadSlot / app.saveToSlot 回到外壳）。
 *  - v2 存档闸门：DSP_SAVE 只认 version===2 的槽位（旧档在记录层即被忽略，
 *    槽位显示为可覆盖）；loadSlot 对「版本过旧」与「损坏」分别提示
 *    「存档版本过旧，已忽略」/「存档载入失败」；boot 时扫描一次槽位，
 *    发现旧档即 toast 一次，避免用户困惑。
 *  - 继续 / 载入 / 导入统一走 loadState()：DSP_ENGINE.settleOffline
 *    （引擎内部上限 8h）→ DSP_UI.showOffline(report) 离线产出报告。
 *  - boot 的空工厂备胎 = DSP_ENGINE.createInitialState(content, home)：
 *    天然 v2 结构（veins 模型），保证主菜单期间渲染/输入安全。
 *  - 主循环：requestAnimationFrame + accumulator 固定步长 1/DSP_ENGINE.SIM_HZ，
 *    每帧最多 8 步；paused 或主菜单打开（#menu-overlay.open）时跳过模拟但仍
 *    渲染；speed 倍率乘进 accumulator。每秒更新 app._fps 并调 DSP_UI.refresh()；
 *    每 60s 自动存档到 slot-autosave（仅唯一存档槽）；beforeunload /
 *    切后台各自动存档一次（try/catch）。
 *  - 装配顺序契约（index.html 同序）：DSP_CONTENT → DSP_ENGINE → DSP_I18N →
 *    DSP_CAMERA → DSP_RENDERER → DSP_INPUT → DSP_UI → DSP_SAVE → 本文件。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ============================ 小工具 ============================ */

  function $(id) { return document.getElementById(id); }

  function i18nT(key) {
    try {
      if (global.DSP_I18N && typeof global.DSP_I18N.t === 'function') {
        var s = global.DSP_I18N.t(key);
        if (typeof s === 'string' && s && s !== key) return s;
      }
    } catch (e) { /* i18n 未就绪时走兜底 */ }
    return null;
  }

  // 命令 reason 兜底文案（DSP_I18N 缺 key 时使用；key 列表来自引擎 errR）
  var REASON_FALLBACK = {
    unknownBuilding: '未知建筑',
    techLocked: '科技尚未解锁',
    notOnOre: '采矿机必须放置在矿脉上',
    notOnVein: '采矿机必须放置在矿脉上',
    wrongMinerForVein: '这台设备采不了这种资源，请换对应的开采设备',
    mixedMinerType: '同一条矿脉只能用同一种开采设备',
    buildingNotFound: '未找到目标建筑',
    veinNotFound: '未找到目标矿脉',
    occupied: '该位置已被其他方块占用',
    itemMismatch: '物品类型不匹配，无法连接',
    invalidTarget: '无效的连接目标',
    selfConnect: '不能连接到自身',
    invalidTier: '无效的传送带等级',
    duplicateBelt: '两者之间已存在传送带',
    unknownRecipe: '未知配方',
    wrongBuilding: '该建筑无法执行此配方',
    beltNotFound: '未找到传送带',
    unknownTech: '未知科技',
    techUnlocked: '该科技已完成',
    techPrerequisite: '前置科技尚未完成',
    notEnoughScience: '科研矩阵不足',
    noSailItem: '缺少太阳帆物品定义',
    noSail: '库存中没有太阳帆',
    noRocketItem: '缺少火箭物品定义',
    noRocket: '库存中没有火箭',
    unknownPlanet: '未知星球',
    systemLocked: '该星系尚未解锁',
    unknownCommand: '该命令在当前引擎版本不可用',
    saveFailed: '存档保存失败',
    exportFailed: '导出存档失败',
    importFailed: '导入存档失败'
  };

  function translateReason(res) {
    var reason = res && res.reason ? String(res.reason) : 'unknownError';
    var s = i18nT('reason.' + reason);
    return s || REASON_FALLBACK[reason] || reason;
  }

  // SPEC 约定 home 行星：优先 id==='home'，其次 isHome 标记，最后第一个。
  function homePlanetId(content) {
    var planets = (content && content.PLANETS) || {};
    if (planets['home']) return 'home';
    var ids = Object.keys(planets);
    for (var i = 0; i < ids.length; i++) {
      if (planets[ids[i]] && planets[ids[i]].isHome) return ids[i];
    }
    return ids[0] || 'home';
  }

  /* ============================ 模块级状态 ============================ */

  var app = null;          // app 门面（SPEC §4 + 视图层命令面）
  var refs = {};           // 缓存的 DOM refs
  var lastAutosaveMs = 0;  // 上次自动存档（Date.now ms）
  var AUTOSAVE_INTERVAL_MS = 60000;

  /* ============================ app 门面 ============================ */

  function resetSelection() {
    app.mode = 'select';
    app.placeType = null;
    app.selected = null;
    app.connectFrom = null;
  }

  // 标记“本会话已激活”（新建/读档/导入过），自动存档只保存激活过的工厂，
  // 避免启动菜单阶段用空工厂覆盖 slot-autosave。
  function markLive(st) {
    try { st.__live = true; } catch (e) { /* ignore */ }
    return st;
  }

  function buildApp(content, camera) {
    var a = {
      content: content,
      state: null,
      camera: camera,
      paused: false,
      speed: 1,
      mode: 'select',
      placeType: null,
      beltTier: 1,
      selected: null,
      connectFrom: null,
      menuOpen: false,
      _fps: null,

      toast: function (msg) { toast(msg); },
      refreshUI: function () { refreshUI(); },

      /* ---- 命令代理（DSP_ENGINE 命令 + !ok 时 reason → toast）---- */
      place: function (typeId, x, y) {
        return runCmd(global.DSP_ENGINE.placeBuilding(a.state, a.content, { typeId: typeId, x: x, y: y }));
      },
      remove: function (id) {
        return runCmd(global.DSP_ENGINE.removeBuilding(a.state, a.content, id));
      },
      move: function (id, x, y) {
        return runCmd(global.DSP_ENGINE.moveBuilding(a.state, a.content, id, x, y));
      },
      manualMine: function (veinId) {
        return runCmd(global.DSP_ENGINE.manualMine(a.state, a.content, veinId));
      },
      connect: function (fromId, toId) {
        return runCmd(global.DSP_ENGINE.connectBelt(a.state, a.content, { fromId: fromId, toId: toId, tier: a.beltTier }));
      },
      setRecipe: function (buildingId, recipeId) {
        return runCmd(global.DSP_ENGINE.setRecipe(a.state, a.content, buildingId, recipeId));
      },
      setBeltTier: function (beltId, tier) {
        return runCmd(global.DSP_ENGINE.setBeltTier(a.state, a.content, beltId, tier));
      },
      removeBelt: function (beltId) {
        return runCmd(global.DSP_ENGINE.removeBelt(a.state, a.content, beltId));
      },
      research: function (techId) {
        return runCmd(global.DSP_ENGINE.startResearch(a.state, a.content, techId));
      },
      travel: function (planetId) {
        var r = runCmd(global.DSP_ENGINE.travelTo(a.state, a.content, planetId));
        if (r && r.ok) resetSelection();
        return r;
      },
      launchSail: function () {
        return runCmd(global.DSP_ENGINE.launchSail(a.state, a.content));
      },
      launchRocket: function () {
        return runCmd(global.DSP_ENGINE.launchRocket(a.state, a.content));
      },

      /* ---- 存档编排（DSP_SAVE + DSP_UI 菜单回调）---- */
      save: function (slotId) {
        if (!a.state) return { ok: false, reason: 'saveFailed' };
        var r = global.DSP_SAVE.save(slotId || 'slot-autosave', a.state);
        if (!r || !r.ok) a.toast(translateReason(r));
        return r;
      },
      /** DSP_UI 槽位“存入此槽”按钮：app.saveToSlot(id, state) */
      saveToSlot: function (slotId) {
        var r = a.save(slotId);
        if (r && r.ok) a.toast(i18nT('toast.saved') || '已保存到槽位');
        return r;
      },
      /** DSP_UI “新建工厂”：app.newGame(name)，返回真值表示已处理 */
      newGame: function (name) {
        if (!global.DSP_ENGINE) return false;
        var st = global.DSP_ENGINE.createInitialState(a.content, homePlanetId(a.content));
        st.factoryName = (typeof name === 'string' && name.trim()) ? name.trim() : (i18nT('menu.defaultName') || '新工厂');
        // 初始直接赠送：能一路生产电磁矩阵的完整产线建筑（放到回收库，由玩家摆放并接线）。
        // 矿炼线：采矿机(铁/铜矿)×2、电弧熔炉(铁块/铜块/磁铁)×3、
        //        制造台Mk.I×6（铜线/磁线圈/电路板/齿轮各司其职，三路同时无限产出）、
        //        矩阵研究站×1、风力涡轮机×4。
        // buildingReserve = 已拥有、放置免材料，与拆除回收同一机制。
        st.buildingReserve = st.buildingReserve || {};
        var initReserve = {
          mining_machine: 2, arc_smelter: 3, assembler_mk1: 6,
          matrix_lab: 1, wind_turbine: 4
        };
        for (var bk in initReserve) {
          if (Object.prototype.hasOwnProperty.call(initReserve, bk)) {
            st.buildingReserve[bk] = (st.buildingReserve[bk] || 0) + initReserve[bk];
          }
        }
        a.state = markLive(st);
        resetSelection();
        a.save('slot-autosave'); // 立即入槽，刷新页面可继续
        refreshUI();
        return true;
      },
      /** DSP_UI 槽位“载入”按钮：app.loadSlot(slotId) */
      loadSlot: function (slotId) {
        var st = global.DSP_SAVE ? global.DSP_SAVE.load(slotId) : null;
        if (!st) {
          a.toast(i18nT('menu.loadFailed') || '存档载入失败（可能已损坏）');
          return false;
        }
        return a.loadState(st);
      },
      /** 读档/导入统一入口（DSP_UI.applyLoadedState 探测 loadState/importState/setState） */
      loadState: function (st) {
        if (!st) return false;
        a.state = markLive(st);
        resetSelection();
        // 离线结算：按槽位/导出文件记录的 savedAt 结算离线收益（引擎内限 8h）
        var savedAt = st && st.__savedAt;
        if (typeof savedAt === 'number' && savedAt > 0) {
          var elapsed = Math.max(0, (Date.now() - savedAt) / 1000);
          if (elapsed >= 5 && global.DSP_ENGINE && typeof global.DSP_ENGINE.settleOffline === 'function') {
            try {
              var report = global.DSP_ENGINE.settleOffline(st, a.content, elapsed);
              if (report && global.DSP_UI && typeof global.DSP_UI.showOffline === 'function') {
                global.DSP_UI.showOffline(report);
              }
            } catch (e) {
              console.error('[DSP] 离线结算失败', e);
            }
          }
        }
        refreshUI();
        return true;
      }
    };
    return a;
  }

  function runCmd(res) {
    if (!res) return { ok: false, reason: 'unknownError' };
    if (!res.ok) app.toast(translateReason(res));
    return res;
  }

  /* ============================ 界面刷新 / toast ============================ */

  function toast(msg) {
    var host = refs.toastHost;
    if (!host) { console.log('[toast]', msg); return; }
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = String(msg);
    host.appendChild(el);
    while (host.children.length > 5) host.removeChild(host.firstChild);
    // .toast.show 才可见（CSS 过渡）；淡出后再移除节点
    setTimeout(function () { el.classList.add('show'); }, 20);
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 300);
    }, 2600);
  }

  function refreshUI() {
    // 顶栏/状态栏/检查器/库存/面板的文本与 DOM 全部由 DSP_UI.refresh 负责
    try {
      if (global.DSP_UI && typeof global.DSP_UI.refresh === 'function') {
        global.DSP_UI.refresh(app);
      }
    } catch (e) { /* C 内部异常不应拖垮外壳 */ }
  }

  /* ============================ 自动存档 ============================ */

  function autosave(reasonLabel) {
    if (!app || !app.state || !app.state.__live) return; // 未激活（仍在主菜单）不覆盖 autosave
    try {
      var r = global.DSP_SAVE.save('slot-autosave', app.state);
      if (r && r.ok) {
        app.toast(reasonLabel || i18nT('menu.autosaved') || '已自动存档');
      }
      lastAutosaveMs = Date.now();
    } catch (e) {
      console.error('[DSP] 自动存档失败', e);
    }
  }

  /* ============================ 主循环 ============================ */

  function startLoop(renderer) {
    var engine = global.DSP_ENGINE;
    var step = 1 / engine.SIM_HZ;
    var acc = 0;
    var last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var lastSecAt = last;
    var fpsFrames = 0;

    function menuIsOpen() {
      return !!(refs.menuOverlay && refs.menuOverlay.classList.contains('open'));
    }

    function frame(now) {
      var dtMs = now - last;
      last = now;
      if (!(dtMs > 0)) dtMs = 0;
      if (dtMs > 250) dtMs = 250; // 后台切回大跳保护

      // 固定步长模拟：暂停 / 主菜单打开时跳过模拟但仍渲染
      if (!app.paused && !menuIsOpen()) {
        acc += (dtMs / 1000) * app.speed;
        var steps = 0;
        while (acc >= step && steps < 8) {
          engine.tick(app.state, app.content, step);
          acc -= step;
          steps++;
        }
        if (steps >= 8) acc = 0; // 追不上就丢弃，防死亡螺旋
      } else {
        acc = 0;
      }

      if (renderer && typeof renderer.render === 'function') {
        try { renderer.render(); } catch (e) { /* 渲染异常不中断模拟 */ }
      }

      fpsFrames++;
      if (now - lastSecAt >= 1000) {
        app._fps = Math.round(fpsFrames * 1000 / (now - lastSecAt));
        fpsFrames = 0;
        lastSecAt = now;
        refreshUI(); // DSP_UI.refresh 内部 200ms 节流，负责全部文本/面板
        if (Date.now() - lastAutosaveMs >= AUTOSAVE_INTERVAL_MS) autosave();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ============================ 事件绑定 ============================ */

  function bindEvents() {
    // DSP_UI 已绑定：btn-pause / btn-speed / btn-menu / workspace-tabs /
    // btn-new-save / btn-export / btn-import / import-file / btn-close-* /
    // sidebar-toggle。main.js 只绑定 C 未覆盖的 #btn-help。
    if (refs.btnHelp) {
      refs.btnHelp.addEventListener('click', function () {
        if (global.DSP_UI && typeof global.DSP_UI.openHelp === 'function') {
          global.DSP_UI.openHelp();
        } else if (refs.helpOverlay) {
          refs.helpOverlay.classList.add('open');
        }
      });
    }

    // 关页 / 切后台自动存档（仅当本会话工厂已激活，避免空工厂覆盖 autosave）
    global.addEventListener('beforeunload', function () {
      try {
        if (app && app.state && app.state.__live) global.DSP_SAVE.save('slot-autosave', app.state);
      } catch (e) { /* 卸载阶段尽力而为 */ }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') autosave(i18nT('menu.autosaved') || '已切后台并自动存档');
    });
  }

  /* ============================ 启动 ============================ */

  function collectRefs() {
    refs.canvas = $('canvas');
    refs.menuOverlay = $('menu-overlay');
    refs.helpOverlay = $('help-overlay');
    refs.btnHelp = $('btn-help');
    refs.toastHost = $('toast-host');
  }

  function checkGlobals() {
    var need = ['DSP_CONTENT', 'DSP_ENGINE', 'DSP_SAVE'];
    for (var i = 0; i < need.length; i++) {
      if (!global[need[i]]) console.error('[DSP] 缺少核心全局命名空间：' + need[i]);
    }
    var view = ['DSP_I18N', 'DSP_CAMERA', 'DSP_RENDERER', 'DSP_INPUT', 'DSP_UI'];
    for (var j = 0; j < view.length; j++) {
      if (!global[view[j]]) console.error('[DSP] 视图命名空间缺失（C 未完成或加载顺序错误）：' + view[j]);
    }
  }

  function boot() {
    if (app) return; // 幂等保护
    checkGlobals();
    collectRefs();
    if (!refs.canvas) {
      console.error('[DSP] 找不到 #canvas，启动中止');
      return;
    }

    var content = global.DSP_CONTENT;
    var camera = global.DSP_CAMERA && typeof global.DSP_CAMERA.createCamera === 'function'
      ? global.DSP_CAMERA.createCamera(refs.canvas) : null;

    app = buildApp(content, camera);
    global.DSP_BOOT.app = app; // 调试钩子

    // 先备一个空工厂 state，保证主菜单期间渲染/输入安全；新建/读档时整体替换
    app.state = global.DSP_ENGINE.createInitialState(content, homePlanetId(content));

    // C 视图装配（SPEC §4 契约形状；renderer 实例主循环自用）
    var renderer = null;
    if (global.DSP_RENDERER && typeof global.DSP_RENDERER.createRenderer === 'function') {
      renderer = global.DSP_RENDERER.createRenderer(refs.canvas, app);
      global.DSP_RENDERER.instance = renderer;
    }
    if (global.DSP_INPUT && typeof global.DSP_INPUT.attach === 'function') {
      try { global.DSP_INPUT.attach(refs.canvas, app); } catch (e) { console.error('[DSP] 输入绑定失败', e); }
    }
    if (global.DSP_UI && typeof global.DSP_UI.init === 'function') {
      try { global.DSP_UI.init(app); } catch (e) { console.error('[DSP] UI 初始化失败', e); }
    }

    bindEvents();

    // 存储降级提示（Toy iframe / 隐私模式 localStorage 被禁时 DSP_SAVE 自动转内存）
    if (global.DSP_SAVE && global.DSP_SAVE.degraded) {
      setTimeout(function () {
        app.toast('浏览器存储不可用：存档仅保存在内存中，刷新后将丢失');
      }, 600);
    }

    // 主菜单：启动即打开（槽位/新建/继续的渲染与交互由 DSP_UI 负责）
    if (global.DSP_UI && typeof global.DSP_UI.openMenu === 'function') {
      global.DSP_UI.openMenu();
    } else if (refs.menuOverlay) {
      refs.menuOverlay.classList.add('open'); // DSP_UI 缺席时的兜底
    }
    lastAutosaveMs = Date.now();

    startLoop(renderer);
  }

  global.DSP_BOOT = {
    boot: boot,
    getApp: function () { return app; }
  };

  // DOMContentLoaded 执行 boot（经典脚本置于 body 末尾时 readyState 已是 interactive，直接执行）
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
