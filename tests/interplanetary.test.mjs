// interplanetary —— 行星间自动物流（系统6）：多行星状态/出口路由/运输队列/曲率航行/存档往返
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

function findOtherPlanet(state, sameSystem) {
  const home = content.PLANETS[state.planetId];
  const ids = Object.keys(content.PLANETS);
  for (const id of ids) {
    if (id === state.planetId) continue;
    const p = content.PLANETS[id];
    if (state.galaxyUnlocked.indexOf(p.systemId) < 0) continue;
    if (sameSystem && p.systemId === home.systemId) return id;
    if (!sameSystem && p.systemId !== home.systemId) return id;
  }
  return null;
}

function fresh() {
  const state = engine.createInitialState(content, homePlanetId(content));
  // 解锁全部星系 + 物流科技，方便找同星系/跨星系目标
  state.galaxyUnlocked = Object.keys(content.STAR_SYSTEMS || {});
  state.unlockedTechs.push('planetary_logistics', 'interstellar_logistics');
  // 注入建造材料
  const g = { iron_ingot: 300, steel: 300, titanium_ingot: 300, stone_brick: 200, circuit_board: 200, processor: 200, graphene: 100, titanium_alloy: 200, super_magnetic_ring: 100 };
  for (const k in g) state.stock[k] = (state.stock[k] || 0) + g[k];
  return state;
}

