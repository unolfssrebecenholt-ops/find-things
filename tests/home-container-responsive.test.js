const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readMiniProgramFile(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', 'miniprogram', ...segments), 'utf8');
}

function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : '';
}

function assertRule(css, selector, pattern, message) {
  assert.match(cssBlock(css, selector), pattern, message || `${selector} should include ${pattern}`);
}

test('home index-ready card keeps sloth prototype columns and non-overflowing CTA buttons', () => {
  const wxss = readMiniProgramFile('pages', 'home', 'index.wxss');

  assertRule(wxss, '.hero-panel', /max-width:\s*100%/);
  assertRule(wxss, '.hero-row', /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+152rpx/);
  assertRule(wxss, '.hero-copy', /min-width:\s*0/);
  assertRule(wxss, '.action-grid', /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assertRule(wxss, '.action-grid .primary-button,\n.action-grid .soft-button', /min-width:\s*0/);
  assertRule(wxss, '.action-grid .primary-button,\n.action-grid .soft-button', /max-width:\s*100%/);
  assertRule(wxss, '.action-grid .primary-button,\n.action-grid .soft-button', /padding:\s*0\s+16rpx/);
});

test('container list header, summary, manage rows, and batch bar are constrained for small screens', () => {
  const wxml = readMiniProgramFile('pages', 'container', 'list.wxml');
  const wxss = readMiniProgramFile('pages', 'container', 'list.wxss');

  assert.match(wxml, /list-toolbar/);
  assert.match(wxml, /page-actions/);
  assert.match(wxml, /manage-toggle \{\{manageButtonClass\}\}/);
  assert.match(wxml, /全部容器/);
  assert.match(wxml, /个容器已保存/);
  assert.match(wxml, /件物品可搜索/);
  assert.doesNotMatch(wxml, /summary\.imageCount/);
  assert.match(wxml, /section-row/);
  assert.match(wxml, /最近更新/);
  assert.match(wxml, /按时间/);
  assert.match(wxml, /container-list/);
  assert.match(wxml, /row-delete/);
  assert.doesNotMatch(wxml, /container-progress|progress-line|progress-copy/);
  assert.match(wxml, /batch-title/);
  assert.match(wxml, /删掉后，小懒也会忘记里面的物品/);

  assertRule(wxss, '.container-list-page', /background:[\s\S]*#f3f2ed/);
  assertRule(wxss, '.list-head', /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assertRule(wxss, '.page-actions', /flex:\s*none/);
  assertRule(wxss, '.page-actions', /min-width:\s*0/);
  assertRule(wxss, '.manage-toggle', /display:\s*inline-flex/);
  assertRule(wxss, '.manage-toggle', /flex:\s*none/);
  assertRule(wxss, '.manage-toggle.active', /background:\s*#1f6048/);
  assertRule(wxss, '.manage-toggle.active', /color:\s*#fff/);
  assertRule(wxss, '.add-container', /width:\s*84rpx/);
  assertRule(wxss, '.add-container', /height:\s*84rpx/);
  assertRule(wxss, '.add-container', /background:\s*rgba\(255,\s*255,\s*255,\s*0\.74\)/);
  assert.doesNotMatch(cssBlock(wxss, '.add-container'), /box-shadow/);
  assertRule(wxss, '.list-toolbar', /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+92rpx/);
  assertRule(wxss, '.compact-search', /height:\s*92rpx/);
  assertRule(wxss, '.compact-search', /border-radius:\s*999rpx/);
  assertRule(wxss, '.compact-search', /background:\s*rgba\(255,\s*255,\s*255,\s*0\.74\)/);
  assert.doesNotMatch(cssBlock(wxss, '.compact-search'), /box-shadow/);
  assertRule(wxss, '.library-summary', /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assertRule(wxss, '.library-summary', /margin-bottom:\s*28rpx/);
  assertRule(wxss, '.summary-tile', /min-width:\s*0/);
  assertRule(wxss, '.summary-tile', /border-radius:\s*44rpx/);
  assertRule(wxss, '.summary-value', /overflow:\s*hidden/);
  assertRule(wxss, '.summary-value', /text-overflow:\s*ellipsis/);
  assertRule(wxss, '.summary-tile .subtle', /margin-top:\s*16rpx/);
  assertRule(wxss, '.container-row', /background:\s*rgba\(255,\s*255,\s*255,\s*0\.78\)/);
  assertRule(wxss, '.container-row', /border-radius:\s*44rpx/);
  assert.doesNotMatch(cssBlock(wxss, '.container-row'), /box-shadow/);
  assertRule(wxss, '.container-list-page', /padding-bottom:\s*360rpx/);
  assertRule(wxss, '.container-list-page .manage-row', /grid-template-columns:\s*44rpx\s+156rpx\s+minmax\(0,\s*1fr\)\s+112rpx/);
  assertRule(wxss, '.container-list-page .manage-row', /gap:\s*24rpx/);
  assertRule(wxss, '.select-dot', /width:\s*44rpx/);
  assertRule(wxss, '.select-dot', /height:\s*44rpx/);
  assertRule(wxss, '.select-dot.selected', /background:\s*#1f6048/);
  assertRule(wxss, '.select-dot.selected::after', /border-bottom:\s*4rpx\s+solid\s+#fff/);
  assertRule(wxss, '.row-delete', /background:\s*#f7e5df/);
  assertRule(wxss, '.row-delete', /width:\s*112rpx/);
  assertRule(wxss, '.row-delete', /max-width:\s*112rpx/);
  assertRule(wxss, '.row-delete', /padding:\s*0/);
  assert.match(wxml, /class="batch-copy"/);
  assertRule(wxss, '.batch-bar', /right:\s*max\(44rpx,\s*env\(safe-area-inset-right\)\)/);
  assertRule(wxss, '.batch-bar', /bottom:\s*150rpx/);
  assertRule(wxss, '.batch-bar', /left:\s*max\(44rpx,\s*env\(safe-area-inset-left\)\)/);
  assertRule(wxss, '.batch-bar', /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assertRule(wxss, '.batch-bar', /background:\s*rgba\(255,\s*255,\s*255,\s*0\.94\)/);
  assertRule(wxss, '.batch-bar', /border-radius:\s*44rpx/);
  assertRule(wxss, '.batch-bar', /backdrop-filter:\s*blur\(16rpx\)/);
  assertRule(wxss, '.batch-copy', /overflow:\s*hidden/);
  assertRule(wxss, '.batch-copy', /text-overflow:\s*ellipsis/);
  assertRule(wxss, '.batch-delete', /background:\s*#9f3d32/);
  assertRule(wxss, '.batch-delete', /color:\s*#fff/);
});
