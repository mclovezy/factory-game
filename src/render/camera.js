/* ============================================================
 * DSP_CAMERA — 2D 无限画布相机（平移 / 缩放 / 世界-屏幕坐标换算）
 * 契约：SPEC.md §4。经典脚本，挂载 globalThis.DSP_CAMERA。
 * 坐标约定：
 *   camera.x / camera.y = 屏幕中心对应的世界坐标；
 *   camera.zoom = 缩放系数（1 = 1 世界单位 = 1 CSS 像素）；
 *   所有屏幕坐标均为 CSS 像素（DPR 缩放由 renderer 的 setTransform 处理）。
 * ============================================================ */
(function (global) {
  'use strict';

  var MIN_ZOOM = 0.12;
  var MAX_ZOOM = 4;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /** 画布 CSS 尺寸（canvas 若尚未布局则退化为窗口尺寸） */
  function viewportSize(canvas) {
    var w = (canvas && canvas.clientWidth) || (global.innerWidth || 800);
    var h = (canvas && canvas.clientHeight) || (global.innerHeight || 600);
    return { w: w, h: h };
  }

  function createCamera(canvas) {
    var cam = {
      x: 0,
      y: 0,
      zoom: 0.6,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,

      /** 屏幕坐标(CSS px) → 世界坐标 */
      screenToWorld: function (sx, sy) {
        var size = viewportSize(canvas);
        return {
          x: cam.x + (sx - size.w / 2) / cam.zoom,
          y: cam.y + (sy - size.h / 2) / cam.zoom
        };
      },

      /** 世界坐标 → 屏幕坐标(CSS px) */
      worldToScreen: function (wx, wy) {
        var size = viewportSize(canvas);
        return {
          x: (wx - cam.x) * cam.zoom + size.w / 2,
          y: (wy - cam.y) * cam.zoom + size.h / 2
        };
      },

      /** 以屏幕点 (sx,sy) 为锚点缩放 factor 倍（捏合/滚轮共用） */
      zoomAt: function (sx, sy, factor) {
        var size = viewportSize(canvas);
        var before = cam.screenToWorld(sx, sy);
        var nz = clamp(cam.zoom * (factor || 1), cam.minZoom, cam.maxZoom);
        if (nz === cam.zoom) return cam.zoom;
        cam.zoom = nz;
        // 保持锚点下的世界坐标不动
        cam.x = before.x - (sx - size.w / 2) / cam.zoom;
        cam.y = before.y - (sy - size.h / 2) / cam.zoom;
        return cam.zoom;
      },

      /** 屏幕像素平移（跟随缩放换算成世界位移） */
      panBy: function (dx, dy) {
        cam.x -= dx / cam.zoom;
        cam.y -= dy / cam.zoom;
      },

      /**
       * 调整相机使其完整显示世界矩形 {x, y, w, h}（世界单位），
       * 留出 12% 边距。矿脉重建/新开局时可调用。
       */
      fitWorld: function (rect) {
        if (!rect) return;
        var size = viewportSize(canvas);
        var w = Math.max(1, rect.w || 1);
        var h = Math.max(1, rect.h || 1);
        var margin = 1.24; // 12% 边距
        var zx = (size.w * 0.9) / (w * margin);
        var zy = (size.h * 0.9) / (h * margin);
        cam.zoom = clamp(Math.min(zx, zy), cam.minZoom, cam.maxZoom);
        cam.x = rect.x + w / 2;
        cam.y = rect.y + h / 2;
      },

      /** 直接设置缩放（保持屏幕中心不动） */
      setZoom: function (z) {
        var size = viewportSize(canvas);
        cam.zoomAt(size.w / 2, size.h / 2, z / cam.zoom);
      },

      /** 当前视口的世界矩形（含边距，供渲染裁剪） */
      viewRect: function (pad) {
        var size = viewportSize(canvas);
        var halfW = size.w / 2 / cam.zoom;
        var halfH = size.h / 2 / cam.zoom;
        var p = pad || 0;
        return {
          left: cam.x - halfW - p,
          top: cam.y - halfH - p,
          right: cam.x + halfW + p,
          bottom: cam.y + halfH + p,
          w: halfW * 2 + p * 2,
          h: halfH * 2 + p * 2
        };
      }
    };
    return cam;
  }

  global.DSP_CAMERA = {
    createCamera: createCamera
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.DSP_CAMERA;
  }
})(globalThis);
