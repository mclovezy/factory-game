/* =========================================================================
 * DSP_SAVE — 存档系统  src/save/storage.js
 * 团队契约 SPEC §5 + SPEC-v2 §5（D 外壳）—— 经典脚本挂载 globalThis.DSP_SAVE
 * -------------------------------------------------------------------------
 * 设计要点：
 *  - localStorage key 前缀 'dspFactory.'；仅保留单个自动存档槽位：
 *      slot-autosave
 *  - 所有 localStorage 访问全部包 try/catch：B 站 Toy 平台 iframe / 隐私模式
 *    可能完全禁用存储。首次访问探测，任何失败立即降级为内存 Map 存档，
 *    并置 api.degraded = true（UI 可据此提示“刷新后存档将丢失”）。
 *  - Node 环境（无 window/localStorage，如 npm test）自动走内存模式。
 *  - 自动存档统一写入 slot-autosave，由 main.js 的 60s 定时 / beforeunload /
 *    切后台触发。
 *  - 槽位记录格式（JSON 字符串）：
 *      { id, name, savedAt, playSeconds, planetId, state:<DSP_ENGINE.serialize 结果> }
 *    工厂名 state.factoryName 由 main.js 维护（engine.serialize 不含该字段，
 *    故由本模块在记录层持久化，load 时回填到 state 上）。
 *  - ★ v2 版本闸门：state 契约 version===2（SPEC-v2 §1）。记录层只认
 *    rec.state.version === 2 的槽位；其余（version 1 旧档 / 无版本脏数据）
 *    一律按“空槽”呈现（empty:true + staleVersion:true），主菜单里显示为
 *    可覆盖，直接存入即覆盖旧记录。load() 对旧档返回 null（引擎
 *    deserialize 遇 version!==2 也返回 null，两层闸门保持一致）。
 *  - inspect(slotId)：读取原始记录的版本信息（不反序列化），供外壳在
 *    load 返回 null 时区分「存档版本过旧」与「数据损坏」两种提示。
 *  - load(): 反序列化失败 / JSON 损坏 / 版本过旧时返回 null 并
 *    console.error（绝不抛出）。
 *  - list(): 返回自动存档槽位（空槽形如
 *      { id, name:null, savedAt:0, playSeconds:0, planetId:null, empty:true }），
 *    非空槽附加 empty:false 与 planetId，供主菜单渲染。
 * ========================================================================= */
