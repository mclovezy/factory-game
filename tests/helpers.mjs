/* =========================================================================
 * tests/helpers.mjs — 测试共享装载器（非 *.test.mjs，不会被 node --test 收集）
 * -------------------------------------------------------------------------
 * 被测代码全部是经典脚本（IIFE 挂 globalThis），因此测试采用
 * “读文件 + 间接 eval”的方式装载，与浏览器 <script src> 行为一致。
 * ========================================================================= */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 以经典脚本语义执行一个 src 文件（挂载其 globalThis 命名空间） */
export function loadScript(rel) {
  const file = path.join(ROOT, rel);
  const code = readFileSync(file, 'utf8');
  (0, eval)(code + `\n//# sourceURL=${rel}`);
}

/** 装载内容目录 + 引擎（content 必须先于 engine，与 index.html 顺序一致） */
export function loadContentAndEngine() {
  loadScript('src/data/content.js');
  loadScript('src/engine/engine.js');
  return { content: globalThis.DSP_CONTENT, engine: globalThis.DSP_ENGINE };
}

/** 装载存档模块（调用其 API 前需先 loadContentAndEngine） */
export function loadStorage() {
  loadScript('src/save/storage.js');
  return globalThis.DSP_SAVE;
}

/** 主行星 id：优先 'home'，其次 isHome 标记，最后第一个 */
export function homePlanetId(content) {
  const planets = content.PLANETS;
  if (planets.home) return 'home';
  const ids = Object.keys(planets);
  for (const id of ids) if (planets[id].isHome) return id;
  return ids[0];
}

/**
 * 搭一条电磁矩阵生产线：
 *   铁矿×2 / 铜矿×2 采矿机 → 熔炉（铁块 / 磁铁 / 铜块×2）→ 铜线×2 →
 *   磁线圈 / 电路板 → 矩阵研究站（电磁矩阵，产物直入 scienceStock）
 * 16 台风机 = 4800kW > 全链需求（全速运转）。
 * 注意：place 返回建筑对象（含 id/x/y），避免把数字 id 误当坐标源。
 */
export function buildMatrixChain(engine, content) {
  const state = engine.createInitialState(content, homePlanetId(content));

  // 测试用途：注入足够材料以覆盖全部建筑成本
  const grant = { iron_ingot: 200, gear: 80, magnetic_coil: 80, circuit_board: 60, stone_brick: 20, glass: 10, copper_ingot: 15 };
  for (const k in grant) state.stock[k] = (state.stock[k] || 0) + grant[k];

  const veinOf = (itemId) => {
    const v = state.veins['vein-' + itemId];
    if (!v) throw new Error(`矿脉缺失: ${itemId}`);
    return v;
  };
  const place = (typeId, x, y) => {
    const r = engine.placeBuilding(state, content, { typeId, x, y });
    if (!r.ok) throw new Error(`placeBuilding(${typeId}) 失败: ${JSON.stringify(r)}`);
    return r.id;
  };
  const belt = (fromId, toId) => {
    const r = engine.connectBelt(state, content, { fromId, toId, tier: 1 });
    if (!r.ok) throw new Error(`connectBelt(${fromId}->${toId}) 失败: ${JSON.stringify(r)}`);
    return r.id;
  };
  const recipe = (bId, recipeId) => {
    const r = engine.setRecipe(state, content, bId, recipeId);
    if (!r.ok) throw new Error(`setRecipe(${recipeId}) 失败: ${JSON.stringify(r)}`);
  };

  const vFe = veinOf('iron_ore');
  const vCu = veinOf('copper_ore');

  for (let i = 0; i < 16; i++) place('wind_turbine', -400 + 80 * i, -700);

  // 矿机：铁矿脉 ×2、铜矿脉 ×2（v2：叠加为矿脉 miners 计数，不占独立方块）
  place('mining_machine', vFe.x + 10, vFe.y + 10);
  place('mining_machine', vFe.x - 10, vFe.y - 10);
  place('mining_machine', vCu.x + 10, vCu.y + 10);
  place('mining_machine', vCu.x - 10, vCu.y - 10);

  // 布局要点：最终汇入实验室的两条腿保持短腿，长距离运输放在上游
  //   aBoard(-180,0) → lab(0,0) ← aCoil(180,0)
  const lab = place('matrix_lab', 0, 0);
  const aBoard = place('assembler_mk1', -180, 0);
  const aCoil = place('assembler_mk1', 180, 0);
  const wBoard = place('assembler_mk1', -360, 120);
  const wCoil = place('assembler_mk1', 360, 120);
  const sIngot = place('arc_smelter', -360, 0);
  const sMagnet = place('arc_smelter', 360, 0);
  const sCopA = place('arc_smelter', 360, 240);
  const sCopB = place('arc_smelter', -360, 240);
  recipe(sIngot, 'iron_ingot');
  recipe(sMagnet, 'magnet');
  recipe(sCopA, 'copper_ingot');
  recipe(sCopB, 'copper_ingot');
  recipe(wCoil, 'copper_wire');
  recipe(wBoard, 'copper_wire');
  recipe(aCoil, 'magnetic_coil');
  recipe(aBoard, 'circuit_board');
  recipe(lab, 'electromagnetic_matrix');

  // 传送带：矿脉→熔炉（长腿，同脉可多出带），熔炉→铜线，铜线→组装，组装→lab
  belt(vFe.id, sIngot);
  belt(vFe.id, sMagnet);
  belt(vCu.id, sCopA);
  belt(vCu.id, sCopB);
  belt(sIngot, aBoard);
  belt(sCopB, wBoard);
  belt(sCopA, wCoil);
  belt(sMagnet, aCoil);
  belt(wBoard, aBoard);
  belt(wCoil, aCoil);
  belt(aBoard, lab);
  belt(aCoil, lab);

  return { state, buildings: { lab, aCoil, aBoard, sMagnet }, veins: { vFe, vCu } };
}

/** 分块推进直到电磁矩阵库存达到 need（确定性，带总时长保护） */
export function advanceUntilMatrix(engine, content, state, need, chunk = 60, maxSeconds = 3600) {
  let elapsed = 0;
  while ((state.scienceStock.electromagnetic_matrix || 0) < need && elapsed < maxSeconds) {
    engine.advance(state, content, chunk);
    elapsed += chunk;
  }
  return elapsed;
}
