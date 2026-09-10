/* =========================================================================
 * build-single.mjs — 单文件构建脚本（D 外壳）
 * 用法：node scripts/build-single.mjs（可重复执行）
 * -------------------------------------------------------------------------
 * 读取 index.html：
 *   1. <link rel="stylesheet" href="./styles/main.css"> 替换为
 *      <style>…main.css 内容…</style>
 *   2. 9 个 <script src="…"></script> 按出现顺序替换为
 *      <script>/*文件路径注释*／…文件内容…</script>
 * 输出 dist/dsp-factory.html（整目录静态托管 / 单文件发布均可），
 * 打印产物字节数，并断言产物不再含任何 src=/href= 外链（data:/# 除外）。
 * ========================================================================= */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(DIST_DIR, 'dsp-factory.html');

const CSS_HREF = './styles/main.css';

// 与 index.html 的加载顺序保持一致（SPEC §1 契约）
const SCRIPTS = [
  'src/data/content.js',
  'src/engine/engine.js',
  'src/i18n/strings.js',
  'src/render/camera.js',
  'src/render/renderer.js',
  'src/input/pointer.js',
  'src/ui/ui.js',
  'src/save/storage.js',
  'src/main.js',
];

let html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ---------- 1. 内联样式表 ---------- */
const linkTag = `<link rel="stylesheet" href="${CSS_HREF}">`;
if (!html.includes(linkTag)) {
  fail(`index.html 中找不到样式表链接 ${linkTag}`);
}
const css = readFileSync(path.join(ROOT, 'styles/main.css'), 'utf8');
// 使用函数形式的 replace，避免 CSS 内容中的 $ 序列被特殊解释
html = html.replace(linkTag, () => `<style>\n/* ===== styles/main.css ===== */\n${css}\n</style>`);

/* ---------- 2. 按序内联脚本 ---------- */
for (const rel of SCRIPTS) {
  const tag = `<script src="./${rel}"></script>`;
  if (!html.includes(tag)) {
    fail(`index.html 中找不到脚本标签 ${tag}（顺序必须与 SPEC §1 一致）`);
  }
  let code = readFileSync(path.join(ROOT, rel), 'utf8');
  // 防止文件内容里出现 </script> 提前闭合内联标签
  code = code.replace(/<\/script>/gi, '<\\/script>');
  html = html.replace(tag, () => `<script>\n/* ===== ${rel} ===== */\n${code}\n</script>`);
}

/* ---------- 3. 断言：无外链 / 无 module ---------- */
// 语法检查产物结构：剥离内联 <script>/<style> 内容后，剩余骨架里
// 不应再有任何 src= / href= 属性（原样式与脚本引用已全部内联）。
const markupOnly = html
  .replace(/<script>[\s\S]*?<\/script>/g, '')
  .replace(/<style>[\s\S]*?<\/style>/g, '');
const external = markupOnly.match(/\b(?:src|href)\s*=\s*["']?[^"'\s>]+/gi);
if (external) {
  fail('产物仍包含外链引用: ' + external.join(' , '));
}
if (/\btype\s*=\s*["']?module/i.test(html)) {
  fail('产物不应包含 type="module"');
}

/* ---------- 4. 输出 ---------- */
mkdirSync(DIST_DIR, { recursive: true });
writeFileSync(OUT_FILE, html, 'utf8');

const bytes = Buffer.byteLength(html, 'utf8');
console.log(`[build-single] OK -> dist/dsp-factory.html (${bytes} bytes, ${(bytes / 1024).toFixed(1)} KB)`);

function fail(msg) {
  console.error(`[build-single] FAIL: ${msg}`);
  process.exit(1);
}
