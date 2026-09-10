// storage —— DSP_SAVE 内存模式往返 + 导出/导入（mock URL.createObjectURL）
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, loadStorage, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();
const SAVE = loadStorage();

function freshState() {
  const state = engine.createInitialState(content, homePlanetId(content));
  const vein = state.veins['vein-iron_ore'];
  engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: -100, y: -400 });
  engine.placeBuilding(state, content, { typeId: 'mining_machine', x: vein.x + 5, y: vein.y + 5 });
  engine.advance(state, content, 30);
  return state;
}

describe('DSP_SAVE 槽位往返', () => {
  it('Node 无 localStorage → 自动降级内存模式（degraded=true）', () => {
    // 第一次 API 调用触发探测：Node 环境无 localStorage，应降级内存
    SAVE.list();
    assert.equal(SAVE.degraded, true);
    assert.deepEqual(SAVE.SLOT_IDS, ['slot-autosave']);
  });

  it('save → list → load → 确定性推进一致', () => {
    const state = freshState();
    state.factoryName = '测试工厂';
    const r = SAVE.save('slot-autosave', state);
    assert.equal(r.ok, true);

    const list = SAVE.list();
    const s1 = list.find((s) => s.id === 'slot-autosave');
    assert.ok(s1 && !s1.empty);
    assert.equal(s1.name, '测试工厂');
    assert.ok(s1.savedAt > 0);
    assert.ok(Math.abs(s1.playSeconds - 30) < 1);
    assert.equal(s1.planetId, state.planetId);

    const loaded = SAVE.load('slot-autosave');
    assert.ok(loaded, 'load 应返回 state');
    assert.equal(loaded.planetId, state.planetId);
    assert.equal(loaded.factoryName, '测试工厂');
    assert.equal(Object.keys(loaded.buildings).length, Object.keys(state.buildings).length);

    // 载入后的 state 继续模拟应与原 state 保持确定性一致
    engine.advance(loaded, content, 30);
    engine.advance(state, content, 30);
    assert.deepEqual(loaded.scienceStock, state.scienceStock);
    assert.deepEqual(loaded.stock, state.stock);
    assert.deepEqual(loaded.stats.totalProduced, state.stats.totalProduced);
  });

  it('delete 后 load 返回 null、list 标记 empty', () => {
    const state = freshState();
    SAVE.save('slot-autosave', state);
    assert.ok(SAVE.load('slot-autosave'));
    assert.equal(SAVE.delete('slot-autosave').ok, true);
    assert.equal(SAVE.load('slot-autosave'), null);
    const s2 = SAVE.list().find((s) => s.id === 'slot-autosave');
    assert.equal(s2.empty, true);
    assert.equal(s2.name, null);
  });

  it('损坏的槽位数据：load 返回 null 而不抛出', () => {
    // 注入一个“可探测但数据损坏”的 localStorage mock（探测支持重试）
    const savedLs = globalThis.localStorage;
    globalThis.localStorage = {
      setItem() {}, removeItem() {},
      getItem: (k) => (k === 'dspFactory.slot-autosave' ? '{broken json!!' : null),
    };
    try {
      assert.equal(SAVE.load('slot-autosave'), null, '损坏数据应返回 null');
      const s1 = SAVE.list().find((s) => s.id === 'slot-autosave');
      assert.equal(s1.empty, true, 'list 应优雅跳过坏槽位');
    } finally {
      if (savedLs === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = savedLs;
    }
  });

  it('仅自动存档槽：重复保存 autosave 时，后者覆盖且不再产生备份槽', () => {
    const v1 = freshState();
    v1.factoryName = '第一版';
    const v2 = freshState();
    v2.factoryName = '第二版';
    SAVE.save('slot-autosave', v1);
    SAVE.save('slot-autosave', v2);
    assert.equal(SAVE.load('slot-autosave').factoryName, '第二版');
    assert.equal(SAVE.list().length, 1, 'list 只应返回唯一自动存档槽');
    assert.equal(SAVE.load('slot-backup'), null, '不应存在备份槽');
    assert.equal(SAVE.load('slot-1'), null, '不应存在手动槽位');
  });
});

describe('DSP_SAVE 导出 / 导入', () => {
  // ---- 浏览器 API mock（Node 无 Blob/download 语义）----
  let clicked = false;
  let anchor = null;
  let objectUrl = null;
  const revoked = [];
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;
  const realBlob = globalThis.Blob;
  const realDocument = globalThis.document;

  class MockBlob {
    constructor(parts, opts) {
      this.parts = parts;
      this.type = (opts && opts.type) || '';
    }
    text() { return Promise.resolve(this.parts.join('')); }
  }

  after(() => {
    if (realCreateObjectURL) URL.createObjectURL = realCreateObjectURL; else delete URL.createObjectURL;
    if (realRevokeObjectURL) URL.revokeObjectURL = realRevokeObjectURL; else delete URL.revokeObjectURL;
    if (realBlob) globalThis.Blob = realBlob; else delete globalThis.Blob;
    if (realDocument) globalThis.document = realDocument; else delete globalThis.document;
  });

  it('exportJson 触发 Blob 下载（dsp-factory-save.json），importJson 可还原 state', async () => {
    URL.createObjectURL = (blob) => { objectUrl = blob; return 'blob:mock-url'; };
    URL.revokeObjectURL = (u) => revoked.push(u);
    globalThis.Blob = MockBlob;
    globalThis.document = {
      createElement: (tag) => {
        anchor = { tag, href: '', download: '', style: {}, click: () => { clicked = true; } };
        return anchor;
      },
      body: { appendChild() {}, removeChild() {} },
    };

    const state = freshState();
    state.factoryName = '导出的工厂';
    const r = SAVE.exportJson(state);
    assert.equal(r.ok, true);
    assert.equal(clicked, true, '下载锚点应被点击');
    assert.equal(anchor.download, 'dsp-factory-save.json');
    assert.equal(anchor.href, 'blob:mock-url');
    assert.ok(objectUrl instanceof MockBlob);

    const exportedText = await objectUrl.text();
    const payload = JSON.parse(exportedText);
    assert.equal(payload.app, 'dsp-factory');
    assert.equal(payload.name, '导出的工厂');
    assert.equal(payload.state.version, 2);

    // File.text() 形式导入
    const imported = await SAVE.importJson({ text: () => Promise.resolve(exportedText) });
    assert.equal(imported.planetId, state.planetId);
    assert.equal(imported.factoryName, '导出的工厂');
    assert.equal(Object.keys(imported.buildings).length, Object.keys(state.buildings).length);

    // 导出后延迟 revoke blob URL（约 1s）
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.deepEqual(revoked, ['blob:mock-url']);
  });

  it('importJson 兼容裸 serialize state 与损坏文件（reject）', async () => {
    const state = freshState();
    const bare = JSON.stringify(engine.serialize(state));
    const fromBare = await SAVE.importJson({ text: () => Promise.resolve(bare) });
    assert.equal(fromBare.planetId, state.planetId);

    await assert.rejects(
      () => SAVE.importJson({ text: () => Promise.resolve('{oops') }),
      (err) => err instanceof Error
    );
    await assert.rejects(() => SAVE.importJson(null));
  });
});