(function (global) {
  'use strict';

  var PREFIX = 'dspFactory.';
  var SLOT_IDS = ['slot-autosave'];
  var EXPORT_FILENAME = 'dsp-factory-save.json';
  var DEFAULT_NAME = '未命名工厂';
  /** state 契约版本（SPEC-v2 §1）：记录层只接受该版本的槽位 */
  var STATE_VERSION = 2;

  var memory = new Map();   // 降级 / Node 环境的内存存档
  var ls = null;            // 探测成功的 localStorage（null = 暂不可用）
  var hardDown = false;     // 会话中途写入失败（配额/权限）→ 不再回试 localStorage

  /* --------------------- localStorage 安全访问 --------------------- */

  // 沙箱 iframe 里连 typeof 都可能触发 SecurityError，所以整体包 try/catch。
  // 初始探测失败（Node / 隐私模式 / 被禁）不缓存失败结果：每次访问都廉价重试，
  // 这样环境恢复（或测试注入 mock）后能自动回到 localStorage；只有
  // “曾经可用、后来失败”的会话中途降级才永久转内存（hardDown）。
  function probeLs() {
    if (hardDown) return null;
    try {
      if (typeof localStorage === 'undefined') {
        ls = null;
        api.degraded = true;
        return null;
      }
      if (ls && ls === localStorage) return ls;
      var k = PREFIX + '__probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      ls = localStorage;
      api.degraded = false;
    } catch (e) {
      ls = null;
      api.degraded = true;
    }
    return ls;
  }

  function degrade() {
    hardDown = true;
    ls = null;
    api.degraded = true;
  }

  function rawSet(key, value) {
    var store = probeLs();
    if (store) {
      try {
        store.setItem(key, value);
        return true;
      } catch (e) {
        // 写入失败（配额满 / 会话中途被禁）：降级内存，尽力不丢数据
        degrade();
      }
    }
    memory.set(key, value);
    return true;
  }

  function rawGet(key) {
    var store = probeLs();
    if (store) {
      try {
        return store.getItem(key);
      } catch (e) {
        degrade();
      }
    }
    return memory.has(key) ? memory.get(key) : null;
  }

  function rawRemove(key) {
    var store = probeLs();
    if (store) {
      try {
        store.removeItem(key);
      } catch (e) {
        degrade();
      }
    }
    memory.delete(key);
  }

  /* --------------------- 槽位记录 --------------------- */

  function slotKey(slotId) { return PREFIX + slotId; }

  /** 读取原始记录里 state 的版本号（不反序列化）；无版本信息返回 null */
  function recordStateVersion(rec) {
    var st = rec && rec.state;
    if (st && typeof st === 'object' && st.version != null) return st.version;
    return null;
  }

  /** 该记录是否为当前契约版本（v2）的可读存档 */
  function recordPlayable(rec) {
    return recordStateVersion(rec) === STATE_VERSION;
  }

  function readRecord(slotId) {
    var raw = rawGet(slotKey(slotId));
    if (raw == null) return null;
    try {
      var rec = JSON.parse(raw);
      if (!rec || typeof rec !== 'object') return null;
      return rec;
    } catch (e) {
      console.error('[DSP_SAVE] 槽位 ' + slotId + ' 数据损坏，已忽略', e);
      return null;
    }
  }

  function serializeState(state) {
    if (global.DSP_ENGINE && typeof global.DSP_ENGINE.serialize === 'function') {
      return global.DSP_ENGINE.serialize(state);
    }
    return state; // 引擎缺失时的兜底（正常流程不会走到）
  }

  function deserializeState(payload) {
    if (global.DSP_ENGINE && typeof global.DSP_ENGINE.deserialize === 'function') {
      return global.DSP_ENGINE.deserialize(payload, global.DSP_CONTENT);
    }
    return payload;
  }

  /* --------------------- 对外 API --------------------- */

  var api = {
    /** true = localStorage 不可用，已降级内存存档（刷新即丢，UI 可据此提示） */
    degraded: false,
    /** 槽位 id 常量（供 UI 展示槽位名，只读副本） */
    SLOT_IDS: SLOT_IDS.slice(),

    /**
     * 全部槽位列表（当前仅自动存档槽 slot-autosave）。
     * 可读档（version===2）：{ id, name, savedAt, playSeconds, planetId, empty:false, staleVersion:false }
     * 空槽：{ id, name:null, savedAt:0, playSeconds:0, planetId:null, empty:true, staleVersion:false }
     * 旧版本/脏记录：与空槽同形（主菜单显示为可覆盖），但附加 staleVersion:true
     */
    list: function () {
      var out = [];
      for (var i = 0; i < SLOT_IDS.length; i++) {
        var rec = readRecord(SLOT_IDS[i]);
        if (rec && recordPlayable(rec)) {
          out.push({
            id: SLOT_IDS[i],
            name: (typeof rec.name === 'string' && rec.name) ? rec.name : DEFAULT_NAME,
            savedAt: rec.savedAt || 0,
            playSeconds: rec.playSeconds || 0,
            planetId: rec.planetId || null,
            empty: false,
            staleVersion: false
          });
        } else {
          out.push({
            id: SLOT_IDS[i],
            name: null,
            savedAt: 0,
            playSeconds: 0,
            planetId: null,
            empty: true,
            staleVersion: !!(rec && rec.state != null) // 有记录但版本不符 = 旧档被忽略
          });
        }
      }
      return out;
    },

    /**
     * 槽位诊断（不反序列化）：供外壳在 load() 返回 null 时区分提示文案。
     * 返回 { exists, version, staleVersion, corrupt }：
     *   exists=false                 槽位无记录
     *   staleVersion=true            有记录但 state.version !== 2（旧档，已忽略、可覆盖）
     *   corrupt=true                 有记录但读不到版本号（脏数据）
     */
    inspect: function (slotId) {
      var rec = readRecord(slotId);
      if (!rec) return { exists: false, version: null, staleVersion: false, corrupt: false };
      var v = recordStateVersion(rec);
      return {
        exists: true,
        version: v,
        staleVersion: v != null && v !== STATE_VERSION,
        corrupt: v == null
      };
    },

    /** 保存到槽位（内部先 DSP_ENGINE.serialize 存 JSON 字符串） */
    save: function (slotId, state) {
      try {
        var rec = {
          id: slotId,
          name: (state && typeof state.factoryName === 'string' && state.factoryName)
            ? state.factoryName
            : (function () {
                var prev = readRecord(slotId);
                return (prev && prev.name) ? prev.name : DEFAULT_NAME;
              })(),
          savedAt: Date.now(),
          playSeconds: (state && state.stats && state.stats.playSeconds) || 0,
          planetId: (state && state.planetId) || null,
          state: serializeState(state)
        };
        rawSet(slotKey(slotId), JSON.stringify(rec));
        return { ok: true };
      } catch (e) {
        console.error('[DSP_SAVE] 保存到 ' + slotId + ' 失败', e);
        return { ok: false, reason: 'saveFailed' };
      }
    },

    /** 读取槽位并反序列化为可运行 state；无档 / 损坏 / 版本过旧返回 null */
    load: function (slotId) {
      var rec = readRecord(slotId);
      if (!rec) return null;
      // v2 闸门：非当前契约版本的记录直接忽略（与引擎 deserialize 的
      // version!==2 → null 双保险；记录层先挡，避免旧档进入引擎）
      if (!recordPlayable(rec)) {
        console.warn('[DSP_SAVE] 槽位 ' + slotId + ' 存档版本过旧（version=' +
          recordStateVersion(rec) + '，需要 ' + STATE_VERSION + '），已忽略');
        return null;
      }
      var st;
      try {
        st = deserializeState(rec.state);
      } catch (e) {
        console.error('[DSP_SAVE] 槽位 ' + slotId + ' 反序列化失败', e);
        return null;
      }
      if (!st) return null;
      // 记录层元数据回填（factoryName 由 main.js 维护；__savedAt 供离线结算用）
      try {
        st.factoryName = rec.name || DEFAULT_NAME;
        Object.defineProperty(st, '__savedAt', {
          value: rec.savedAt || 0, enumerable: false, writable: true, configurable: true
        });
      } catch (e) { /* 极端环境 defineProperty 失败时忽略 */ }
      return st;
    },

    /** 删除槽位（槽位本就不存在也返回 ok） */
    delete: function (slotId) {
      try {
        rawRemove(slotKey(slotId));
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: 'deleteFailed' };
      }
    },

    /** 导出当前存档为下载文件 dsp-factory-save.json（Blob + a[download]） */
    exportJson: function (state) {
      try {
        var payload = {
          app: 'dsp-factory',
          version: STATE_VERSION, // 导出包裹格式版本，随 state 契约升级
          exportedAt: Date.now(),
          name: (state && state.factoryName) || DEFAULT_NAME,
          state: serializeState(state)
        };
        var json = JSON.stringify(payload, null, 2);
        var blob = new Blob([json], { type: 'application/json' }); // Node 测试环境会 mock
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = EXPORT_FILENAME;
        if (a.style) a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        if (a.parentNode && a.parentNode.removeChild) a.parentNode.removeChild(a);
        else if (typeof a.remove === 'function') a.remove();
        setTimeout(function () {
          try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        }, 1000);
        return { ok: true };
      } catch (e) {
        console.error('[DSP_SAVE] 导出存档失败', e);
        return { ok: false, reason: 'exportFailed' };
      }
    },

    /** 导入存档文件（File/Blob）→ Promise<state>；兼容导出包裹格式与裸 state */
    importJson: function (file) {
      return new Promise(function (resolve, reject) {
        function fail(e) {
          console.error('[DSP_SAVE] 导入存档失败', e);
          reject(e instanceof Error ? e : new Error('importFailed'));
        }
        function apply(text) {
          try {
            var data = JSON.parse(text);
            var payload = data;
            if (data && typeof data === 'object' && data.state &&
                (data.state.version != null || data.state.planetId != null)) {
              payload = data.state; // 导出包裹格式
            }
            var st = deserializeState(payload);
            if (!st) throw new Error('deserialize returned empty state');
            if (data && typeof data.name === 'string' && data.name) st.factoryName = data.name;
            var savedAt = (data && data.exportedAt) || 0;
            try {
              Object.defineProperty(st, '__savedAt', {
                value: savedAt, enumerable: false, writable: true, configurable: true
              });
            } catch (e) { /* ignore */ }
            resolve(st);
          } catch (e) { fail(e); }
        }
        try {
          if (file && typeof file.text === 'function') {
            var p = file.text();
            if (p && typeof p.then === 'function') { p.then(apply, fail); return; }
          }
          var fr = new FileReader();
          fr.onload = function () { apply(String(fr.result)); };
          fr.onerror = function () { fail(fr.error || new Error('read failed')); };
          fr.readAsText(file);
        } catch (e) { fail(e); }
      });
    }
  };

  global.DSP_SAVE = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
