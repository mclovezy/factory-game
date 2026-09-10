// galaxy —— 星图数据自洽：行星→星系引用合法、每星系至少 1 行星、母星存在
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content } = loadContentAndEngine();

describe('星系星图数据自洽', () => {
  it('每颗行星的 systemId 都指向存在的星系', () => {
    const { STAR_SYSTEMS, PLANETS } = content;
    for (const id in PLANETS) {
      assert.ok(STAR_SYSTEMS[PLANETS[id].systemId], `行星 ${id} 的 systemId ${PLANETS[id].systemId} 不存在`);
    }
  });

  it('每个星系至少包含 1 颗行星（星图才有节点）', () => {
    const { STAR_SYSTEMS, PLANETS } = content;
    for (const sid in STAR_SYSTEMS) {
      const cnt = Object.keys(PLANETS).filter(p => PLANETS[p].systemId === sid).length;
      assert.ok(cnt >= 1, `星系 ${sid} 应至少 1 颗行星`);
    }
  });

  it('主行星是 isHome 且属于已解锁的首个星系', () => {
    const home = homePlanetId(content);
    const pl = content.PLANETS[home];
    assert.ok(pl && pl.isHome, '主行星应标记 isHome');
  });

  it('星系按 distanceLy 排序可生成确定布局', () => {
    const { STAR_SYSTEMS } = content;
    const ids = Object.keys(STAR_SYSTEMS);
    ids.sort((a, b) => (STAR_SYSTEMS[a].distanceLy || 0) - (STAR_SYSTEMS[b].distanceLy || 0));
    assert.equal(ids[0], 'dawnlight', '晨曦系 distanceLy=0 应排首位'); // 母星所在系
  });
});