describe('行星间自动物流（系统6）', () => {
  it('多行星状态：travelTo 后建筑/库存分行星；切回后保留', () => {
    const state = fresh();
    const r = engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: 0, y: 0 });
    assert.ok(r.ok);
    const homeCount = Object.keys(state.buildings).length;
    state.stock.iron_ingot = (state.stock.iron_ingot || 0) + 999;

    const other = findOtherPlanet(state, true);
    assert.ok(other, '应有同星系其他行星');
    const t1 = engine.travelTo(state, content, other);
    assert.ok(t1.ok, JSON.stringify(t1));
    assert.equal(Object.keys(state.buildings).length, 0, '新行星应无建筑');
    // 首次抵达非母星会收到殖民补给，否则空库存无法造矿机
    assert.ok((state.stock.iron_ingot || 0) > 0, '新行星应有殖民补给');
    assert.notEqual(state.stock.iron_ingot, 999, '新行星库存应独立于母星');

    // 新行星用殖民补给即可直接放建筑
    const r2 = engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: 800, y: 800 });
    assert.ok(r2.ok);
    // 切回母星
    const t2 = engine.travelTo(state, content, homePlanetId(content));
    assert.ok(t2.ok);
    assert.equal(Object.keys(state.buildings).length, homeCount, '母星建筑应保留');
    assert.ok(state.stock.iron_ingot >= 999, '母星库存应保留');
    // 再切过去，新行星建筑保留
    engine.travelTo(state, content, other);
    assert.ok(state.buildings[r2.id], '新行星建筑应保留');
  });

  it('出口路由：同星系免翘曲器，货物经运输队列到达目标行星', () => {
    const state = fresh();
    const target = findOtherPlanet(state, true);
    const r = engine.placeBuilding(state, content, { typeId: 'planetary_station', x: 0, y: 0 });
    assert.ok(r.ok, JSON.stringify(r));
    state.stock.iron_ingot = (state.stock.iron_ingot || 0) + 50;

    const set = engine.setStationRoute(state, content, r.id, { itemId: 'iron_ingot', toPid: target, amount: 10 });
    assert.ok(set.ok, JSON.stringify(set));

    // 跨行星（同星系）不需要翘曲器
    engine.advance(state, content, 11); // ≥ ROUTE_INTERVAL 10s → 发 1 单
    assert.equal(state.shipments.length, 1, '应有 1 单在途');
    assert.equal(state.shipments[0].toPid, target);
    assert.ok(state.stock.iron_ingot === 390, "发货后库存应扣减: " + state.stock.iron_ingot);

    // 航程 30s 后陆续到货（route 仍会继续发货）
    engine.advance(state, content, 31);
    assert.ok((state.planets[target].stock.iron_ingot || 0) >= 10, '目标行星应入库: ' + (state.planets[target].stock.iron_ingot || 0));
  });

  it('跨星系航线：无空间翘曲器拒发，有则扣 1 件', () => {
    const state = fresh();
    const target = findOtherPlanet(state, false);
    assert.ok(target, '应有跨星系行星');
    const r = engine.placeBuilding(state, content, { typeId: 'interstellar_station', x: 0, y: 0 });
    assert.ok(r.ok, JSON.stringify(r));
    state.stock.iron_ingot = 50;

    const set = engine.setStationRoute(state, content, r.id, { itemId: 'iron_ingot', toPid: target, amount: 10 });
    assert.ok(set.ok, JSON.stringify(set));
    engine.advance(state, content, 11);
    assert.equal(state.shipments.length, 0, '无翘曲器不应发货');

    state.stock.space_warper = 5;
    engine.advance(state, content, 11);
    assert.equal(state.shipments.length, 1, '有翘曲器应发货');
    assert.ok(state.stock.space_warper <= 4, '应扣 1 件翘曲器: ' + state.stock.space_warper);
    assert.ok(state.shipments[0].eta > 40, '跨星系航程应更长');
  });

  it('校验：非物流站拒绝、当前行星拒绝、存档往返保留 planets/shipments', () => {
    const state = fresh();
    const wt = engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: 0, y: 0 });
    const target = findOtherPlanet(state, true);
    const bad = engine.setStationRoute(state, content, wt.id, { itemId: 'iron_ingot', toPid: target, amount: 10 });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'notStation');

    const st1 = engine.placeBuilding(state, content, { typeId: 'planetary_station', x: 200, y: 0 });
    const self = engine.setStationRoute(state, content, st1.id, { itemId: 'iron_ingot', toPid: state.planetId, amount: 10 });
    assert.equal(self.ok, false);
    assert.equal(self.reason, 'samePlanet');

    engine.setStationRoute(state, content, st1.id, { itemId: 'iron_ingot', toPid: target, amount: 5 });
    state.stock.iron_ingot = 100;
    engine.advance(state, content, 11);
    assert.ok(state.shipments.length >= 1);

    const saved = JSON.parse(JSON.stringify(engine.serialize(state)));
    const st2 = engine.deserialize(saved, content);
    assert.ok(st2, 'deserialize null');
    assert.ok(st2.planets[state.planetId], '当前行星包应存在');
    assert.ok(st2.planets[target], '后台行星包应存在');
    assert.ok(st2.shipments.length >= 1, '在途运输应保留');
    const routeSaved = st2.buildings[st1.id].route;
    assert.ok(routeSaved, '路由应保留');
    assert.equal(routeSaved.toPid, target);
    assert.equal(routeSaved.amount, 5);
  });

  it('殖民补给：首次抵达非母星获得建材，二次抵达不重复发放', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    state.galaxyUnlocked = Object.keys(content.STAR_SYSTEMS || {});
    const home = homePlanetId(content);
    const other = findOtherPlanet(state, true);
    assert.ok(other, '应有同星系其他行星');
    assert.ok(content.PLANETS[other].isHome === false, '目标不能是母星');

    const t1 = engine.travelTo(state, content, other);
    assert.ok(t1.ok);
    const firstIron = state.stock.iron_ingot || 0;
    assert.ok(firstIron > 0, '首次抵达应获得殖民补给');

    // 用补给应能直接造矿机与电厂（不依赖母星库存）
    const v = state.veins['vein-iron_ore'];
    assert.ok(v, '目标行星应有铁矿脉');
    const wt = engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: v.x - 120, y: v.y });
    assert.ok(wt.ok, `风机放置失败: ${JSON.stringify(wt)}`);
    const mm = engine.placeBuilding(state, content, { typeId: 'mining_machine', x: v.x, y: v.y });
    assert.ok(mm.ok, `采矿机放置失败: ${JSON.stringify(mm)}`);

    // 切回母星再切回，殖民补给不重复发放（只减了建造消耗）
    engine.travelTo(state, content, home);
    engine.travelTo(state, content, other);
    const secondIron = state.stock.iron_ingot || 0;
    assert.ok(secondIron > 0, '二次抵达后库存仍应有剩余');
    assert.ok(secondIron < firstIron, '二次抵达不应重复发放殖民补给');
  });
});
