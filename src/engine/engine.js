/* =========================================================================
 * DSP_FACTORY 引擎  src/engine/engine.js
 * 团队契约 v1 §3（B 引擎）—— 挂载 globalThis.DSP_ENGINE
 * -------------------------------------------------------------------------
 * 设计要点：
 *  - 纯逻辑零 DOM、确定性模拟（矿脉生成用 planetId 字符串哈希种子，不用 Math.random）。
 *  - 所有 API 显式接收 content（DSP_CONTENT），绝不读取 globalThis.DSP_CONTENT。
 *  - 建筑 = 自由坐标节点；传送带 = 边（from.outBuf → to.inBuf），信贷模型
 *    （借鉴 DSPONLINE transferBelts：无在途物品，按带速攒 credit，直接转移）。
 *  - 电力：ratio = min(1, generation/demand)；family==='solar'（或名称含
 *    solar/太阳）的电厂按行星 solarMultiplier 加成；生产速度 × ratio。
 *  - miner 必须放在矿脉圆内且 remaining>0；产出直接进 outBuf 并扣矿脉储量。
 *  - 机器：输入够 + 输出未满 → progress += speed*ratio/duration，完成扣输入、
 *    产物入 outBuf（lab 的矩阵产物直接汇入 state.scienceStock，不走传送带）。
 *  - dyson 建筑：从 inBuf 按速率自动消耗太阳帆/火箭；launchSail/launchRocket
 *    从 state.stock 手动消耗（stock 是戴森消耗来源，见 SPEC §3 注释）。
 *  - 附加语义（SPEC 未细化、由引擎定义，见汇报）：
 *      * kind='storage'：每 tick 把 inBuf 全部并入 state.stock（入库/银行）。
 *      * kind='station'：inBuf 并入 stock；若设置了配方，则按配方产物从
 *        stock 反向填充 outBuf（全局供货站/商城）。
 *      * 太阳帆/火箭物品识别：ITEMS 中 id/名称匹配 /sail|帆/ 与 /rocket|火箭/，
 *        category==='dyson' 优先。
 *  - state 在契约字段之外附加：buildings.*.accSail/accRocket（戴森发射速率
 *    累计器，小数）、_rateAcc/_rateLog/_beltAcc/_beltLast/_beltItem（统计用
 *    瞬态字段，serialize 时剔除）。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ============================== 常量 ============================== */

  var SIM_HZ = 20;                 // 主模拟频率（D 的 rAF 累加器按 1/SIM_HZ 调 tick）
  var STEP = 1 / SIM_HZ;

  var MINER_CYCLE_SEC = 2;         // 采矿机单周期时长（× speed 倍率）
  var MINER_YIELD = 10;            // 每周期采矿量（同时扣减矿脉 remaining）
  var DEFAULT_INPUT_CAP = 20;      // content 缺 inputCapacity 时的兜底
  var DEFAULT_OUTPUT_CAP = 20;     // content 缺 outputCapacity 时的兜底
  var DEFAULT_BELT_SPEED = 6;      // content.BELTS 缺失时的兜底带速

  var BELT_CREDIT_SEC = 5;         // 信贷结算：单带可提前攒的转运额度上限（秒 × 带速）

  var MACHINE_MAX_CRAFTS = 1000;   // 单 tick 单建筑最大完工次数保护
  var EPS = 1e-9;

  var MAX_OFFLINE_SEC = 8 * 3600;  // 离线结算上限 8h
  var OFFLINE_STEP_SEC = 1;        // 离线近似结算的步长（1s/步，按理论吞吐近似）
  var STOCK_OVERFLOW_CAP = 1000;   // 溢出入库的单种物资库存上限（达到后恢复背压停转）

  var RESEARCH_POINTS_PER_LAB = 3; // 每 lab +3 点/秒
  var RESEARCH_BASE_POINTS = 100;  // 需求 = 100 * (tech.tier + 1)

  var DYSON_SAIL_RATE = 5;         // dyson 建筑自动发射太阳帆速率（个/秒 × ratio）
  var DYSON_ROCKET_RATE = 0.5;     // dyson 建筑自动发射火箭速率（个/秒 × ratio）
  var POINTS_PER_ROCKET = 1;       // 每枚火箭兑换的球面结构点
  var DYSON_SAIL_GOAL = 2000;      // 帆（swarm）满额
  var DYSON_POINT_GOAL = 300;      // 结构点（shell）满额
  var DYSON_SAIL_WEIGHT = 0.4;     // 进度 = 0.4*帆部分 + 0.6*结构点部分

  var MAX_STAR_SYSTEMS = 8;        // SPEC §2：STAR_SYSTEMS = 8
  var RATE_LOG_MAX = 600;          // 产量速率环形日志上限（秒粒度）

  var VEIN_CAP = 300;              // 矿脉输出缓存上限（v2：储量无限，缓存供传送带抽取）
  var MINER_RATE = 5;              // 每台采矿机基础开采速率（物品/秒，×电力比）
  var MINER_DEMAND_KW = 420;       // 每台采矿机耗电（对齐 BUILDINGS.mining_machine）
  var ATTACH_DIST = 75;            // 矿机落脉 / 同型叠加 / 移动判定的吸附与重叠距离

  /* ============================ 小工具 ============================== */

  function round2(v) { return Math.round(v * 100) / 100; }
  function round4(v) { return Math.round(v * 10000) / 10000; }
  function round6(v) { return Math.round(v * 1e6) / 1e6; }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function okR(extra) {
    var r = { ok: true };
    if (extra) { for (var k in extra) { if (extra.hasOwnProperty(k)) r[k] = extra[k]; } }
    return r;
  }
  function errR(reason) { return { ok: false, reason: reason }; }

  function sumBuf(buf) {
    var s = 0;
    for (var k in buf) { if (buf.hasOwnProperty(k)) s += buf[k]; }
    return s;
  }

  function sortedCopy(dict) {
    var out = {}, keys = Object.keys(dict || {}).sort();
    for (var i = 0; i < keys.length; i++) out[keys[i]] = dict[keys[i]];
    return out;
  }

  function deepCopyPlain(obj) { return JSON.parse(JSON.stringify(obj === undefined ? null : obj)); }

  function num(v, dflt) { var n = Number(v); return isNaN(n) ? (dflt || 0) : n; }

  /* --------------------- 确定性 PRNG（字符串种子） --------------------- */

  // xmur3 字符串哈希 → 32bit 种子
  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }

  // mulberry32：确定性 [0,1) 随机流
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* --------------------- content 元信息缓存 --------------------- */
  // 惰性解析一次（矩阵集合 / 帆与火箭 itemId / 带速表 / 太阳能判定），WeakMap 缓存。

  var CACHE = (typeof WeakMap === 'function') ? new WeakMap() : null;

  function buildMeta(content) {
    var meta = { matrix: {}, sailId: null, rocketId: null, tiers: [1], beltSpeed: { 1: DEFAULT_BELT_SPEED }, solarIs: {} };
    var i, t;
    var belts = (content && content.BELTS) || [];
    if (belts.length) {
      meta.tiers = []; meta.beltSpeed = {};
      for (i = 0; i < belts.length; i++) {
        t = num(belts[i].tier, i + 1);
        meta.tiers.push(t);
        meta.beltSpeed[t] = num(belts[i].speed, DEFAULT_BELT_SPEED);
      }
      meta.tiers.sort(function (a, b) { return a - b; });
    }
    var mids = (content && content.MATRIX_ITEM_IDS) || [];
    for (i = 0; i < mids.length; i++) meta.matrix[mids[i]] = true;

    // 帆 / 火箭 itemId 解析：id+名称 匹配关键字，category==='dyson' 或名称含 dyson/戴森 加权
    var items = (content && content.ITEMS) || {};
    var ids = Object.keys(items);
    var bestS = 0, bestR = 0;
    for (i = 0; i < ids.length; i++) {
      var it = items[ids[i]] || {};
      var hay = (ids[i] + ' ' + (it.name || '')).toLowerCase();
      var isDyson = it.category === 'dyson' || /dyson|戴森/.test(hay);
      var s = /sail|帆/.test(hay) ? (isDyson ? 2 : 1) : 0;
      if (s > bestS) { bestS = s; meta.sailId = ids[i]; }
      var r = /rocket|火箭/.test(hay) ? (isDyson ? 2 : 1) : 0;
      if (r > bestR) { bestR = r; meta.rocketId = ids[i]; }
    }

    var bdefs = (content && content.BUILDINGS) || {};
    var bkeys = Object.keys(bdefs);
    for (i = 0; i < bkeys.length; i++) {
      var bd = bdefs[bkeys[i]];
      meta.solarIs[bd.id] = (String(bd.family || '').toLowerCase() === 'solar') ||
        /solar|太阳/i.test(bd.name || '') || /solar/i.test(bd.id || '');
    }
    return meta;
  }

  function cc(content) {
    if (!CACHE) return buildMeta(content);
    var m = CACHE.get(content);
    if (!m) { m = buildMeta(content); CACHE.set(content, m); }
    return m;
  }

  function defOf(content, b) {
    return ((content && content.BUILDINGS) || {})[b.typeId] || null;
  }

  function fuelItemIdOf(content, b) {
    var def = defOf(content || {}, b);
    if (!def || !def.fuel) return null;
    return b.fuelItemId || def.fuel.itemId || null;
  }

  // 燃料燃烧速率（件/秒）：燃料定义带 energyMj 表时按「发电功率 ÷ 燃料能量(MJ×1000)」
  // 计算（对齐 DSP：能量越高的燃料烧得越久），否则退回固定的 def.fuel.burnRate。
  function fuelBurnRateOf(content, def, fuelId) {
    var fuel = def && def.fuel;
    if (!fuel) return 0;
    var mj = fuel.energyMj ? num(fuel.energyMj[fuelId], 0) : 0;
    if (mj > 0) {
      var gen = num(def.powerGenerationKw, 0);
      if (gen > 0) return gen / (mj * 1000);
    }
    return num(fuel.burnRate, 0);
  }
  function capOf(content, b, which, dflt) {
    var def = defOf(content, b);
    var v = def ? def[which] : null;
    if (v == null) return dflt;
    return Math.max(0, num(v, dflt));
  }
  function inputCapOf(content, b) { return capOf(content, b, 'inputCapacity', DEFAULT_INPUT_CAP) * Math.max(1, num(b.count, 1)); }
  function outputCapOf(content, b) { return capOf(content, b, 'outputCapacity', DEFAULT_OUTPUT_CAP) * Math.max(1, num(b.count, 1)); }

  // 输入缓存按「输入种类数」均分：每种物品的上限 = 总容量 / 种类数。
  // 目的：多输入配方里某一路不会把整个缓存吃满（曾出现 240 容量下 A=239、B=1 而卡死）。
  // 有配方 → 按配方 inputs 数量均分；无配方（仓储/物流站/分流器等）→ 按 inBuf 已存
  // 种类数 + 待入物品 1 种 均分（至少 1）。
  function inputSlotCountOf(content, b, itemId) {
    var recipe = (b && b.recipeId) ? ((content.RECIPES || {})[b.recipeId]) : null;
    var n = recipe && recipe.inputs ? recipe.inputs.length : 0;
    if (n > 0) return n;
    n = 0;
    var buf = (b && b.inBuf) || {};
    for (var k in buf) {
      if (Object.prototype.hasOwnProperty.call(buf, k) && num(buf[k], 0) >= 1 - EPS) n++;
    }
    if (!(num(buf[itemId], 0) >= 1 - EPS)) n += 1; // 新物品也要占一份
    return Math.max(1, n);
  }

  // 单个物品在 inBuf 中的上限（均分后的格位容量）
  function inputItemCapOf(content, b, itemId) {
    return Math.floor(inputCapOf(content, b) / inputSlotCountOf(content, b, itemId));
  }
  function speedOf(content, b) {
    var def = defOf(content, b);
    return (def && def.speed != null) ? num(def.speed, 1) : 1;
  }
  function solarMultiplierOf(state, content) {
    var p = ((content && content.PLANETS) || {})[state.planetId];
    var v = p ? p.solarMultiplier : null;
    return (typeof v === 'number' && !isNaN(v)) ? v : 1;
  }

  /* ============================ 矿脉生成（v2） ============================ */
  // 每行星每矿种恰好 1 个矿脉方块（id = 'vein-<itemId>'），储量无限。
  // 位置由 planetId+itemId 哈希决定：绕行星中心均匀圆周分布，确定且可复现。

  function generateVeins(planetId, content) {
    var planet = ((content && content.PLANETS) || {})[planetId];
    if (!planet || !planet.oreTypes || !planet.oreTypes.length) return {};
    var types = planet.oreTypes;
    var veins = {};
    var R = 320 + types.length * 46; // 随矿种数扩大的分布半径
    for (var i = 0; i < types.length; i++) {
      var itemId = types[i];
      var h = xmur3(String(planetId + '::' + itemId))();
      var jitter = ((h % 1000) / 1000 - 0.5) * (Math.PI * 2 / types.length) * 0.6;
      var ang = (i / types.length) * Math.PI * 2 + jitter;
      var x = Math.cos(ang) * R, y = Math.sin(ang) * R;
      veins['vein-' + itemId] = {
        id: 'vein-' + itemId, itemId: itemId,
        x: round2(x), y: round2(y),
        miners: 0, buffer: 0, cap: VEIN_CAP, minerType: null, minerCounts: {}
      };
    }
    return veins;
  }

  function isVein(state, id) {
    return !!(state.veins && Object.prototype.hasOwnProperty.call(state.veins, id));
  }
  function veinOf(state, id) { return state.veins ? state.veins[id] : null; }

  // 任意端点节点（建筑或矿脉）的坐标访问
  function nodeById(state, id) {
    if (state.buildings && state.buildings[id]) return state.buildings[id];
    if (state.veins && state.veins[id]) return state.veins[id];
    return null;
  }

  // 矿工可采判定：声明 mineItems → 按物品白名单精确匹配；否则声明 mineKind → 按物品 kind 匹配；
  // 两者都未声明的老 miner 定义不限制（保持向后兼容）。
  // 不变量：任一可被开采的物品只允许命中一种 miner，避免同一矿脉混放后 removeMiner 拆错类型。
  function minerAcceptsItem(content, def, itemId) {
    if (!def || !itemId) return true;
    if (def.mineItems && def.mineItems.length) return def.mineItems.indexOf(itemId) >= 0;
    if (def.mineKind) {
      var it = (content.ITEMS || {})[itemId];
      return !!it && it.kind === def.mineKind;
    }
    return true;
  }

  // ---- 矿脉上的设备按型号分摊：让 speed / powerDemandKw 这类个体属性真正生效 ----
  // 不变量：Σ minerCounts === v.miners，且同一脉只允许一种型号（见 placeBuilding 的 minerType 锁）。

  /** 老存档兜底：没有 minerCounts 时，按当前设备型号或资源品类推断出最可能的基础设备 */
  function defaultMinerFor(content, itemId) {
    if ((content.ITEMS[itemId] || {}).kind === 'fluid') {
      return itemId === 'crude_oil' ? 'oil_extractor' : 'water_pump';
    }
    return 'mining_machine';
  }

  /** 取得各型号台数表（老档首次访问时推断并落到对象上，之后读写同一份） */
  function minerCountsOf(content, v) {
    if (v.minerCounts && typeof v.minerCounts === 'object') return v.minerCounts;
    var inferred = {};
    var n = Math.max(0, num(v.miners, 0));
    if (n > 0) {
      var tid = v.minerType || defaultMinerFor(content, v.itemId);
      if (tid) inferred[tid] = n;
    }
    v.minerCounts = inferred;
    return inferred;
  }

  /** 速率权重：Σ(台数 × 该型号 speed)—— 深层采矿机 speed 2 即等于两台采矿机 */
  function veinSpeedSum(content, v) {
    var counts = minerCountsOf(content, v);
    var sum = 0;
    for (var tid in counts) {
      var d = (content.BUILDINGS || {})[tid];
      sum += Math.max(0, num(counts[tid], 0)) * (d ? Math.max(0, num(d.speed, 1)) : 1);
    }
    return sum;
  }

  /** 耗电：Σ(台数 × 该型号 powerDemandKw)，未知型号回退 MINER_DEMAND_KW */
  function veinPowerDemandKw(content, v) {
    var counts = minerCountsOf(content, v);
    var sum = 0;
    for (var tid in counts) {
      var d = (content.BUILDINGS || {})[tid];
      sum += Math.max(0, num(counts[tid], 0)) * (d ? num(d.powerDemandKw, MINER_DEMAND_KW) : MINER_DEMAND_KW);
    }
    return sum;
  }

  // 距离 ≤ maxDist 的最近矿脉（矿机落脉吸附用）
  function findVeinNear(state, x, y, maxDist) {
    var veins = state.veins || {};
    var best = null, bestD = maxDist * maxDist;
    var keys = Object.keys(veins);
    for (var i = 0; i < keys.length; i++) {
      var v = veins[keys[i]];
      var dx = v.x - x, dy = v.y - y;
      var d2 = dx * dx + dy * dy;
      if (d2 <= bestD) { bestD = d2; best = v; }
    }
    return best;
  }

  // 是否有任意方块（建筑/矿脉）占据 (x,y) 附近（同 id 除外）
  function occupiedBy(state, content, x, y, exceptId) {
    var d2 = ATTACH_DIST * ATTACH_DIST;
    var keys = Object.keys(state.buildings || {});
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === exceptId) continue;
      var b = state.buildings[keys[i]];
      var dx = b.x - x, dy = b.y - y;
      if (dx * dx + dy * dy < d2) return { kind: 'building', id: keys[i], typeId: b.typeId };
    }
    var vk = Object.keys(state.veins || {});
    for (i = 0; i < vk.length; i++) {
      if (vk[i] === exceptId) continue;
      var v = state.veins[vk[i]];
      dx = v.x - x; dy = v.y - y;
      if (dx * dx + dy * dy < d2) return { kind: 'vein', id: vk[i], typeId: 'vein' };
    }
    return null;
  }

  /* ============================ 初始状态 ============================ */

  function initTransients(state) {
    if (!state._rateAcc) state._rateAcc = {};
    if (!state._rateLog) state._rateLog = [];
    if (!state._consAcc) state._consAcc = {};
    if (!state._consLog) state._consLog = [];
    if (!state._beltAcc) state._beltAcc = {};
    if (!state._beltLast) state._beltLast = {};
    if (!state._beltItem) state._beltItem = {};
  }

  function createInitialState(content, planetId) {
    content = content || {};
    var planets = content.PLANETS || {};
    var keys = Object.keys(planets);
    var pid = (planetId && planets[planetId]) ? planetId : (keys[0] || null);
    var planet = pid ? planets[pid] : null;
    var systems = content.STAR_SYSTEMS ? Object.keys(content.STAR_SYSTEMS) : [];
    var homeSystem = (planet && planet.systemId) || systems[0] || null;

    var state = {
      version: 2,
      planetId: pid,
      galaxyUnlocked: homeSystem ? [homeSystem] : [],
      time: 0,
      nextId: 1,
      buildings: {},
      buildingReserve: {},  // 拆除回收库：typeId -> 数量；再放置时优先免材料使用
      belts: {},
      veins: generateVeins(pid, content),
      stock: {
        iron_ingot: 50, gear: 30, magnetic_coil: 30,
        circuit_board: 30, stone_brick: 20, glass: 10, copper_ingot: 15
      },
      scienceStock: {},
      research: { current: null, progress: 0, queue: [], paused: null },
      unlockedTechs: [],
      dyson: { sails: 0, rockets: 0, spherePoints: 0, sailsLaunched: 0 },
      stats: { totalProduced: {}, totalConsumed: {}, launchedSails: 0, launchedRockets: 0, playSeconds: 0 },
      // 多行星物流（系统6）：每行星独立 建筑/传送带/矿脉/库存；全局运输队列
      planets: {},
      shipments: [],
      nextShipmentId: 1
    };
    state.planets[pid] = {
      buildings: state.buildings, belts: state.belts, veins: state.veins,
      stock: state.stock, buildingReserve: state.buildingReserve
    };
    var mids = content.MATRIX_ITEM_IDS || [];
    for (var i = 0; i < mids.length; i++) state.scienceStock[mids[i]] = 0;
    initTransients(state);
    return state;
  }

  /* ============================ 电力 ============================ */

  // grid：可选 'a'|'b'|'c'。传入时只统计该电网的建筑；矿脉采矿机恒计入电网 'a'。
  function computePower(state, content, meta, grid) {
    meta = meta || cc(content);
    var demand = 0, gen = 0;
    var ids = Object.keys(state.buildings);
    var solarMult = null;
    for (var i = 0; i < ids.length; i++) {
      var b = state.buildings[ids[i]];
      if (b.enabled === false) continue;
      var bg = b.grid || 'a';
      if (grid && bg !== grid) continue; // 按电网过滤
      var def = defOf(content, b);
      if (!def) continue;
      // 加速模式（增产剂生效时）耗电 ×powerMultiplier
      var demandMult = 1;
      if (b.sprayMode === 'speed') {
        var spray = sprayTierOf(state, content, b);
        if (spray) demandMult = spray.cfg.powerMultiplier;
      }
      demand += num(def.powerDemandKw, 0) * demandMult * Math.max(1, num(b.count, 1)); // v2：叠加 ×N
      // 能量枢纽（对齐参考 energy_exchanger）：充电模式按 powerChargeKw 计入需求；
      // 放电模式不耗电，且仅当缓存中有满蓄电器可放时按 powerGenerationKw 出力
      if (def.id === 'energy_hub' && num(def.powerChargeKw, 0) > 0) {
        var hubCount = Math.max(1, num(b.count, 1));
        if (b.energyMode === 'discharge') {
          var disRecipe = (content.RECIPES || {})['accumulator_discharge'];
          var disItem = disRecipe && disRecipe.inputs && disRecipe.inputs[0] ? disRecipe.inputs[0].itemId : 'charged_accumulator';
          if ((b.inBuf[disItem] || 0) >= 1 - EPS) gen += num(def.powerGenerationKw, 0) * hubCount;
        } else {
          demand += num(def.powerChargeKw, 0) * hubCount;
        }
      }
      if (def.kind === 'power' && num(def.powerGenerationKw, 0) > 0) {
        // 燃料发电机（系统5）：缺料时不出力
        var fuelId = fuelItemIdOf(content, b);
        if (def.fuel && fuelId && (b.inBuf[fuelId] || 0) < 1 - EPS) continue;
        var mult = 1;
        if (meta.solarIs[def.id]) {
          if (solarMult === null) solarMult = solarMultiplierOf(state, content);
          mult = solarMult;
        }
        gen += num(def.powerGenerationKw, 0) * Math.max(1, num(b.count, 1)) * mult; // v2：叠加发电 ×N
      }
    }
    // v2：矿脉上的开采设备也是耗电单元（按型号各自的 powerDemandKw 累加），恒计入电网 'a'
    if (!grid || grid === 'a') {
      var vk = Object.keys(state.veins || {});
      for (i = 0; i < vk.length; i++) {
        var v = state.veins[vk[i]];
        if (v.miners > 0) demand += veinPowerDemandKw(content, v);
      }
    }
    var ratio = demand > 0 ? Math.min(1, gen / demand) : 1;
    return { demandKw: demand, generationKw: gen, ratio: clamp01(ratio) };
  }

  // 三个电网（a/b/c）各自的发电/耗电/比率
  function gridRatios(state, content, meta) {
    meta = meta || cc(content);
    var out = {};
    var grids = ['a', 'b', 'c'];
    for (var g = 0; g < grids.length; g++) {
      var p = computePower(state, content, meta, grids[g]);
      out[grids[g]] = { demandKw: p.demandKw, generationKw: p.generationKw, ratio: p.ratio };
    }
    return out;
  }

  function powerStats(state, content) {
    var gr = gridRatios(state, content);
    var totalDemand = round2(gr.a.demandKw + gr.b.demandKw + gr.c.demandKw);
    var totalGen = round2(gr.a.generationKw + gr.b.generationKw + gr.c.generationKw);
    var agg = totalDemand > 0 ? Math.min(1, totalGen / totalDemand) : 1;
    return {
      grids: {
        a: { demandKw: round2(gr.a.demandKw), generationKw: round2(gr.a.generationKw), ratio: round4(gr.a.ratio) },
        b: { demandKw: round2(gr.b.demandKw), generationKw: round2(gr.b.generationKw), ratio: round4(gr.b.ratio) },
        c: { demandKw: round2(gr.c.demandKw), generationKw: round2(gr.c.generationKw), ratio: round4(gr.c.ratio) }
      },
      demandKw: totalDemand,
      generationKw: totalGen,
      ratio: round4(clamp01(agg))
    };
  }

  /* ============================ 核心模拟 ============================ */

  function trackProduced(state, itemId, n) {
    state.stats.totalProduced[itemId] = (state.stats.totalProduced[itemId] || 0) + n;
    state._rateAcc[itemId] = (state._rateAcc[itemId] || 0) + n;
  }

  // 消耗统计（与 trackProduced 对称）：累计消耗 + 每移瞬时日志
  function trackConsumed(state, itemId, n) {
    if (!itemId) return;
    if (!state.stats.totalConsumed) state.stats.totalConsumed = {};
    state.stats.totalConsumed[itemId] = (state.stats.totalConsumed[itemId] || 0) + n;
    state._consAcc[itemId] = (state._consAcc[itemId] || 0) + n;
  }

  function hasInputs(buf, inputs) {
    for (var i = 0; i < inputs.length; i++) {
      if ((buf[inputs[i].itemId] || 0) < num(inputs[i].amount, 0)) return false;
    }
    return true;
  }

  // ---- 矿脉开采（v2）：miners 台采矿机把矿石采入 vein.buffer（储量无限） ----
  // buffer 是 0..cap 的浮点缓存；传送带按整件从 buffer 扣除。
  // 产量统计在“采出整件”时入账（与机器完工入账语义一致）。
  function updateVeins(state, content, meta, dt, ratio) {
    var keys = Object.keys(state.veins || {});
    for (var i = 0; i < keys.length; i++) {
      var v = state.veins[keys[i]];
      if (!(v.miners > 0)) continue;
      var space = v.cap - (v.buffer || 0);
      if (space <= EPS) { v.stalled = true; continue; }
      var rate = MINER_RATE * veinSpeedSum(content, v) * (ratio == null ? 1 : ratio);
      var before = Math.floor(v.buffer || 0);
      v.buffer = Math.min(v.cap, (v.buffer || 0) + rate * dt);
      var whole = Math.floor(v.buffer);
      if (whole > before) trackProduced(state, v.itemId, whole - before);
      v.stalled = false;
    }
  }

  // ---- 制造机 / 研究站（矩阵直入 scienceStock）----
  // ============================ 增产剂喷涂（系统4） ============================
  // 模型（对齐 DSPONLINE）：喷涂机建筑可绑定一台 machine/lab；
  // 目标机器 inBuf 中供有增产剂时按最高档生效——
  //   extra 模式：每周期按 extraProductBonus 额外产出（非矩阵产物，小数累进）；
  //   speed 模式：生产速度 ×(1+speedBonus)，耗电 ×powerMultiplier。
  // 每个完整生产周期消耗 1 件当前档增产剂。
  function isSprayableDef(def) {
    return !!(def && (def.kind === 'machine' || def.kind === 'lab') && def.id !== 'spray_coater');
  }

  // 生效档位：inBuf 中最高档增产剂（≥1 件）；未绑定/未供料返回 null
  function sprayTierOf(state, content, b) {
    if (!b || !b.sprayMode) return null;
    var def = defOf(content, b);
    if (!isSprayableDef(def)) return null;
    var tiers = (content.SPRAY_TIERS || {});
    for (var t = 3; t >= 1; t--) {
      var cfg = tiers[t];
      if (cfg && (b.inBuf[cfg.itemId] || 0) >= 1 - EPS) return { tier: t, cfg: cfg };
    }
    return null;
  }

  // 为一台可喷涂机器绑定一台空闲喷涂机（默认增产模式）
  function bindSprayCoater(state, content, machineId) {
    var machine = (state.buildings || {})[machineId];
    if (!machine) return errR('buildingNotFound');
    var mdef = defOf(content, machine);
    if (!isSprayableDef(mdef)) return errR('notSprayable');
    if (machine.sprayMode) return errR('alreadyBound');
    var ids = Object.keys(state.buildings);
    for (var i = 0; i < ids.length; i++) {
      var c = state.buildings[ids[i]];
      if (c.boundMachineId) continue;
      var cdef = defOf(content, c);
      if (cdef && cdef.id === 'spray_coater') {
        c.boundMachineId = machineId;
        machine.sprayMode = 'extra';
        return okR({ coaterId: c.id, mode: machine.sprayMode });
      }
    }
    return errR('noFreeCoater');
  }

  // 切换喷涂模式：'extra' | 'speed' | null（关闭，保留绑定）
  function setSprayMode(state, content, machineId, mode) {
    var machine = (state.buildings || {})[machineId];
    if (!machine) return errR('buildingNotFound');
    var mdef = defOf(content, machine);
    if (!isSprayableDef(mdef)) return errR('notSprayable');
    if (!machine.sprayMode && mode !== null) return errR('notBound');
    if (mode !== 'extra' && mode !== 'speed' && mode !== null) return errR('badMode');
    if (mode === 'extra') {
      // 矩阵产物配方只允许加速（对齐参考 matrix_research 限制）
      var recipe = machine.recipeId ? ((content.RECIPES || {})[machine.recipeId]) : null;
      var meta = cc(content);
      var outs = (recipe && recipe.outputs) || [];
      for (var i = 0; i < outs.length; i++) {
        if (meta.matrix[outs[i].itemId]) return errR('matrixSpeedOnly');
      }
    }
    machine.sprayMode = mode;
    return okR({ mode: machine.sprayMode });
  }

  // 解除绑定（喷涂机恢复空闲，可再绑定其他机器）
  function unbindSprayCoater(state, content, machineId) {
    var machine = (state.buildings || {})[machineId];
    if (!machine) return errR('buildingNotFound');
    if (!machine.sprayMode && !hasBoundCoater(state, machineId)) return errR('notBound');
    machine.sprayMode = null;
    var ids = Object.keys(state.buildings);
    for (var i = 0; i < ids.length; i++) {
      var c = state.buildings[ids[i]];
      if (c.boundMachineId === machineId) c.boundMachineId = null;
    }
    return okR();
  }

  function hasBoundCoater(state, machineId) {
    var ids = Object.keys(state.buildings || {});
    for (var i = 0; i < ids.length; i++) {
      if (state.buildings[ids[i]].boundMachineId === machineId) return true;
    }
    return false;
  }

  function updateMachine(state, content, meta, b, dt, ratio) {
    var def0 = defOf(content, b);
    if (def0 && def0.id === 'spray_coater') { b.stalled = false; b.stallReason = null; return; } // 喷涂机是内联模块，自身不生产
    // ---- 射线接收站（系统5）：产出效率受戴森云功率约束 ----
    if (def0 && def0.family === 'receiver') {
      updateRayReceiver(state, content, meta, b, dt, ratio);
      return;
    }
    var recipe = b.recipeId ? ((content.RECIPES || {})[b.recipeId]) : null;
    if (!recipe) { b.stalled = true; b.stallReason = 'no_recipe'; return; }
    var inputs = recipe.inputs || [];
    var outputs = recipe.outputs || [];
    var i;
    // 输出容量检查（矩阵产物不占 outBuf）
    var need = 0;
    for (i = 0; i < outputs.length; i++) {
      if (!meta.matrix[outputs[i].itemId]) need += num(outputs[i].amount, 0);
    }
    if (need > 0 && sumBuf(b.outBuf) + need > outputCapOf(content, b)) {
      // 溢出入库：产出堵住（下游带走不掉）时，先把「腾出一炉空间」所需的过剩产物
      // 溢出到库存（单种物资受 STOCK_OVERFLOW_CAP 约束）；仍放不下才背压停转
      overflowOutBufToStock(state, content, b, need);
      if (sumBuf(b.outBuf) + need > outputCapOf(content, b)) { b.stalled = true; b.stallReason = 'output_full'; return; }
    }
    if (!hasInputs(b.inBuf, inputs)) { b.stalled = true; b.stallReason = 'no_input'; return; }
    if (ratio <= 0) { b.stalled = true; b.stallReason = 'no_power'; return; }
    b.stalled = false; b.stallReason = null;

    var speed = speedOf(content, b) * Math.max(1, num(b.count, 1)) * (ratio == null ? 1 : ratio); // v2：叠加效率 ×N
    var spray = sprayTierOf(state, content, b);
    if (spray && b.sprayMode === 'speed') speed *= (1 + spray.cfg.speedBonus); // 加速模式
    b.progress += speed * dt / Math.max(0.0001, num(recipe.duration, 1));

    var guard = 0;
    while (b.progress >= 1 - EPS && guard++ < MACHINE_MAX_CRAFTS) {
      if (!hasInputs(b.inBuf, inputs)) {
        b.progress = Math.min(b.progress, 1 - EPS);
        b.stalled = true; b.stallReason = 'no_input';
        break;
      }
      for (i = 0; i < inputs.length; i++) {
        b.inBuf[inputs[i].itemId] = (b.inBuf[inputs[i].itemId] || 0) - num(inputs[i].amount, 0);
        trackConsumed(state, inputs[i].itemId, num(inputs[i].amount, 0));
      }
      for (i = 0; i < outputs.length; i++) {
        var o = outputs[i];
        var amount = num(o.amount, 0);
        if (meta.matrix[o.itemId]) {
          state.scienceStock[o.itemId] = (state.scienceStock[o.itemId] || 0) + amount;
        } else {
          b.outBuf[o.itemId] = (b.outBuf[o.itemId] || 0) + amount;
        }
        trackProduced(state, o.itemId, amount);
      }
      // 增产模式：按 extraProductBonus 额外产出（非矩阵产物，小数部分累进）
      spray = sprayTierOf(state, content, b);
      if (spray && b.sprayMode === 'extra') {
        var acc = b._sprayAcc || (b._sprayAcc = {});
        for (i = 0; i < outputs.length; i++) {
          var oi = outputs[i];
          if (meta.matrix[oi.itemId]) continue;
          var eff = num(oi.amount, 0) * spray.cfg.extraProductBonus + (acc[oi.itemId] || 0);
          var whole = Math.floor(eff + EPS);
          acc[oi.itemId] = eff - whole;
          if (whole > 0) {
            b.outBuf[oi.itemId] = (b.outBuf[oi.itemId] || 0) + whole;
            trackProduced(state, oi.itemId, whole);
          }
        }
      }
      // 每个完整周期消耗 1 件当前档增产剂
      if (spray) {
        b.inBuf[spray.cfg.itemId] = (b.inBuf[spray.cfg.itemId] || 0) - 1;
        trackConsumed(state, spray.cfg.itemId, 1);
      }
      b.progress -= 1;
      if (b.progress < EPS) b.progress = 0;
    }
  }

  // ---- 溢出入库：机器 outBuf 满（下游带走不掉）时，把「腾出一炉空间」所需的
  // 过剩产物溢出到 stock。单种物资受 STOCK_OVERFLOW_CAP 上限约束，库存达上限后
  // 不再溢出、恢复背压停转（output_full）。只搬 outBuf（inBuf 是待消耗原料）。
  function overflowOutBufToStock(state, content, b, need) {
    var def = defOf(content, b);
    if (!def || def.kind !== 'machine') return false; // 仓库/物流站本就入库，无需溢出
    var cap = outputCapOf(content, b);
    var surplus = sumBuf(b.outBuf) + Math.max(0, need) - cap;
    if (!(surplus > EPS)) return false;
    var keys = Object.keys(b.outBuf), movedAny = false;
    for (var i = 0; i < keys.length && surplus > EPS; i++) {
      var k = keys[i], n = b.outBuf[k];
      if (!(n > 0)) continue;
      var headroom = STOCK_OVERFLOW_CAP - (state.stock[k] || 0);
      if (headroom <= 0) continue;
      var moved = Math.min(n, surplus, headroom);
      state.stock[k] = (state.stock[k] || 0) + moved;
      n -= moved;
      if (n > EPS) b.outBuf[k] = n; else delete b.outBuf[k];
      surplus -= moved;
      movedAny = true;
    }
    return movedAny;
  }

  // ---- 戴森发射井：从 inBuf 按速率消耗帆/火箭 ----
  function updateDysonBuilding(state, content, meta, b, dt, ratio) {
    var d = state.dyson;
    var mult = (ratio == null ? 1 : ratio);
    if (meta.sailId) {
      b.accSail = Math.min((b.accSail || 0) + dt * DYSON_SAIL_RATE * mult, DYSON_SAIL_RATE * 5);
      var whole = Math.floor(b.accSail + EPS);
      if (whole > 0) {
        var have = b.inBuf[meta.sailId] || 0;
        var n = Math.min(whole, have);
        if (n > 0) {
          b.inBuf[meta.sailId] -= n;
          b.accSail -= n;
          d.sails += n;
          d.sailsLaunched += n;
          state.stats.launchedSails += n;
          trackConsumed(state, meta.sailId, n);
        }
      }
    }
    if (meta.rocketId) {
      b.accRocket = Math.min((b.accRocket || 0) + dt * DYSON_ROCKET_RATE * mult, DYSON_ROCKET_RATE * 5);
      var wholeR = Math.floor(b.accRocket + EPS);
      if (wholeR > 0) {
        var haveR = b.inBuf[meta.rocketId] || 0;
        var nR = Math.min(wholeR, haveR);
        if (nR > 0) {
          b.inBuf[meta.rocketId] -= nR;
          b.accRocket -= nR;
          d.rockets += nR;
          d.spherePoints += nR * POINTS_PER_ROCKET;
          state.stats.launchedRockets += nR;
          trackConsumed(state, meta.rocketId, nR);
        }
      }
    }
  }

  // ---- 仓库：inBuf → stock（入库） ----
  function drainToStock(state, b) {
    var keys = Object.keys(b.inBuf);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], n = b.inBuf[k];
      if (n > 0) {
        state.stock[k] = (state.stock[k] || 0) + n;
        b.inBuf[k] = 0;
      }
    }
  }

  function updateStorage(state, content, meta, b) {
    drainToStock(state, b);
  }

  // ---- 分流器：inBuf → outBuf 直通（无工时，受输出容量约束），供多带 fairShare 分流 ----
  function updateSplitter(state, content, meta, b) {
    var outCap = outputCapOf(content, b);
    var keys = Object.keys(b.inBuf);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], n = b.inBuf[k];
      if (!(n > 0)) continue;
      var space = outCap - sumBuf(b.outBuf);
      if (space <= 0) break;
      var moved = Math.min(n, space);
      b.inBuf[k] = n - moved;
      b.outBuf[k] = (b.outBuf[k] || 0) + moved;
    }
  }

  // ---- 物流站：inBuf → stock；设置配方后按配方产物 stock → outBuf ----
  // 出口路由（系统6）：route = { itemId, toPid, amount, enabled }，按 ROUTE_INTERVAL_SEC 周期发货
  function updateStation(state, content, meta, b) {
    drainToStock(state, b);
    var recipe = b.recipeId ? ((content.RECIPES || {})[b.recipeId]) : null;
    if (!recipe) return;
    var cap = outputCapOf(content, b);
    var outputs = recipe.outputs || [];
    for (var i = 0; i < outputs.length; i++) {
      var o = outputs[i];
      var space = cap - sumBuf(b.outBuf);
      if (space <= 0) return;
      var have = state.stock[o.itemId] || 0;
      if (have <= 0) continue;
      var n = Math.min(have, Math.floor(space));
      state.stock[o.itemId] -= n;
      b.outBuf[o.itemId] = (b.outBuf[o.itemId] || 0) + n;
    }
  }

  function updateStationRoutes(state, content, dt) {
    var ids = Object.keys(state.buildings || {});
    for (var i = 0; i < ids.length; i++) {
      var b = state.buildings[ids[i]];
      if (b.enabled === false) continue;
      var def = defOf(content, b);
      if (!def || def.kind !== 'station') continue;
      var route = b.route;
      if (!route || !route.itemId || !route.toPid || route.enabled === false) { b.routeAcc = 0; continue; }
      var toPlanet = (content.PLANETS || {})[route.toPid];
      var fromPlanet = (content.PLANETS || {})[state.planetId];
      if (!toPlanet || state.galaxyUnlocked.indexOf(toPlanet.systemId) < 0) continue;
      var sameSystem = !!(fromPlanet && toPlanet.systemId === fromPlanet.systemId);
      b.routeAcc = (b.routeAcc || 0) + dt;
      if (b.routeAcc < ROUTE_INTERVAL_SEC) continue;
      b.routeAcc -= ROUTE_INTERVAL_SEC;
      var amount = Math.max(1, Math.floor(num(route.amount, 10)));
      var have = Math.floor(state.stock[route.itemId] || 0);
      if (have <= 0) continue;
      var send = Math.min(have, amount);
      if (!sameSystem) {
        if ((state.stock['space_warper'] || 0) < 1 - EPS) continue; // 跨星系航线需要空间翘曲器
        state.stock['space_warper'] -= 1;
        trackConsumed(state, 'space_warper', 1);
      }
      state.stock[route.itemId] = have - send;
      trackConsumed(state, route.itemId, send);
      state.shipments = state.shipments || [];
      state.shipments.push({
        id: state.nextShipmentId = (state.nextShipmentId || 1),
        fromPid: state.planetId, toPid: route.toPid,
        itemId: route.itemId, amount: send,
        eta: sameSystem ? SHIP_TRAVEL_SEC : SHIP_TRAVEL_WARP_SEC
      });
      state.nextShipmentId += 1;
    }
  }

  // ---- 射线接收站（系统5）：凝结临界光子，速率 × 戴森接收效率 ----
  // 效率 = min(1, 戴森云功率 / 接收站总容量)；容量 = 台数 × RAY_RECEIVER_CAPACITY_KW
  var DYSON_SAIL_KW = 88;              // 每片太阳帆发电功率（对齐 DSPONLINE SOLAR_SAIL_POWER_KW）
  var DYSON_POINT_KW = 5000;           // 每个戴森球结构点发电功率
  var RAY_RECEIVER_CAPACITY_KW = 6000; // 单台接收站接收容量（对齐 DSPONLINE）

  function dysonPowerOf(state) {
    var d = state.dyson || {};
    // 结构点 = 自由点 + 已建节点折算（每节点 NODE_COST 点，系统7 规划器）
    var totalPoints = num(d.spherePoints, 0) + dysonNodeCount(state) * DYSON_NODE_COST;
    return num(d.sails, 0) * DYSON_SAIL_KW + totalPoints * DYSON_POINT_KW;
  }

  /* ==================== 戴森球规划器（系统7） ==================== */
  // 球面几何：3 条轨道环 × 每环 12 个槽位；节点从自由结构点中花费 DYSON_NODE_COST 建造。
  // 总结构点（自由 + 节点折算）驱动进度与发电，语义与旧档完全兼容（nodes 为空 = 全自由）。
  var DYSON_ORBIT_COUNT = 3;
  var DYSON_SLOTS_PER_ORBIT = 12;
  var DYSON_NODE_COST = 20;   // 每节点消耗的结构点
  var DYSON_NODE_GEN_KW = 100000; // 每建成节点发电（= NODE_COST × DYSON_POINT_KW，总量守恒）

  function dysonNodeCount(state) {
    var nodes = (state.dyson && state.dyson.nodes) || [];
    return nodes.length;
  }

  function dysonNodeAt(state, orbit, slot) {
    var nodes = (state.dyson && state.dyson.nodes) || [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].orbit === orbit && nodes[i].slot === slot) return nodes[i];
    }
    return null;
  }

  function dysonValidSlot(orbit, slot) {
    return orbit >= 0 && orbit < DYSON_ORBIT_COUNT && slot >= 0 && slot < DYSON_SLOTS_PER_ORBIT;
  }

  function placeDysonNode(state, content, orbit, slot) {
    var d = state.dyson || (state.dyson = { sails: 0, rockets: 0, spherePoints: 0, sailsLaunched: 0 });
    if (!dysonValidSlot(orbit, slot)) return errR('badSlot');
    if (dysonNodeAt(state, orbit, slot)) return errR('slotTaken');
    if (num(d.spherePoints, 0) < DYSON_NODE_COST - EPS) return errR('notEnoughPoints');
    d.spherePoints -= DYSON_NODE_COST;
    d.nodes = d.nodes || [];
    d.nodes.push({ orbit: orbit, slot: slot });
    return okR({ nodes: d.nodes.length, freePoints: d.spherePoints });
  }

  function removeDysonNode(state, content, orbit, slot) {
    var d = state.dyson;
    if (!d) return errR('badSlot');
    var nodes = d.nodes || [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].orbit === orbit && nodes[i].slot === slot) {
        nodes.splice(i, 1);
        d.spherePoints = num(d.spherePoints, 0) + DYSON_NODE_COST; // 退还结构点
        return okR({ nodes: nodes.length, freePoints: d.spherePoints });
      }
    }
    return errR('noNode');
  }

  function moveDysonNode(state, content, orbit, slot, toOrbit, toSlot) {
    var d = state.dyson;
    if (!dysonValidSlot(toOrbit, toSlot)) return errR('badSlot');
    var node = dysonNodeAt(state, orbit, slot);
    if (!node) return errR('noNode');
    var target = dysonNodeAt(state, toOrbit, toSlot);
    if (target) return errR('slotTaken');
    node.orbit = toOrbit;
    node.slot = toSlot;
    return okR();
  }

  // 布局查询（UI 渲染用）
  function dysonLayout(state) {
    var d = (state && state.dyson) || {};
    return {
      orbitCount: DYSON_ORBIT_COUNT,
      slotsPerOrbit: DYSON_SLOTS_PER_ORBIT,
      nodes: (d.nodes || []).slice(),
      freePoints: num(d.spherePoints, 0),
      spentPoints: dysonNodeCount(state) * DYSON_NODE_COST,
      nodeCost: DYSON_NODE_COST,
      nodeGenKw: dysonNodeCount(state) * DYSON_NODE_GEN_KW
    };
  }

  function receiverEfficiencyOf(state, content) {
    var cap = 0;
    var ids = Object.keys(state.buildings || {});
    for (var i = 0; i < ids.length; i++) {
      var rb = state.buildings[ids[i]];
      if (rb.enabled === false) continue;
      var rd = defOf(content, rb);
      if (rd && rd.family === 'receiver') cap += RAY_RECEIVER_CAPACITY_KW * Math.max(1, num(rb.count, 1));
    }
    if (cap <= 0) return 0;
    return clamp01(dysonPowerOf(state) / cap);
  }

  function updateRayReceiver(state, content, meta, b, dt, ratio) {
    var recipe = b.recipeId ? ((content.RECIPES || {})[b.recipeId]) : null;
    if (!recipe) { b.stalled = true; b.stallReason = 'no_recipe'; return; }
    if (ratio <= 0) { b.stalled = true; b.stallReason = 'no_power'; return; }
    var eff = receiverEfficiencyOf(state, content);
    if (eff <= EPS) { b.stalled = true; b.stallReason = 'no_dyson'; b.receiverEff = 0; return; }
    b.stalled = false; b.stallReason = null;
    b.receiverEff = round4(eff);
    var outputs = recipe.outputs || [];
    var need = 0;
    for (var i = 0; i < outputs.length; i++) need += num(outputs[i].amount, 0);
    if (need > 0 && sumBuf(b.outBuf) + need > outputCapOf(content, b)) {
      overflowOutBufToStock(state, content, b, need); // 溢出入库（与生产建筑同规则）
      if (sumBuf(b.outBuf) + need > outputCapOf(content, b)) { b.stalled = true; b.stallReason = 'output_full'; return; }
    }
    var speed = speedOf(content, b) * Math.max(1, num(b.count, 1)) * (ratio == null ? 1 : ratio) * eff;
    b.progress += speed * dt / Math.max(0.0001, num(recipe.duration, 1));
    var guard = 0;
    while (b.progress >= 1 - EPS && guard++ < MACHINE_MAX_CRAFTS) {
      for (i = 0; i < outputs.length; i++) {
        var o = outputs[i];
        var amount = num(o.amount, 0);
        b.outBuf[o.itemId] = (b.outBuf[o.itemId] || 0) + amount;
        trackProduced(state, o.itemId, amount);
      }
      b.progress -= 1;
      if (b.progress < EPS) b.progress = 0;
    }
  }

  // ---- 燃料发电机（系统5）：kind=power 且定义 fuel —— 供料才发电，按 burnRate 件/秒消耗 ----
  function updateFuelGenerator(state, content, meta, b, dt) {
    var def = defOf(content, b);
    var fuel = def && def.fuel;
    if (!fuel) return;
    var fuelId = fuelItemIdOf(content, b);
    if (!fuelId) { b.stalled = true; b.stallReason = 'no_fuel'; return; }
    if ((b.inBuf[fuelId] || 0) >= 1 - EPS) {
      b.stalled = false; b.stallReason = null;
      b.fuelAcc = (b.fuelAcc || 0) + fuelBurnRateOf(content, def, fuelId) * dt;
      var whole = Math.floor(b.fuelAcc + EPS);
      if (whole > 0) {
        var stock = b.inBuf[fuelId] || 0;
        var burn = Math.min(whole, Math.floor(stock + EPS));
        b.inBuf[fuelId] = stock - burn;
        b.fuelAcc -= burn;
        trackConsumed(state, fuelId, burn);
      }
    } else {
      b.stalled = true; b.stallReason = 'no_fuel';
    }
  }

  function updateBuildings(state, content, meta, dt, gridRatiosMap) {
    var ids = Object.keys(state.buildings);
    for (var i = 0; i < ids.length; i++) {
      var b = state.buildings[ids[i]];
      if (b.enabled === false) continue;
      var def = defOf(content, b);
      var kind = def ? def.kind : null;
      var g = (b.grid || 'a');
      var gr = gridRatiosMap && gridRatiosMap[g] ? gridRatiosMap[g].ratio : 1;
      if (kind === 'machine' || kind === 'lab') updateMachine(state, content, meta, b, dt, gr);
      else if (kind === 'dyson') updateDysonBuilding(state, content, meta, b, dt, gr);
      else if (kind === 'power') updateFuelGenerator(state, content, meta, b, dt);
      else if (kind === 'storage') updateStorage(state, content, meta, b);
      else if (kind === 'splitter') updateSplitter(state, content, meta, b);
      else if (kind === 'station') updateStation(state, content, meta, b);
    }
  }

  // ---- 传送带（信贷模型，借鉴 DSPONLINE transferBelts：无在途物品）----
  // 每条带 = 连接记录，吞吐由带速决定，与带长无关：
  //   credit（转运额度）每步 += BeltSpeed(tier) * dt，封顶 BELT_CREDIT_SEC*speed；
  //   实际转移 = min(floor(credit), 源可用, 目标空位)；同源同物品的带成组，
  //   按 priority(2/1/0) 分档、档内 fairShare + _rr 轮转游标公平分配（对齐 DSPONLINE）。
  function beltCapacity(meta, belt) {
    return meta.beltSpeed[belt.tier] || DEFAULT_BELT_SPEED;
  }

  function beltCreditAccumulate(meta, belt, dt) {
    if (!belt.itemId) { belt.credit = 0; return 0; } // 未定物品的边不搬运
    var speed = beltCapacity(meta, belt);
    belt.credit = belt.credit || 0;
    belt.credit += speed * dt;
    var cap = speed * BELT_CREDIT_SEC;
    if (belt.credit > cap) belt.credit = cap;
    return Math.floor(belt.credit);
  }

  // 源（建筑 outBuf / 矿脉 buffer）中某物品的可用整数件数
  function srcAvailOf(state, fromId, item) {
    var vein = state.veins[fromId];
    if (vein) return Math.floor(vein.buffer || 0);
    var from = state.buildings[fromId];
    if (!from || !from.outBuf) return 0;
    return Math.floor(from.outBuf[item] || 0);
  }

  // 目标建筑输入缓存中「某物品」的剩余空间（整数件）。
  // 缓存按输入种类均分（inputItemCapOf），多输入配方不会互相挤占。
  function targetFreeOf(state, content, toId, itemId) {
    var to = state.buildings[toId];
    if (!to) return 0;
    var free = inputItemCapOf(content, to, itemId) - num(to.inBuf[itemId], 0);
    return Math.max(0, Math.floor(free));
  }

  // 实际搬运 want 件：源扣减、目标入账、扣 credit。返回实际件数（不处理阻塞语义）
  function beltMove(state, content, belt, want) {
    var item = belt.itemId;
    if (!item) return 0;
    var moved = Math.floor(want);
    if (moved < 1) return 0;
    var to = state.buildings[belt.toId];
    if (!to) return 0;
    var vein = state.veins[belt.fromId];
    if (vein) {
      if (vein.buffer < moved) moved = Math.floor(vein.buffer || 0);
      if (moved < 1) return 0;
      vein.buffer -= moved;
    } else {
      var from = state.buildings[belt.fromId];
      var out = (from && from.outBuf) || null;
      if (!out) return 0;
      if ((out[item] || 0) < moved) moved = Math.floor(out[item] || 0);
      if (moved < 1) return 0;
      out[item] -= moved;
    }
    to.inBuf[item] = (to.inBuf[item] || 0) + moved;
    belt.credit = Math.max(0, (belt.credit || 0) - moved);
    state._beltAcc[belt.id] = (state._beltAcc[belt.id] || 0) + moved;
    state._beltItem[belt.id] = item;
    return moved;
  }

  // 传送带的优先级档位：2=高 1=中(默认) 0=低
  function beltPriorityOf(belt) {
    var p = num(belt.priority, 1);
    return p === 2 ? 2 : (p === 0 ? 0 : 1);
  }

  function updateBelts(state, content, meta, dt) {
    var ids = Object.keys(state.belts);
    if (!ids.length || !(dt > 0)) return;
    var i;
    // 分组：源 + 物品（DSPONLINE 的 group key = source:itemId），
    // 同源的不同物品各自维护游标，互不干扰。
    var groups = {}, order = [];
    for (i = 0; i < ids.length; i++) {
      var bl = state.belts[ids[i]];
      var gkey = String(bl.fromId) + '|' + String(bl.itemId || '');
      if (!groups[gkey]) {
        groups[gkey] = { key: gkey, fromId: bl.fromId, itemId: bl.itemId || '', belts: [] };
        order.push(gkey);
      }
      groups[gkey].belts.push(bl);
    }
    for (i = 0; i < order.length; i++) {
      distributeGroup(state, content, meta, groups[order[i]], dt);
    }
  }

  // 单个 (源, 物品) 组的分配：信贷累加 → 按优先级分档 → 档内 fairShare + 轮转游标
  function distributeGroup(state, content, meta, g, dt) {
    var k, belts = g.belts;
    var cands = [];
    for (k = 0; k < belts.length; k++) {
      var belt = belts[k];
      if (!belt.itemId) { belt.credit = 0; continue; } // 未定物品的边不搬运
      beltCreditAccumulate(meta, belt, dt);
      cands.push({ belt: belt, allowance: Math.floor(belt.credit || 0), moved: 0 });
    }
    var total = cands.length;
    if (!total) return;
    var srcNode = state.buildings[g.fromId] || state.veins[g.fromId];
    if (!srcNode) return;

    if (total === 1) {
      var c0 = cands[0];
      if (c0.allowance > 0) {
        var av0 = srcAvailOf(state, g.fromId, g.itemId);
        var fr0 = targetFreeOf(state, content, c0.belt.toId, g.itemId);
        var m0 = beltMove(state, content, c0.belt, Math.min(c0.allowance, av0, fr0));
        c0.moved = m0;
        if (m0 < 1 && (av0 < 1 || fr0 < 1)) c0.belt.credit = 0; // 阻塞：不囤货
      }
      return;
    }

    // 轮转游标存于源节点（按物品分别记录），跨 tick 保持公平
    if (!srcNode._rr || typeof srcNode._rr !== 'object') srcNode._rr = {};
    var cursor = ((num(srcNode._rr[g.itemId], 0) % total) + total) % total;

    // 分流器默认均衡模式：忽略优先级，全组一起公平分配；其余建筑按 高→中→低 分档
    var isSplitter = !!(state.buildings[g.fromId] && state.buildings[g.fromId].typeId === 'splitter');
    var batches = [];
    if (isSplitter) {
      batches.push(cands);
    } else {
      for (var p = 2; p >= 0; p--) {
        var tierCands = [];
        for (k = 0; k < total; k++) {
          if (beltPriorityOf(cands[k].belt) === p) tierCands.push(cands[k]);
        }
        if (tierCands.length) batches.push(tierCands);
      }
    }
    for (var bi = 0; bi < batches.length; bi++) {
      cursor = distributeFair(state, content, batches[bi], cursor, total, g);
    }
    srcNode._rr[g.itemId] = cursor;

    // 阻塞语义：本 tick 有额度却因源空/目标满没搬动的带，清空 credit（不囤货）
    for (k = 0; k < total; k++) {
      var c = cands[k];
      if (c.allowance > 0 && c.moved < 1) {
        var av = srcAvailOf(state, g.fromId, g.itemId);
        var fr = targetFreeOf(state, content, c.belt.toId, g.itemId);
        if (av < 1 || fr < 1) c.belt.credit = 0;
      }
    }
  }

  // 档内公平分配（对齐 DSPONLINE distributeFairIndexed）：
  // 每轮 fairShare = max(1, floor(源可用 / 活跃候选数))，从游标起轮转发放，
  // 成功一次游标 +1；一轮后仍有余量则再来一轮（处理下取整余数与被带宽/容量卡住的份额）。
  function distributeFair(state, content, cands, cursor, total, g) {
    var guard = 0;
    while (guard++ < 32) {
      var active = [], j;
      for (j = 0; j < cands.length; j++) {
        var c = cands[j];
        if (c.allowance > 0 && targetFreeOf(state, content, c.belt.toId, c.belt.itemId) > 0) active.push(c);
      }
      if (!active.length) break;
      var available = srcAvailOf(state, g.fromId, g.itemId);
      if (available < 1) break;
      var share = Math.max(1, Math.floor(available / active.length));
      var movedAny = 0;
      for (j = 0; j < active.length; j++) {
        var cand = active[(cursor + j) % active.length];
        if (cand.allowance <= 0) continue;
        var free = targetFreeOf(state, content, cand.belt.toId, cand.belt.itemId);
        if (free < 1) continue;
        var av = srcAvailOf(state, g.fromId, g.itemId);
        if (av < 1) break;
        var want = Math.min(av, share, cand.allowance, free);
        if (want < 1) continue;
        var moved = beltMove(state, content, cand.belt, want);
        if (moved > 0) {
          cand.allowance -= moved;
          cand.moved += moved;
          movedAny += moved;
          cursor = (cursor + 1) % total;
        }
      }
      if (!movedAny) break;
    }
    return ((cursor % total) + total) % total;
  }

  // ---- 科研：进度速率 = 存活 lab 数 × 每 lab 点数/秒 ----
  function researchDemandOf(tech) {
    return RESEARCH_BASE_POINTS * (num(tech && tech.tier, 0) + 1);
  }

  function countLabs(state, content) {
    var n = 0;
    var ids = Object.keys(state.buildings);
    for (var i = 0; i < ids.length; i++) {
      var b = state.buildings[ids[i]];
      if (b.enabled === false) continue;
      var def = defOf(content, b);
      if (def && def.kind === 'lab') n += Math.max(1, num(b.count, 1)); // v2：叠加 ×N
    }
    return n;
  }

  function techCanPay(state, tech) {
    var costs = (tech && tech.costs) || [];
    for (var i = 0; i < costs.length; i++) {
      if ((state.scienceStock[costs[i].itemId] || 0) < num(costs[i].amount, 0)) return false;
    }
    return true;
  }

  function techPay(state, tech) {
    var costs = (tech && tech.costs) || [];
    for (var i = 0; i < costs.length; i++) {
      state.scienceStock[costs[i].itemId] = (state.scienceStock[costs[i].itemId] || 0) - num(costs[i].amount, 0);
    }
  }

  function techPrereqOk(state, tech) {
    var prereqs = (tech && tech.prerequisites) || [];
    for (var i = 0; i < prereqs.length; i++) {
      if (state.unlockedTechs.indexOf(prereqs[i]) < 0) return false;
    }
    return true;
  }

  // 从队列取下一个可开始的科技（前置齐/资源够；不满足的跳过并保留在队列中）
  function dequeueResearch(state, content) {
    var r = state.research;
    if (!r.queue || !r.queue.length) return;
    for (var i = 0; i < r.queue.length; i++) {
      var tid = r.queue[i];
      var t = (content.TECHNOLOGIES || {})[tid];
      if (!t || state.unlockedTechs.indexOf(tid) >= 0) { r.queue.splice(i, 1); i--; continue; }
      if (!techPrereqOk(state, t) || !techCanPay(state, t)) continue;
      techPay(state, t);
      r.current = tid;
      r.progress = 0;
      r.queue.splice(i, 1);
      return;
    }
  }

  function updateResearch(state, content, dt) {
    var r = state.research;
    if (!r.current) { dequeueResearch(state, content); if (!r.current) return; }
    var tech = (content.TECHNOLOGIES || {})[r.current];
    if (!tech) { r.current = null; r.progress = 0; return; }
    r.progress += dt * countLabs(state, content) * RESEARCH_POINTS_PER_LAB;
    if (r.progress >= researchDemandOf(tech)) {
      if (state.unlockedTechs.indexOf(r.current) < 0) state.unlockedTechs.push(r.current);
      r.progress = 0;
      r.current = null;
      dequeueResearch(state, content); // 完成后自动接队列中的下一个
    }
  }

  // ---- 戴森进度 → 星系解锁同步 ----
  function dysonProgress(state) {
    var d = (state && state.dyson) || {};
    var s = Math.min(1, num(d.sails, 0) / DYSON_SAIL_GOAL);
    // 结构点 = 自由点 + 已建节点折算（系统7：节点规划不改总量，只改呈现）
    var totalPoints = num(d.spherePoints, 0) + dysonNodeCount(state) * DYSON_NODE_COST;
    var p = Math.min(1, totalPoints / DYSON_POINT_GOAL);
    return clamp01(DYSON_SAIL_WEIGHT * s + (1 - DYSON_SAIL_WEIGHT) * p);
  }

  function unlockPlanetProgress(state) {
    var p = dysonProgress(state);
    return Math.max(1, Math.min(MAX_STAR_SYSTEMS, 1 + Math.floor(p * (MAX_STAR_SYSTEMS - 1) + EPS)));
  }

  function syncGalaxy(state, content) {
    var systems = (content && content.STAR_SYSTEMS) ? Object.keys(content.STAR_SYSTEMS) : [];
    if (!systems.length) return;
    var cur = state.galaxyUnlocked;
    var target = Math.min(systems.length, Math.max(unlockPlanetProgress(state), cur.length));
    var guard = 0;
    while (cur.length < target && guard++ < 100) {
      var added = false;
      for (var i = 0; i < systems.length; i++) {
        if (cur.indexOf(systems[i]) < 0) { cur.push(systems[i]); added = true; break; }
      }
      if (!added) break;
    }
  }

  // ---- 整秒边界：产量速率日志 + 带流量采样 ----
  function endSecondBookkeeping(state) {
    var acc = state._rateAcc, keys = Object.keys(acc), items = {}, i;
    for (i = 0; i < keys.length; i++) {
      if (acc[keys[i]] > 0) items[keys[i]] = acc[keys[i]];
    }
    if (Object.keys(items).length > 0) {
      state._rateLog.push({ t: state.time, items: items });
      if (state._rateLog.length > RATE_LOG_MAX) {
        state._rateLog.splice(0, state._rateLog.length - RATE_LOG_MAX);
      }
    }
    state._rateAcc = {};
    var consAcc = state._consAcc, ckeys = Object.keys(consAcc), citems = {}, j;
    for (j = 0; j < ckeys.length; j++) {
      if (consAcc[ckeys[j]] > 0) citems[ckeys[j]] = consAcc[ckeys[j]];
    }
    if (Object.keys(citems).length > 0) {
      state._consLog.push({ t: state.time, items: citems });
      if (state._consLog.length > RATE_LOG_MAX) {
        state._consLog.splice(0, state._consLog.length - RATE_LOG_MAX);
      }
    }
    state._consAcc = {};
    state._beltLast = state._beltAcc;
    state._beltAcc = {};
  }

  // ---- 单步核心（tick / advance / settleOffline 共用）----
  function tickCore(state, content, dt) {
    if (!(dt > 0) || !isFinite(dt)) return;
    content = content || {};
    if (!state.stats) state.stats = { totalProduced: {}, totalConsumed: {}, launchedSails: 0, launchedRockets: 0, playSeconds: 0 };
    if (!state.research) state.research = { current: null, progress: 0 };
    if (!state.dyson) state.dyson = { sails: 0, rockets: 0, spherePoints: 0, sailsLaunched: 0 };
    initTransients(state);

    var meta = cc(content);
    var gR = gridRatios(state, content, meta);
    var secBefore = Math.floor(state.time);

    state.time += dt;
    state.stats.playSeconds += dt;

    updateResearch(state, content, dt);
    updateVeins(state, content, meta, dt, gR.a.ratio); // 采矿机恒属电网 a
    updateBuildings(state, content, meta, dt, gR);
    updateBelts(state, content, meta, dt);

    if (Math.floor(state.time) > secBefore) endSecondBookkeeping(state);
    updateStationRoutes(state, content, dt); // 物流站出口路由（系统6，发货站=当前行星）
    processShipments(state, content, dt);    // 在途运输到货（系统6）
    tickOtherPlanets(state, content, dt);    // 后台行星轻量推进（系统6）
    syncGalaxy(state, content);
  }

  function tick(state, content, dtSeconds) {
    var dt = Number(dtSeconds) || 0;
    if (!(dt > 0)) return;
    if (dt > 1) dt = 1; // 单步上限保护，D 侧应按 1/SIM_HZ 调用
    tickCore(state, content, dt);
  }

  function advance(state, content, seconds) {
    var total = Math.max(0, Number(seconds) || 0);
    var steps = Math.floor(total / STEP + EPS);
    for (var i = 0; i < steps; i++) tickCore(state, content, STEP);
    var rem = total - steps * STEP;
    if (rem > EPS) tickCore(state, content, rem);
  }

  /* ============================ 命令 ============================ */

  function placeBuilding(state, content, opt) {
    content = content || {};
    opt = opt || {};
    var def = (content.BUILDINGS || {})[opt.typeId];
    if (!def) return errR('unknownBuilding');
    if (def.techId && (content.TECHNOLOGIES || {})[def.techId] &&
        state.unlockedTechs.indexOf(def.techId) < 0) return errR('techLocked');

    // 材料消耗：回收库（buildingReserve）有该建筑类型时优先免材料使用；
    // 否则检查 state.stock 是否足够，足够则扣除
    var reserve = state.buildingReserve || (state.buildingReserve = {});
    var useReserve = (reserve[def.id] || 0) > 0;
    if (useReserve) {
      reserve[def.id] -= 1;
    } else {
      var costs = def.costs;
      if (costs && costs.length) {
        for (var ci = 0; ci < costs.length; ci++) {
          var need = costs[ci];
          var have = (state.stock || {})[need.itemId] || 0;
          if (have < need.amount) return errR('insufficientMaterials');
        }
        for (var di = 0; di < costs.length; di++) {
          state.stock[costs[di].itemId] -= costs[di].amount;
        }
      }
    }

    var x = num(opt.x, 0), y = num(opt.y, 0);

    // v2：采矿机 → 叠加到最近矿脉（吸附脉心），不生成独立方块
    if (def.kind === 'miner') {
      var v = findVeinNear(state, x, y, ATTACH_DIST * 2);
      if (!v) return errR('notOnOre');
      if (!minerAcceptsItem(content, def, v.itemId)) return errR('wrongMinerForVein');
      // 单一型号锁：miners 只记数量，混放不同型号会让拆除时分不清拆掉的是哪一台
      if (v.minerType && v.minerType !== def.id) return errR('mixedMinerType');
      v.minerType = def.id;
      v.miners = (v.miners || 0) + 1;
      var cnt = minerCountsOf(content, v);
      cnt[def.id] = (cnt[def.id] || 0) + 1;
      return okR({ id: v.id, vein: v.id, miners: v.miners });
    }

    // v2：同型叠放 → count+1（效率/耗电/缓存 ×N）；异型重叠 → 拒绝
    var near = occupiedBy(state, content, x, y, null);
    if (near) {
      if (near.kind === 'building' && near.typeId === def.id) {
        var twin = state.buildings[near.id];
        twin.count = Math.max(1, num(twin.count, 1)) + 1;
        return okR({ id: twin.id, count: twin.count });
      }
      return errR('occupied');
    }
    var id = state.nextId++;
    state.buildings[id] = {
      id: id, typeId: def.id, x: x, y: y, count: 1,
      recipeId: null, inBuf: {}, outBuf: {},
      progress: 0, stalled: false, enabled: true,
      fuelItemId: (def.fuel && def.fuel.itemId) || null,
      energyMode: null, // 能量枢纽专用：'charge' | 'discharge'
      accSail: 0, accRocket: 0
    };
    return okR({ id: id });
  }

  // v2：拖动换位（建筑/矿脉通用）。建筑落点撞同型 → 并入其 count；撞异型/矿脉 → 拒绝
  function moveBuilding(state, content, id, x, y) {
    content = content || {};
    x = num(x, 0); y = num(y, 0);
    var v = veinOf(state, id);
    if (v) {
      var blocked = occupiedBy(state, content, x, y, id);
      if (blocked && blocked.kind === 'building') return errR('occupied');
      v.x = x; v.y = y;
      return okR({ id: id });
    }
    var b = state.buildings[id];
    if (!b) return errR('buildingNotFound');
    var near = occupiedBy(state, content, x, y, id);
    if (near) {
      if (near.kind === 'building' && near.typeId === b.typeId) {
        var twin = state.buildings[near.id];
        twin.count = Math.max(1, num(twin.count, 1)) + Math.max(1, num(b.count, 1));
        twin.inBuf = mergeBuf(twin.inBuf, b.inBuf);
        twin.outBuf = mergeBuf(twin.outBuf, b.outBuf);
        // 指向原块的连线重定向到并入目标，多余同向边删除
        var keys = Object.keys(state.belts);
        for (var i = 0; i < keys.length; i++) {
          var bl = state.belts[keys[i]];
          if (bl.fromId == id) bl.fromId = near.id; // eslint-disable-line eqeqeq
          if (bl.toId == id) bl.toId = near.id; // eslint-disable-line eqeqeq
        }
        for (i = 0; i < keys.length; i++) {
          var b1 = state.belts[keys[i]];
          if (!b1) continue;
          for (var j = i + 1; j < keys.length; j++) {
            var b2 = state.belts[keys[j]];
            if (b2 && b1.fromId === b2.fromId && b1.toId === b2.toId) delete state.belts[keys[j]];
          }
        }
        delete state.buildings[id];
        return okR({ id: num(near.id, near.id), mergedTo: num(near.id, near.id), count: twin.count });
      }
      return errR('occupied');
    }
    b.x = x; b.y = y;
    return okR({ id: id });
  }

  function mergeBuf(a, b) {
    var out = sortedCopy(a || {});
    for (var k in (b || {})) {
      if (b.hasOwnProperty(k)) out[k] = (out[k] || 0) + b[k];
    }
    return out;
  }

  // v2：手动采集——每点一次产出 10×(1+miners) 直入全局库存（储量无限直采）。
  function manualMine(state, content, veinId) {
    var v = veinOf(state, veinId);
    if (!v) return errR('buildingNotFound');
    var gained = 10 * (1 + (v.miners || 0));
    state.stock[v.itemId] = (state.stock[v.itemId] || 0) + gained;
    trackProduced(state, v.itemId, gained);
    return okR({ gained: gained });
  }

  // v2：矿脉信息卡（检查器/渲染用）
  function veinInfo(state, content, veinId) {
    var v = veinOf(state, veinId);
    if (!v) return null;
    var power = powerStats(state, content);
    return {
      id: v.id, itemId: v.itemId,
      name: (content.ITEMS[v.itemId] || {}).name || v.itemId,
      miners: v.miners || 0,
      buffer: round2(v.buffer || 0), cap: v.cap,
      ratePerSec: round4(MINER_RATE * veinSpeedSum(content, v) * power.ratio),
      percent: clamp01((v.buffer || 0) / v.cap),
      stalled: !!v.stalled
    };
  }

  function dumpBufToStock(state, buf) {
    for (var k in buf) {
      if (buf.hasOwnProperty(k) && buf[k] > 0) {
        state.stock[k] = (state.stock[k] || 0) + buf[k];
        buf[k] = 0;
      }
    }
  }

  function removeBuilding(state, content, id) {
    // v2：矿脉 → 拆除一台采矿机（miners-1，矿脉方块保留）
    var v = veinOf(state, id);
    if (v) {
      if (!(v.miners > 0)) return errR('nothingToRemove');
      v.miners -= 1;
      var mc = v.minerCounts || {};
      if (v.minerType && mc[v.minerType] > 0) { mc[v.minerType] -= 1; if (mc[v.minerType] <= 0) delete mc[v.minerType]; }
      if (v.miners <= 0) { v.minerType = null; v.minerCounts = {}; } // 清空型号锁，换另一种设备重新开采
      return okR({ miners: v.miners });
    }
    var b = state.buildings[id];
    if (!b) return errR('buildingNotFound');
    // v2：叠加块 → count-1，到 0 才真正拆除
    if (num(b.count, 1) > 1) {
      b.count -= 1;
      // 拆下的建筑进入回收库，再放置时免材料
      var res1 = state.buildingReserve || (state.buildingReserve = {});
      res1[b.typeId] = (res1[b.typeId] || 0) + 1;
      return okR({ count: b.count });
    }
    // 缓冲物退回全局库存，避免拆除丢料
    dumpBufToStock(state, b.inBuf || {});
    dumpBufToStock(state, b.outBuf || {});
    // 喷涂绑定清理：拆喷涂机 → 目标机器关闭喷涂；拆机器 → 解绑其喷涂机
    if (b.boundMachineId != null) {
      var target = state.buildings[b.boundMachineId];
      if (target) target.sprayMode = null;
    } else {
      var idsAll = Object.keys(state.buildings);
      for (var rj = 0; rj < idsAll.length; rj++) {
        if (state.buildings[idsAll[rj]].boundMachineId === id) state.buildings[idsAll[rj]].boundMachineId = null;
      }
    }
    delete state.buildings[id];
    // 整块拆除同样入回收库
    var res2 = state.buildingReserve || (state.buildingReserve = {});
    res2[b.typeId] = (res2[b.typeId] || 0) + 1;
    var keys = Object.keys(state.belts);
    for (var i = 0; i < keys.length; i++) {
      var bl = state.belts[keys[i]];
      if (bl.fromId == id || bl.toId == id) { // eslint-disable-line eqeqeq
        delete state.belts[keys[i]]; // 信贷模型无在途物品，直接删除关联边
      }
    }
    return okR();
  }

  // v2 端口类型化：方块可输出的物品集合 / 可接收的物品集合
  // 返回 null 表示「任意物品」（仓库/物流站类）；空数组表示无该端口。
  function outPortItems(state, content, nodeId) {
    var v = veinOf(state, nodeId);
    if (v) return [v.itemId];
    var b = state.buildings[nodeId];
    if (!b) return [];
    var def = defOf(content, b);
    if (!def) return [];
    if (def.kind === 'storage' || def.kind === 'station' || def.kind === 'splitter') return null; // 任意
    if (def.kind === 'lab') { // 研究站：矩阵产物直入 scienceStock，只输出非矩阵产物
      var r = b.recipeId ? (content.RECIPES || {})[b.recipeId] : null;
      var mids = content.MATRIX_ITEM_IDS || [];
      var nonMatrix = [];
      var outs = (r && r.outputs) || [];
      for (var i = 0; i < outs.length; i++) {
        if (mids.indexOf(outs[i].itemId) < 0) nonMatrix.push(outs[i].itemId);
      }
      return nonMatrix;
    }
    var recipe = b.recipeId ? (content.RECIPES || {})[b.recipeId] : null;
    var set = [];
    var os = (recipe && recipe.outputs) || [];
    for (i = 0; i < os.length; i++) set.push(os[i].itemId);
    return set;
  }

  function inPortItems(state, content, nodeId) {
    var v = veinOf(state, nodeId);
    if (v) return []; // 矿脉不可入料
    var b = state.buildings[nodeId];
    if (!b) return [];
    var def = defOf(content, b);
    if (!def) return [];
    if (def.kind === 'storage' || def.kind === 'station' || def.kind === 'splitter') return null; // 任意
    // 燃料发电机（系统5）：接收燃料供发电
    if (def.kind === 'power' && def.fuel) {
      var fid = fuelItemIdOf(content, b);
      return fid ? [fid] : [];
    }
    var recipe = b.recipeId ? (content.RECIPES || {})[b.recipeId] : null;
    var set = [];
    var ins = (recipe && recipe.inputs) || [];
    for (var i = 0; i < ins.length; i++) set.push(ins[i].itemId);
    return set;
  }

  // 设置物流站出口路由（系统6）：route = { itemId, toPid, amount, enabled }；null = 清除
  function setStationRoute(state, content, stationId, route) {
    content = content || {};
    var b = (state.buildings || {})[stationId];
    if (!b) return errR('buildingNotFound');
    var def = defOf(content, b);
    if (!def || def.kind !== 'station') return errR('notStation');
    if (route === null) { b.route = null; b.routeAcc = 0; return okR(); }
    route = route || {};
    var itemId = route.itemId;
    if (!itemId || !(content.ITEMS || {})[itemId]) return errR('unknownItem');
    var toPid = route.toPid;
    var toPlanet = (content.PLANETS || {})[toPid];
    if (!toPlanet) return errR('unknownPlanet');
    if (state.galaxyUnlocked.indexOf(toPlanet.systemId) < 0) return errR('systemLocked');
    if (toPid === state.planetId) return errR('samePlanet');
    b.route = {
      itemId: itemId,
      toPid: toPid,
      amount: Math.max(1, Math.floor(num(route.amount, 10))),
      enabled: route.enabled !== false
    };
    b.routeAcc = 0;
    return okR({ route: b.route });
  }

  function connectBelt(state, content, opt) {
    content = content || {};
    opt = opt || {};
    var fromOut = opt.fromId, toIn = opt.toId;
    var from = nodeById(state, fromOut);
    var to = nodeById(state, toIn);
    if (!from || !to) return errR('buildingNotFound');
    if (String(fromOut) === String(toIn)) return errR('selfConnect');
    if (!state.buildings[fromOut] && !state.veins[fromOut]) return errR('buildingNotFound');
    if (!state.buildings[toIn]) return errR('buildingNotFound'); // 终点只能是建筑
    var tier = (opt.tier == null) ? 1 : opt.tier;
    var meta = cc(content);
    if (meta.tiers.indexOf(tier) < 0) return errR('invalidTier');
    var keys = Object.keys(state.belts);
    for (var i = 0; i < keys.length; i++) {
      var bl = state.belts[keys[i]];
      if (String(bl.fromId) === String(fromOut) && String(bl.toId) === String(toIn)) return errR('duplicateBelt');
    }
    // ★ 类型校验：源输出 ∩ 目标输入 ≠ ∅
    var outs = outPortItems(state, content, fromOut);
    var ins = inPortItems(state, content, toIn);
    var itemId;
    if (outs === null && ins === null) return errR('itemMismatch');
    else if (outs === null) { if (!ins.length) return errR('itemMismatch'); itemId = ins[0]; }
    else if (ins === null) { if (!outs.length) return errR('itemMismatch'); itemId = outs[0]; }
    else {
      var inter = [];
      for (i = 0; i < outs.length; i++) { if (ins.indexOf(outs[i]) >= 0 && inter.indexOf(outs[i]) < 0) inter.push(outs[i]); }
      if (!inter.length) return errR('itemMismatch');
      itemId = inter[0];
    }
    var id = state.nextId++;
    state.belts[id] = { id: id, fromId: fromOut, toId: toIn, tier: tier, itemId: itemId, credit: 0, priority: 1 };
    return okR({ id: id, itemId: itemId });
  }

  function removeBelt(state, content, id) {
    if (!state.belts[id]) return errR('beltNotFound');
    delete state.belts[id];
    return okR();
  }

  function setRecipe(state, content, buildingId, recipeId) {
    content = content || {};
    var b = state.buildings[buildingId];
    if (!b) return errR('buildingNotFound');
    if (recipeId != null && recipeId === b.recipeId) return okR(); // 同配方不动作
    // 切换配方（含清除配方）：卡内缓存材料全部退回全局库存，避免锁死在错误配方里
    dumpBufToStock(state, b.inBuf || {});
    dumpBufToStock(state, b.outBuf || {});
    b.inBuf = {}; b.outBuf = {};
    if (recipeId == null) { b.recipeId = null; b.progress = 0; b.stalled = false; b.stallReason = null; return okR(); }
    var recipe = (content.RECIPES || {})[recipeId];
    if (!recipe) return errR('unknownRecipe');
    var def = defOf(content, b);
    var kind = def ? def.kind : null;
    if (kind !== 'machine' && kind !== 'lab' && kind !== 'station') return errR('wrongBuilding');
    if (recipe.requiredTechId && (content.TECHNOLOGIES || {})[recipe.requiredTechId] &&
        state.unlockedTechs.indexOf(recipe.requiredTechId) < 0) return errR('techLocked');
    if (recipe.buildingId && recipe.buildingId !== b.typeId) {
      var baseMap = content.RECIPE_BASE_BUILDING || {};
      var baseId = baseMap[b.typeId] || b.typeId;
      if (recipe.buildingId !== baseId) return errR('wrongBuilding');
    }
    b.recipeId = recipe.id;
    b.progress = 0;
    return okR();
  }

  function setFuelItemId(state, content, buildingId, itemId) {
    content = content || {};
    var b = state.buildings[buildingId];
    if (!b) return errR('buildingNotFound');
    var def = defOf(content, b);
    if (!def || def.kind !== 'power' || !def.fuel) return errR('wrongBuilding');
    if (!itemId || !(content.ITEMS || {})[itemId]) return errR('unknownItem');
    var options = def.fuel.options || [def.fuel.itemId];
    if (options.indexOf(itemId) < 0) return errR('invalidFuel');
    if (itemId === (b.fuelItemId || def.fuel.itemId)) return okR();
    // 切换燃料：清空缓存避免旧燃料锁死，退回全局库存
    dumpBufToStock(state, b.inBuf || {});
    dumpBufToStock(state, b.outBuf || {});
    b.inBuf = {}; b.outBuf = {};
    b.fuelItemId = itemId;
    b.progress = 0;
    b.stalled = false; b.stallReason = null;
    return okR();
  }

  // 能量枢纽充/放电模式切换（对齐参考 energy_exchanger：模式绑定对应配方）
  function setEnergyMode(state, content, buildingId, mode) {
    content = content || {};
    var b = state.buildings[buildingId];
    if (!b) return errR('buildingNotFound');
    var def = defOf(content, b);
    if (!def || def.id !== 'energy_hub') return errR('wrongBuilding');
    if (mode !== 'charge' && mode !== 'discharge') return errR('invalidEnergyMode');
    if (mode === (b.energyMode || 'charge')) return okR();
    b.energyMode = mode;
    b.stalled = false; b.stallReason = null;
    return okR();
  }

  // 库存 → 建筑输入缓存：手动投料（拖拽库存物品到建筑卡）
  function depositFromStock(state, content, buildingId, itemId, amount, opts) {
    content = content || {};
    var n = Math.floor(num(amount, Infinity));
    if (!(n > 0)) n = Infinity; // 缺省/非法值视为“尽量多”
    var b = state.buildings[buildingId];
    if (!b) return errR('buildingNotFound');
    if (!(content.ITEMS || {})[itemId]) return errR('unknownItem');
    var free = inputItemCapOf(content, b, itemId) - num(b.inBuf[itemId], 0);
    if (free <= 0) return errR('inputFull');
    var moved = 0;
    // 先从其他建筑的输出缓存拉取（建筑间无带补料），再从全局库存补
    if (opts && opts.fromOutputs) {
      var ids = Object.keys(state.buildings);
      for (var i = 0; i < ids.length && free > 0; i++) {
        var ob = state.buildings[ids[i]];
        if (ob === b) continue;
        var have = (ob.outBuf || {})[itemId] || 0;
        if (have <= 0) continue;
        var take = Math.min(have, n - moved, free);
        if (!(take > 0)) continue;
        ob.outBuf[itemId] = have - take;
        if (ob.outBuf[itemId] <= 0) delete ob.outBuf[itemId];
        b.inBuf[itemId] = (b.inBuf[itemId] || 0) + take;
        moved += take; free -= take;
      }
    }
    var have2 = state.stock[itemId] || 0;
    if (have2 > 0 && free > 0 && moved < n) {
      var take2 = Math.min(have2, n - moved, free);
      state.stock[itemId] -= take2;
      b.inBuf[itemId] = (b.inBuf[itemId] || 0) + take2;
      moved += take2;
    }
    if (!(moved > 0)) return errR('insufficientMaterials');
    b.stalled = false;
    if (b.stallReason === 'no_input') b.stallReason = null;
    return okR({ moved: moved });
  }

  // 建筑输入缓存 → 全局库存：取回材料（与 depositFromStock 对称；缺省 amount 表示全部）
  /** 建筑缓存 → 库存（srcBuf='out' 时取自输出缓存 outBuf，默认输入缓存 inBuf） */
  function withdrawFromStock(state, content, buildingId, itemId, amount, srcBuf) {
    content = content || {};
    var n = Math.floor(num(amount, Infinity));
    if (!(n > 0)) n = Infinity;
    var b = state.buildings[buildingId];
    if (!b) return errR('buildingNotFound');
    if (!(content.ITEMS || {})[itemId]) return errR('unknownItem');
    var bufKey = srcBuf === 'out' ? 'outBuf' : 'inBuf';
    var have = Math.floor(num(b[bufKey][itemId], 0));
    if (have <= 0) return errR('nothingToWithdraw');
    var moved = Math.min(have, n);
    b[bufKey][itemId] = have - moved;
    if (b[bufKey][itemId] <= 0) delete b[bufKey][itemId];
    state.stock[itemId] = (state.stock[itemId] || 0) + moved;
    return okR({ moved: moved });
  }

  // 一键补料：按配方输入（无配方则按燃料）把 inBuf 拉满，优先其他建筑输出缓存，再全局库存
  function fillInputs(state, content, buildingId) {
    content = content || {};
    var b = state.buildings[buildingId];
    if (!b) return errR('buildingNotFound');
    var def = defOf(content, b);
    if (!def) return errR('unknownBuilding');
    var recipe = b.recipeId ? ((content.RECIPES || {})[b.recipeId]) : null;
    var wants = [];
    if (recipe && (recipe.inputs || []).length) {
      for (var i = 0; i < recipe.inputs.length; i++) wants.push({ itemId: recipe.inputs[i].itemId, amount: num(recipe.inputs[i].amount, 0) });
    } else if (def.fuel) {
      var fuelId = fuelItemIdOf(content, b);
      if (fuelId) wants.push({ itemId: fuelId, amount: 1 });
    } else if (def.kind === 'lab') {
      return errR('noRecipe');
    } else {
      return errR('noRecipe');
    }
    var total = 0;
    for (var j = 0; j < wants.length; j++) {
      var w = wants[j];
      // 目标量：缓存里每种输入至少备 1 个周期的量（有富余容量则多备到 2 周期）
      var need = Math.max(w.amount, Math.min(inputItemCapOf(content, b, w.itemId) / 2, w.amount * 2));
      var cur = b.inBuf[w.itemId] || 0;
      if (cur >= w.amount) continue; // 该输入尚够一周期，跳过
      var r = depositFromStock(state, content, buildingId, w.itemId, Math.max(1, Math.ceil(need - cur)), { fromOutputs: true });
      if (r.ok) total += num(r.moved, 0);
    }
    if (!(total > 0)) return errR('insufficientMaterials');
    return okR({ moved: total });
  }

  function setBeltTier(state, content, beltId, tier) {
    var bl = state.belts[beltId];
    if (!bl) return errR('beltNotFound');
    var meta = cc(content);
    if (meta.tiers.indexOf(tier) < 0) return errR('invalidTier');
    bl.tier = tier;
    return okR();
  }

  // 多输出流量控制：给传送带设优先级 2=高 1=中(默认) 0=低。
  // 同源分配时高优先级档先吃满，剩余才溢流到下一档（分流器除外，恒为均衡）。
  function setBeltPriority(state, content, beltId, priority) {
    var bl = state.belts[beltId];
    if (!bl) return errR('beltNotFound');
    var p = num(priority, 1);
    bl.priority = (p === 2 ? 2 : (p === 0 ? 0 : 1));
    return okR();
  }

  function startResearch(state, content, techId) {
    content = content || {};
    var tech = (content.TECHNOLOGIES || {})[techId];
    if (!tech) return errR('unknownTech');
    if (state.unlockedTechs.indexOf(techId) >= 0) return errR('techUnlocked');
    if (!state.research) state.research = { current: null, progress: 0, queue: [] };
    if (!state.research.queue) state.research.queue = [];
    // 已有在研科技 → 加入排队（费用在轮到开始时支付）
    if (state.research.current) {
      if (state.research.current === techId) return errR('techInProgress');
      if (state.research.queue.indexOf(techId) >= 0) return errR('alreadyQueued');
      state.research.queue.push(techId);
      return okR({ queued: true, queueLength: state.research.queue.length });
    }
    if (!techPrereqOk(state, tech)) return errR('techPrerequisite');
    if (!techCanPay(state, tech)) return errR('notEnoughScience');
    techPay(state, tech);
    state.research.current = techId;
    state.research.progress = 0;
    return okR();
  }

  // 取消研究：current（放弃进度）或队列中某项
  function cancelResearch(state, content, techId) {
    if (!state.research) return errR('unknownTech');
    if (state.research.current === techId) {
      state.research.current = null;
      state.research.progress = 0;
      dequeueResearch(state, content); // 立即接队列
      return okR({ canceled: 'current' });
    }
    var i = (state.research.queue || []).indexOf(techId);
    if (i < 0) return errR('notQueued');
    state.research.queue.splice(i, 1);
    return okR({ canceled: 'queued' });
  }

  // 暂停研究：保留已投入进度，停掉当前项目（若队列有满足条件的科技则自动接上）
  function pauseResearch(state, content) {
    content = content || {};
    if (!state.research) state.research = { current: null, progress: 0, queue: [], paused: null };
    if (!state.research.current) return errR('noCurrentResearch');
    state.research.paused = { id: state.research.current, progress: num(state.research.progress, 0) };
    state.research.current = null;
    state.research.progress = 0;
    dequeueResearch(state, content);
    return okR();
  }

  // 继续研究：无在研项目时直接恢复；已有在研项目则放回队列最前
  function resumeResearch(state, content) {
    content = content || {};
    if (!state.research) state.research = { current: null, progress: 0, queue: [], paused: null };
    var p = state.research.paused;
    if (!p || !p.id) return errR('noPausedResearch');
    if (!(content.TECHNOLOGIES || {})[p.id]) { state.research.paused = null; return errR('unknownTech'); }
    if (!state.research.queue) state.research.queue = [];
    if (!state.research.current) {
      state.research.current = p.id;
      state.research.progress = num(p.progress, 0);
    } else if (state.research.queue.indexOf(p.id) < 0) {
      state.research.queue.unshift(p.id);
    }
    state.research.paused = null;
    return okR();
  }

  function launchSail(state, content) {
    var meta = cc(content);
    if (!meta.sailId) return errR('noSailItem');
    if ((state.stock[meta.sailId] || 0) < 1) return errR('noSail');
    state.stock[meta.sailId] -= 1;
    state.dyson.sails += 1;
    state.dyson.sailsLaunched += 1;
    state.stats.launchedSails += 1;
    return okR();
  }

  function launchRocket(state, content) {
    var meta = cc(content);
    if (!meta.rocketId) return errR('noRocketItem');
    if ((state.stock[meta.rocketId] || 0) < 1) return errR('noRocket');
    state.stock[meta.rocketId] -= 1;
    state.dyson.rockets += 1;
    state.dyson.spherePoints += POINTS_PER_ROCKET;
    state.stats.launchedRockets += 1;
    return okR();
  }

  function travelTo(state, content, planetId) {
    content = content || {};
    var planet = (content.PLANETS || {})[planetId];
    if (!planet) return errR('unknownPlanet');
    if (state.galaxyUnlocked.indexOf(planet.systemId) < 0) return errR('systemLocked');
    if (planetId === state.planetId) return okR();
    saveCurrentPlanet(state);
    state.planetId = planetId;
    var ps = state.planets[planetId];
    if (!ps) ps = state.planets[planetId] = { buildings: {}, belts: {}, veins: {}, stock: {}, buildingReserve: {} };
    if (!ps.veins || !Object.keys(ps.veins).length) ps.veins = generateVeins(planetId, content);
    state.buildings = ps.buildings;
    state.belts = ps.belts;
    state.veins = ps.veins;
    state.stock = ps.stock;
    state.buildingReserve = ps.buildingReserve;
    initTransients(state);
    return okR();
  }

  /* ==================== 多行星物流（系统6） ==================== */
  // 每行星独立 buildings/belts/veins/stock/buildingReserve（state.* 恒为「当前行星」视图）；
  // 后台行星按 ≥1s 的节拍轻量推进（矿脉/建筑/传送带/物流站路由）；
  // 星际运输走全局 shipments 队列：同星系 30s，跨星系 60s 且每次消耗 1 件空间翘曲器。
  var ROUTE_INTERVAL_SEC = 10;
  var SHIP_TRAVEL_SEC = 30;
  var SHIP_TRAVEL_WARP_SEC = 60;

  function planetBundleOf(state) {
    if (!state.planets) state.planets = {};
    if (!state.planets[state.planetId]) {
      state.planets[state.planetId] = {
        buildings: state.buildings, belts: state.belts, veins: state.veins,
        stock: state.stock, buildingReserve: state.buildingReserve
      };
    }
    return state.planets[state.planetId];
  }

  function saveCurrentPlanet(state) {
    planetBundleOf(state);
  }

  function sameSystemOf(state, content, pidA, pidB) {
    var pa = (content.PLANETS || {})[pidA];
    var pb = (content.PLANETS || {})[pidB];
    return !!(pa && pb && pa.systemId === pb.systemId);
  }

  // 后台行星轻量推进：引用临时切换，跑矿脉/建筑/传送带（含物流站发货），跑完存回
  function tickOtherPlanets(state, content, dt) {
    var pids = Object.keys(state.planets || {});
    for (var i = 0; i < pids.length; i++) {
      var pid = pids[i];
      if (pid === state.planetId) continue;
      var ps = state.planets[pid];
      if (!ps || !Object.keys(ps.buildings || {}).length) continue;
      state._planetAcc = state._planetAcc || {};
      var acc = (state._planetAcc[pid] || 0) + dt;
      if (acc < 1) { state._planetAcc[pid] = acc; continue; }
      state._planetAcc[pid] = 0;
      var step = Math.min(acc, 5); // 单次推进上限，避免卡顿
      var keep = { buildings: state.buildings, belts: state.belts, veins: state.veins, stock: state.stock, buildingReserve: state.buildingReserve, planetId: state.planetId };
      state.buildings = ps.buildings; state.belts = ps.belts; state.veins = ps.veins; state.stock = ps.stock; state.buildingReserve = ps.buildingReserve;
      state.planetId = pid;
      initTransients(state);
      var meta = cc(content);
      var gR = gridRatios(state, content, meta);
      updateVeins(state, content, meta, step, gR.a.ratio);
      updateBuildings(state, content, meta, step, gR);
      updateBelts(state, content, meta, step);
      ps.buildings = state.buildings; ps.belts = state.belts; ps.veins = state.veins; ps.stock = state.stock; ps.buildingReserve = state.buildingReserve;
      state.buildings = keep.buildings; state.belts = keep.belts; state.veins = keep.veins; state.stock = keep.stock; state.buildingReserve = keep.buildingReserve;
      state.planetId = keep.planetId;
      initTransients(state);
    }
  }

  function processShipments(state, content, dt) {
    var list = state.shipments || (state.shipments = []);
    for (var i = list.length - 1; i >= 0; i--) {
      var s = list[i];
      s.eta = num(s.eta, 0) - dt;
      if (s.eta > EPS) continue;
      var ps = state.planets[s.toPid];
      if (!ps) ps = state.planets[s.toPid] = { buildings: {}, belts: {}, veins: generateVeins(s.toPid, content), stock: {}, buildingReserve: {} };
      ps.stock[s.itemId] = (ps.stock[s.itemId] || 0) + num(s.amount, 0);
      list.splice(i, 1);
    }
  }

  /* ==================== 离线结算 / 存档 ==================== */

  function settleOffline(state, content, elapsedSeconds) {
    var elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    var capped = elapsed > MAX_OFFLINE_SEC + EPS;
    var seconds = Math.min(elapsed, MAX_OFFLINE_SEC);
    var before = {}, k;
    for (k in state.stats.totalProduced) {
      if (state.stats.totalProduced.hasOwnProperty(k)) before[k] = state.stats.totalProduced[k];
    }
    // 按 1s 步长推进真实模拟（理论吞吐近似：电力/矿脉/带宽约束全部生效）
    var steps = Math.floor(seconds / OFFLINE_STEP_SEC + EPS);
    for (var i = 0; i < steps; i++) tickCore(state, content, OFFLINE_STEP_SEC);
    var rem = seconds - steps * OFFLINE_STEP_SEC;
    if (rem > EPS) tickCore(state, content, rem);
    var produced = {};
    for (k in state.stats.totalProduced) {
      if (state.stats.totalProduced.hasOwnProperty(k)) {
        var delta = state.stats.totalProduced[k] - (before[k] || 0);
        if (delta > 0) produced[k] = delta;
      }
    }
    return { produced: produced, seconds: seconds, capped: capped };
  }

  // 序列化后台行星包（系统6）：当前行星走顶层字段，其余行星逐包挑选字段
  function normalizeBeltSave(bl) {
    return { id: bl.id, fromId: bl.fromId, toId: bl.toId, tier: num(bl.tier, 1), itemId: bl.itemId || null, credit: round6(bl.credit || 0), priority: beltPriorityOf(bl) };
  }

  function planetsToSave(state) {
    saveCurrentPlanet(state);
    var out = {};
    var pids = Object.keys(state.planets || {});
    for (var i = 0; i < pids.length; i++) {
      var pid = pids[i];
      if (pid === state.planetId) continue;
      var ps = state.planets[pid];
      if (!ps) continue;
      var buildings = {};
      var bkeys = Object.keys(ps.buildings || {});
      for (var j = 0; j < bkeys.length; j++) {
        buildings[bkeys[j]] = normalizeBuilding(ps.buildings[bkeys[j]]);
      }
      var belts = {};
      var blkeys = Object.keys(ps.belts || {});
      for (j = 0; j < blkeys.length; j++) belts[blkeys[j]] = normalizeBeltSave(ps.belts[blkeys[j]]);
      out[pid] = {
        buildings: buildings,
        belts: belts,
        veins: ps.veins || {},
        stock: sortedCopy(ps.stock || {}),
        buildingReserve: sortedCopy(ps.buildingReserve || {})
      };
    }
    // 路由目标行星（从未激活过）生成占位包，保证存档/运输完整
    var cur = state.planets[state.planetId] || {};
    var cbk = Object.keys(cur.buildings || {});
    for (var ci = 0; ci < cbk.length; ci++) {
      var rt = cur.buildings[cbk[ci]] && cur.buildings[cbk[ci]].route;
      if (!rt || !rt.toPid || out[rt.toPid] || rt.toPid === state.planetId) continue;
      out[rt.toPid] = {
        buildings: {}, belts: {},
        veins: {},
        stock: {}, buildingReserve: {}
      };
    }
    return out;
  }

  function serialize(state) {
    var buildings = {}, belts = {}, veins = {}, i;
    var ids = Object.keys(state.buildings || {});
    for (i = 0; i < ids.length; i++) {
      var b = state.buildings[ids[i]];
      buildings[ids[i]] = {
        id: b.id, typeId: b.typeId, x: b.x, y: b.y, count: Math.max(1, num(b.count, 1)),
        recipeId: b.recipeId || null,
        grid: b.grid || 'a',
        inBuf: sortedCopy(b.inBuf || {}), outBuf: sortedCopy(b.outBuf || {}),
        progress: b.progress || 0, stalled: !!b.stalled, enabled: b.enabled !== false,
        fuelItemId: b.fuelItemId || null,
        energyMode: b.energyMode || null,
        sprayMode: b.sprayMode || null, boundMachineId: b.boundMachineId || null,
        route: b.route ? { itemId: b.route.itemId, toPid: b.route.toPid, amount: num(b.route.amount, 10), enabled: b.route.enabled !== false } : null,
        accSail: b.accSail || 0, accRocket: b.accRocket || 0
      };
    }
    var bkeys = Object.keys(state.belts || {});
    for (i = 0; i < bkeys.length; i++) {
      var bl = state.belts[bkeys[i]];
      belts[bkeys[i]] = {
        id: bl.id, fromId: bl.fromId, toId: bl.toId, tier: bl.tier, itemId: bl.itemId || null,
        credit: round6(bl.credit || 0),
        priority: beltPriorityOf(bl)
      };
    }
    var vkeys = Object.keys(state.veins || {});
    for (i = 0; i < vkeys.length; i++) {
      var v = state.veins[vkeys[i]];
      veins[vkeys[i]] = {
        id: v.id, itemId: v.itemId, x: v.x, y: v.y,
        miners: v.miners || 0, buffer: round6(v.buffer || 0), cap: v.cap || VEIN_CAP,
        minerType: v.minerType || null
      };
    }
    return {
      version: 2,
      planetId: state.planetId,
      galaxyUnlocked: (state.galaxyUnlocked || []).slice(),
      time: state.time || 0,
      nextId: state.nextId || 1,
      buildings: buildings,
      belts: belts,
      veins: veins,
      stock: sortedCopy(state.stock || {}),
      buildingReserve: sortedCopy(state.buildingReserve || {}),
      // 多行星物流（系统6）：后台行星包 + 在途运输队列（当前行星取顶层字段）
      planets: planetsToSave(state),
      shipments: (state.shipments || []).map(function (s) {
        return { id: s.id, fromPid: s.fromPid, toPid: s.toPid, itemId: s.itemId, amount: num(s.amount, 0), eta: round2(s.eta) };
      }),
      nextShipmentId: state.nextShipmentId || 1,
      scienceStock: sortedCopy(state.scienceStock || {}),
      research: {
        current: (state.research && state.research.current) || null,
        progress: (state.research && state.research.progress) || 0,
        queue: ((state.research && state.research.queue) || []).slice(),
        paused: (state.research && state.research.paused)
          ? { id: state.research.paused.id, progress: num(state.research.paused.progress, 0) }
          : null
      },
      unlockedTechs: (state.unlockedTechs || []).slice(),
      dyson: {
        sails: num(state.dyson && state.dyson.sails, 0),
        rockets: num(state.dyson && state.dyson.rockets, 0),
        spherePoints: num(state.dyson && state.dyson.spherePoints, 0),
        nodes: ((state.dyson && state.dyson.nodes) || []).map(function (n) {
          return { orbit: num(n.orbit, 0), slot: num(n.slot, 0) };
        }),
        sailsLaunched: num(state.dyson && state.dyson.sailsLaunched, 0)
      },
      stats: {
        totalProduced: sortedCopy((state.stats && state.stats.totalProduced) || {}),
        totalConsumed: sortedCopy((state.stats && state.stats.totalConsumed) || {}),
        launchedSails: num(state.stats && state.stats.launchedSails, 0),
        launchedRockets: num(state.stats && state.stats.launchedRockets, 0),
        playSeconds: num(state.stats && state.stats.playSeconds, 0)
      }
    };
  }

  function normalizeBuilding(saved) {
    return {
      id: num(saved.id, 0),
      typeId: saved.typeId,
      x: num(saved.x, 0), y: num(saved.y, 0),
      count: Math.max(1, num(saved.count, 1)),
      recipeId: saved.recipeId == null ? null : saved.recipeId,
      inBuf: (saved.inBuf && typeof saved.inBuf === 'object') ? sortedCopy(saved.inBuf) : {},
      outBuf: (saved.outBuf && typeof saved.outBuf === 'object') ? sortedCopy(saved.outBuf) : {},
      progress: num(saved.progress, 0),
      stalled: !!saved.stalled,
      enabled: saved.enabled !== false,
      grid: (saved.grid === 'b' || saved.grid === 'c') ? saved.grid : 'a',
      sprayMode: (saved.sprayMode === 'extra' || saved.sprayMode === 'speed') ? saved.sprayMode : null,
      fuelItemId: saved.fuelItemId == null ? null : saved.fuelItemId,
      energyMode: (saved.energyMode === 'discharge' || saved.energyMode === 'charge') ? saved.energyMode : null,
      boundMachineId: saved.boundMachineId == null ? null : saved.boundMachineId,
      route: (saved.route && saved.route.itemId && saved.route.toPid)
        ? { itemId: saved.route.itemId, toPid: saved.route.toPid, amount: Math.max(1, Math.floor(num(saved.route.amount, 10))), enabled: saved.route.enabled !== false }
        : null,
      accSail: num(saved.accSail, 0),
      accRocket: num(saved.accRocket, 0)
    };
  }

  function deserialize(json, content) {
    content = content || {};
    var data = null;
    if (typeof json === 'string') {
      try { data = JSON.parse(json); } catch (e) { data = null; }
    } else {
      data = json;
    }
    if (!data || typeof data !== 'object') return null;
    // v2 版本闸门：非 v2 存档一律拒绝（上层提示「版本过旧」）
    if (num(data.version, 0) !== 2) return null;

    var st = createInitialState(content, data.planetId);
    st.time = num(data.time, 0);
    if (Object.prototype.toString.call(data.galaxyUnlocked) === '[object Array]') {
      st.galaxyUnlocked = data.galaxyUnlocked.filter(function (s) { return typeof s === 'string'; }).slice();
    }
    if (!st.galaxyUnlocked.length) {
      var p = (content.PLANETS || {})[st.planetId];
      if (p && p.systemId) st.galaxyUnlocked = [p.systemId];
    }

    // 矿脉（v2）：读档恢复；缺失/损坏的矿脉用确定性生成兜底
    if (data.veins && typeof data.veins === 'object') {
      var vk = Object.keys(data.veins);
      var restored = {};
      for (var m = 0; m < vk.length; m++) {
        var sv = data.veins[vk[m]];
        if (!sv || !sv.itemId) continue;
        restored[vk[m]] = {
          id: vk[m], itemId: sv.itemId,
          x: num(sv.x, 0), y: num(sv.y, 0),
          miners: Math.max(0, num(sv.miners, 0)),
          buffer: Math.max(0, num(sv.buffer, 0)),
          cap: Math.max(1, num(sv.cap, VEIN_CAP)),
          minerType: sv.minerType || null
        };
      }
      if (Object.keys(restored).length > 0) st.veins = restored;
    }

    // 建筑（含 v2 叠加计数）

    // 库存（合并覆盖，保留矩阵零值键）
    if (data.stock && typeof data.stock === 'object') {
      var sk = Object.keys(data.stock);
      for (m = 0; m < sk.length; m++) st.stock[sk[m]] = num(data.stock[sk[m]], 0);
    }
    if (data.scienceStock && typeof data.scienceStock === 'object') {
      var ck = Object.keys(data.scienceStock);
      for (m = 0; m < ck.length; m++) st.scienceStock[ck[m]] = num(data.scienceStock[ck[m]], 0);
    }
    // 回收库（拆除建筑）：缺失时保持空表，兼容旧 v2 档
    st.buildingReserve = {};
    if (data.buildingReserve && typeof data.buildingReserve === 'object') {
      var rk = Object.keys(data.buildingReserve);
      for (m = 0; m < rk.length; m++) {
        var rn = Math.floor(num(data.buildingReserve[rk[m]], 0));
        if (rn > 0 && (content.BUILDINGS || {})[rk[m]]) st.buildingReserve[rk[m]] = rn;
      }
    }

    // 建筑 / 传送带
    st.buildings = {};
    if (data.buildings && typeof data.buildings === 'object') {
      var bk = Object.keys(data.buildings);
      for (m = 0; m < bk.length; m++) {
        var nb = normalizeBuilding(data.buildings[bk[m]]);
        if (nb.typeId) st.buildings[bk[m]] = nb;
      }
    }
    st.belts = {};
    if (data.belts && typeof data.belts === 'object') {
      var blk = Object.keys(data.belts);
      for (m = 0; m < blk.length; m++) {
        var ob = data.belts[blk[m]];
        if (!ob || ob.fromId == null || ob.toId == null) continue; // eslint-disable-line eqeqeq
        st.belts[blk[m]] = {
          id: num(ob.id, 0),
          fromId: ob.fromId, toId: ob.toId,
          tier: num(ob.tier, 1),
          itemId: ob.itemId || null,
          credit: Math.max(0, num(ob.credit, 0)),
          priority: (num(ob.priority, 1) === 2 ? 2 : (num(ob.priority, 1) === 0 ? 0 : 1))
        };
      }
    }

    // id 计数器兜底
    var maxId = 0, anyKey;
    for (anyKey in st.buildings) maxId = Math.max(maxId, num(st.buildings[anyKey].id, 0));
    for (anyKey in st.belts) maxId = Math.max(maxId, num(st.belts[anyKey].id, 0));
    st.nextId = Math.max(num(data.nextId, 1), maxId + 1, 1);

    // 多行星物流（系统6）：后台行星包 + 在途运输队列（当前行星走顶层字段）
    st.planets = {};
    st.planets[st.planetId] = { buildings: st.buildings, belts: st.belts, veins: st.veins, stock: st.stock, buildingReserve: st.buildingReserve };
    if (data.planets && typeof data.planets === 'object') {
      var pks = Object.keys(data.planets);
      for (var pi = 0; pi < pks.length; pi++) {
        var pidx = pks[pi];
        if (pidx === st.planetId) continue;
        var pd = data.planets[pidx];
        if (!pd || typeof pd !== 'object') continue;
        var pb = {};
        var pbk = Object.keys(pd.buildings || {});
        for (var pj = 0; pj < pbk.length; pj++) {
          var pnb = normalizeBuilding(pd.buildings[pbk[pj]]);
          if (pnb.typeId) pb[pbk[pj]] = pnb;
        }
        var pbl = {};
        var pblk = Object.keys(pd.belts || {});
        for (pj = 0; pj < pblk.length; pj++) {
          var pbo = pd.belts[pblk[pj]];
          if (!pbo || pbo.fromId == null || pbo.toId == null) continue; // eslint-disable-line eqeqeq
          pbl[pblk[pj]] = {
            id: num(pbo.id, 0), fromId: pbo.fromId, toId: pbo.toId,
            tier: num(pbo.tier, 1), itemId: pbo.itemId || null,
            credit: Math.max(0, num(pbo.credit, 0)),
            priority: (num(pbo.priority, 1) === 2 ? 2 : (num(pbo.priority, 1) === 0 ? 0 : 1))
          };
        }
        st.planets[pidx] = {
          buildings: pb,
          belts: pbl,
          veins: (pd.veins && Object.keys(pd.veins).length) ? pd.veins : generateVeins(pidx, content),
          stock: sortedCopy(pd.stock || {}),
          buildingReserve: sortedCopy(pd.buildingReserve || {})
        };
      }
    }
    st.shipments = [];
    if (Object.prototype.toString.call(data.shipments) === '[object Array]') {
      for (var si = 0; si < data.shipments.length; si++) {
        var sh = data.shipments[si];
        if (!sh || !sh.itemId || !sh.toPid) continue;
        if (!(num(sh.amount, 0) > 0)) continue;
        st.shipments.push({ id: num(sh.id, 0), fromPid: sh.fromPid, toPid: sh.toPid, itemId: sh.itemId, amount: num(sh.amount, 0), eta: num(sh.eta, 0) });
      }
    }
    st.nextShipmentId = Math.max(1, num(data.nextShipmentId, 1));

    // 传送带补 itemId（v2 老边缺省时按端点类型推断，推断不出则置空不搬运）
    for (anyKey in st.belts) {
      var bb = st.belts[anyKey];
      if (bb.itemId) continue;
      var sf = veinOf(st, bb.fromId);
      if (sf) { bb.itemId = sf.itemId; continue; }
      var bf = st.buildings[bb.fromId];
      var rf = bf && bf.recipeId ? (content.RECIPES || {})[bf.recipeId] : null;
      bb.itemId = (rf && rf.outputs && rf.outputs[0]) ? rf.outputs[0].itemId : null;
    }

    if (data.research && typeof data.research === 'object') {
      st.research = {
        current: data.research.current || null,
        progress: num(data.research.progress, 0),
        queue: (Object.prototype.toString.call(data.research.queue) === '[object Array]')
          ? data.research.queue.filter(function (t) { return typeof t === 'string' && (content.TECHNOLOGIES || {})[t]; })
          : [],
        paused: (data.research.paused && (content.TECHNOLOGIES || {})[data.research.paused.id])
          ? { id: data.research.paused.id, progress: num(data.research.paused.progress, 0) }
          : null
      };
    }
    if (Object.prototype.toString.call(data.unlockedTechs) === '[object Array]') {
      st.unlockedTechs = data.unlockedTechs.filter(function (s2) { return typeof s2 === 'string'; }).slice();
    }
    if (data.dyson && typeof data.dyson === 'object') {
      st.dyson = {
        sails: num(data.dyson.sails, 0), rockets: num(data.dyson.rockets, 0),
        spherePoints: num(data.dyson.spherePoints, 0), sailsLaunched: num(data.dyson.sailsLaunched, 0),
        nodes: (Object.prototype.toString.call(data.dyson.nodes) === '[object Array]')
          ? data.dyson.nodes.filter(function (n) { return n && dysonValidSlot(num(n.orbit, -1), num(n.slot, -1)); }).map(function (n) { return { orbit: num(n.orbit, 0), slot: num(n.slot, 0) }; })
          : []
      };
    }
    if (data.stats && typeof data.stats === 'object') {
      var tp = {};
      if (data.stats.totalProduced && typeof data.stats.totalProduced === 'object') {
        var tk = Object.keys(data.stats.totalProduced);
        for (m = 0; m < tk.length; m++) tp[tk[m]] = num(data.stats.totalProduced[tk[m]], 0);
      }
      var tc = {};
      if (data.stats.totalConsumed && typeof data.stats.totalConsumed === 'object') {
        var ck2 = Object.keys(data.stats.totalConsumed);
        for (m = 0; m < ck2.length; m++) tc[ck2[m]] = num(data.stats.totalConsumed[ck2[m]], 0);
      }
      st.stats = {
        totalProduced: tp,
        totalConsumed: tc,
        launchedSails: num(data.stats.launchedSails, 0),
        launchedRockets: num(data.stats.launchedRockets, 0),
        playSeconds: num(data.stats.playSeconds, 0)
      };
    }
    st.version = 2;
    initTransients(st);
    return st;
  }

  /* ============================ 查询 ============================ */

  function stockList(state) {
    var out = [], keys = Object.keys(state.stock || {}).sort();
    for (var i = 0; i < keys.length; i++) {
      var n = state.stock[keys[i]];
      if (n > 0) out.push({ itemId: keys[i], amount: round6(n) });
    }
    return out;
  }

  function productionRates(state, content, windowSec) {
    var win = Math.max(1, Number(windowSec) || 10);
    var now = state.time || 0;
    var log = state._rateLog || [];
    var sum = {}, oldest = Infinity, i, k;
    for (i = 0; i < log.length; i++) {
      var e = log[i];
      if (e.t > now - win && e.t <= now + EPS) {
        if (e.t < oldest) oldest = e.t;
        for (k in e.items) sum[k] = (sum[k] || 0) + e.items[k];
      }
    }
    var keys = Object.keys(sum);
    if (!keys.length) return [];
    var span = Math.max(1, Math.min(win, now - oldest));
    var out = [];
    keys.sort();
    for (i = 0; i < keys.length; i++) {
      if (sum[keys[i]] > 0) out.push({ itemId: keys[i], perSec: round4(sum[keys[i]] / span) });
    }
    return out;
  }

  // 消耗速率（与 productionRates 对称，读 _consLog）
  function consumptionRates(state, content, windowSec) {
    var win = Math.max(1, Number(windowSec) || 10);
    var now = state.time || 0;
    var log = state._consLog || [];
    var sum = {}, oldest = Infinity, i, k;
    for (i = 0; i < log.length; i++) {
      var e = log[i];
      if (e.t > now - win && e.t <= now + EPS) {
        if (e.t < oldest) oldest = e.t;
        for (k in e.items) sum[k] = (sum[k] || 0) + e.items[k];
      }
    }
    var keys = Object.keys(sum);
    if (!keys.length) return [];
    var span = Math.max(1, Math.min(win, now - oldest));
    var out = [];
    keys.sort();
    for (i = 0; i < keys.length; i++) {
      if (sum[keys[i]] > 0) out.push({ itemId: keys[i], perSec: round4(sum[keys[i]] / span) });
    }
    return out;
  }

  function beltFlow(state, beltId) {
    var belt = state.belts[beltId];
    if (!belt) return null;
    var item = belt.itemId || state._beltItem[beltId] || null;
    return { item: item, perSec: round4(state._beltLast[beltId] || 0) };
  }

  // v2：连线类型预校验（供 C 在拖线预览时本地判定，规则与 connectBelt 一致）
  function canConnect(state, content, fromId, toId) {
    if (String(fromId) === String(toId)) return false;
    if (!nodeById(state, fromId) || !state.buildings[toId]) return false;
    var outs = outPortItems(state, content, fromId);
    var ins = inPortItems(state, content, toId);
    if (outs === null && ins === null) return false;
    if (outs === null) return ins.length > 0;
    if (ins === null) return outs.length > 0;
    for (var i = 0; i < outs.length; i++) { if (ins.indexOf(outs[i]) >= 0) return true; }
    return false;
  }

  // 附加查询（供 UI 显示科研进度条，非契约必需）
  function researchInfo(state, content) {
    var r = state.research || { current: null, progress: 0, queue: [] };
    var tech = r.current ? ((content.TECHNOLOGIES || {})[r.current]) : null;
    var pTech = r.paused ? ((content.TECHNOLOGIES || {})[r.paused.id]) : null;
    return {
      techId: r.current,
      progress: r.progress || 0,
      demand: tech ? researchDemandOf(tech) : 0,
      labCount: countLabs(state, content),
      queue: (r.queue || []).slice(),
      paused: r.paused ? {
        id: r.paused.id,
        name: pTech ? pTech.name : r.paused.id,
        progress: num(r.paused.progress, 0),
        demand: pTech ? researchDemandOf(pTech) : 0
      } : null
    };
  }

  /* ============================ 挂载 ============================ */

  global.DSP_ENGINE = {
    SIM_HZ: SIM_HZ,

    createInitialState: createInitialState,
    tick: tick,
    advance: advance,

    placeBuilding: placeBuilding,
    minerAcceptsItem: minerAcceptsItem,
    removeBuilding: removeBuilding,
    moveBuilding: moveBuilding,
    manualMine: manualMine,
    veinInfo: veinInfo,
    canConnect: canConnect,
    connectBelt: connectBelt,
    removeBelt: removeBelt,
    setRecipe: setRecipe,
    setFuelItemId: setFuelItemId,
    fuelBurnRateOf: fuelBurnRateOf,
    setEnergyMode: setEnergyMode,
    setBeltTier: setBeltTier,
    setBeltPriority: setBeltPriority,
    depositFromStock: depositFromStock,
    withdrawFromStock: withdrawFromStock,
    fillInputs: fillInputs,
    bindSprayCoater: bindSprayCoater,
    setSprayMode: setSprayMode,
    unbindSprayCoater: unbindSprayCoater,
    sprayTierOf: sprayTierOf,
    setStationRoute: setStationRoute,

    startResearch: startResearch,
    cancelResearch: cancelResearch,
    pauseResearch: pauseResearch,
    resumeResearch: resumeResearch,
    launchSail: launchSail,
    launchRocket: launchRocket,

    travelTo: travelTo,
    unlockPlanetProgress: unlockPlanetProgress,

    settleOffline: settleOffline,
    serialize: serialize,
    deserialize: deserialize,

    powerStats: powerStats,
    gridRatios: gridRatios,
    computePower: computePower,
    stockList: stockList,
    productionRates: productionRates,
    consumptionRates: consumptionRates,
    inputCapOf: inputCapOf,
    inputItemCapOf: inputItemCapOf,
    beltFlow: beltFlow,
    dysonProgress: dysonProgress,
    dysonLayout: dysonLayout,
    placeDysonNode: placeDysonNode,
    removeDysonNode: removeDysonNode,
    moveDysonNode: moveDysonNode,
    dysonNodeAt: dysonNodeAt,
    DYSON_NODE_COST: DYSON_NODE_COST,

    // —— 附加（UI 可选消费）——
    researchInfo: researchInfo,
    researchDemandOf: researchDemandOf,
    DYSON_SAIL_GOAL: DYSON_SAIL_GOAL,
    DYSON_POINT_GOAL: DYSON_POINT_GOAL
  };

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
