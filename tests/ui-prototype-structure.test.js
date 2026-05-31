const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readMiniProgramFile(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', 'miniprogram', ...segments), 'utf8');
}

function listWxmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listWxmlFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.wxml') ? [fullPath] : [];
  });
}

function cssBlock(css, selector) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : '';
}

function assertCssHasAtLeast(css, selector, property, minRpx) {
  const block = cssBlock(css, selector);
  const match = block.match(new RegExp(`${property}\\s*:\\s*(\\d+)rpx`));
  assert.ok(match, `${selector} should define ${property} in rpx`);
  assert.ok(Number(match[1]) >= minRpx, `${selector} ${property} should be at least ${minRpx}rpx`);
}

test('project is named find-things while V1 remains only a version label', () => {
  const projectConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'project.config.json'), 'utf8'));

  assert.equal(projectConfig.projectname, 'find-things');
  assert.notEqual(projectConfig.projectname.toLowerCase(), 'v1');
});

test('dev-only folders are excluded from WeChat DevTools packaging cache', () => {
  const projectConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'project.config.json'), 'utf8'));
  const ignoredFolders = new Set(
    (projectConfig.packOptions && projectConfig.packOptions.ignore || [])
      .filter((entry) => entry.type === 'folder')
      .map((entry) => entry.value)
  );

  for (const folder of ['.worktrees/', 'tests/', 'docs/', 'output/']) {
    assert.ok(ignoredFolders.has(folder), `${folder} should be ignored by DevTools`);
  }
});

test('wxml avoids brittle else chains and complex fallback expressions', () => {
  const files = listWxmlFiles(path.join(__dirname, '..', 'miniprogram'));

  for (const file of files) {
    const relativePath = path.relative(path.join(__dirname, '..'), file);
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /\bwx:else\b|\bwx:elif\b/, `${relativePath} should use explicit wx:if flags`);
    assert.doesNotMatch(content, /\{\{[^}]*\|\|[^}]*\}\}/, `${relativePath} should precompute fallback values in JS`);
    assert.doesNotMatch(content, /\{\{\s*!/, `${relativePath} should precompute inverse flags in JS`);
  }
});

test('home page keeps the task-first structure with Xiaolan empty state', () => {
  const wxml = readMiniProgramFile('pages', 'home', 'index.wxml');

  assert.match(wxml, /今天整理一点点/);
  assert.match(wxml, /一搜就知道/);
  assert.match(wxml, /hero-panel/);
  assert.match(wxml, /container-stack/);
  assert.match(wxml, /container-row/);
  assert.match(wxml, /bottom-nav/);
  assert.match(wxml, /最近整理/);
  assert.match(wxml, /小懒还没有东西可找/);
  assert.match(wxml, /xiaolan-sloth\.svg/);
  assert.doesNotMatch(wxml, /album-grid/);
});

test('home hero matches the six-screen sloth prototype index-ready card', () => {
  const wxml = readMiniProgramFile('pages', 'home', 'index.wxml');
  const wxss = readMiniProgramFile('pages', 'home', 'index.wxss');

  assert.match(wxml, /hero-panel/);
  assert.match(wxml, /hero-row/);
  assert.match(wxml, /body-copy/);
  assert.match(wxml, /mascot-orbit/);
  assert.match(wxml, /action-grid/);
  assert.match(wxml, /物品索引已准备好/);
  assert.match(wxml, /把手机横过来/);
  assert.match(wxml, /下次一搜就出来/);
  assert.doesNotMatch(wxml, /hero-topline|hero-actions/);

  assert.match(cssBlock(wxss, '.hero-panel'), /background:\s*linear-gradient\(180deg,\s*#ffffff 0%,\s*#f8f8f3 100%\)/);
  assert.doesNotMatch(cssBlock(wxss, '.hero-panel'), /box-shadow|overflow:\s*hidden/);
  assert.equal(cssBlock(wxss, '.hero-panel::before'), '');
  assert.match(cssBlock(wxss, '.hero-row'), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+152rpx/);
  assert.match(cssBlock(wxss, '.mascot-orbit'), /background:\s*#fff2c8/);
  assert.match(cssBlock(wxss, '.mascot-orbit'), /border-radius:\s*48rpx/);
  assert.match(cssBlock(wxss, '.action-grid'), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test('capture analysis uses a custom recognizing layer instead of native loading only', () => {
  const wxml = readMiniProgramFile('pages', 'capture', 'index.wxml');
  const wxss = readMiniProgramFile('pages', 'capture', 'index.wxss');
  const js = readMiniProgramFile('pages', 'capture', 'index.js');

  assert.match(wxml, /recognizing-layer/);
  assert.match(wxml, /recognizing-card/);
  assert.match(wxml, /recognizing-steps/);
  assert.match(wxml, /xiaolan-sloth\.svg/);
  assert.match(wxss, /\.recognizing-layer[\s\S]*position:\s*fixed/);
  assert.match(wxss, /\.recognizing-card/);
  assert.match(wxss, /\.recognizing-steps/);
  assert.match(js, /recognizing:\s*false/);
  assert.match(js, /this\.setData\(\{\s*recognizing:\s*true,[\s\S]*recognizingHintText:/);
  assert.doesNotMatch(js, /wx\.showLoading/);
});

test('review confirmation page exposes the new normal-state chip, ratio guide, and safe bottom actions', () => {
  const wxml = readMiniProgramFile('pages', 'capture', 'review.wxml');
  const wxss = readMiniProgramFile('pages', 'capture', 'review.wxss');

  assert.match(wxml, /sloth-chip/);
  assert.match(wxml, /ratio-guide/);
  assert.match(wxml, /ratio-landscape|ratio-portrait/);
  assert.match(wxml, /拍下一张/);
  assert.match(wxml, /保存容器/);
  assert.doesNotMatch(wxml, /下一步：拍容器/);

  assert.match(cssBlock(wxss, '.sloth-chip'), /border-radius:\s*999rpx/);
  assert.match(cssBlock(wxss, '.ratio-guide'), /rgba\(219,\s*233,\s*223,\s*0\.44\)/);
  assert.match(cssBlock(wxss, '.review-actions'), /env\(safe-area-inset-bottom\)/);
});

test('review page presents annotated photo and inventory list before editing', () => {
  const wxml = readMiniProgramFile('pages', 'capture', 'review.wxml');
  const wxss = readMiniProgramFile('pages', 'capture', 'review.wxss');

  assert.match(wxml, /拍下一张/);
  assert.match(wxml, /保存容器/);
  assert.doesNotMatch(wxml, /下一步：拍容器/);
  assert.match(wxml, /summary-panel/);
  assert.match(wxml, /photo-map/);
  assert.match(wxml, /class="plain-photo" mode="aspectFit"/);
  assert.match(wxml, /annotation-box/);
  assert.match(wxml, /wx:if="\{\{item\.hasAnnotation\}\}"/);
  assert.match(wxml, /quick-list/);
  assert.match(wxml, /quick-summary/);
  assert.match(wxml, /quick-toolbar/);
  assert.match(wxml, /quick-identity-copy/);
  assert.match(wxml, /quick-confidence/);
  assert.match(wxml, /quick-actions/);
  assert.match(wxml, /expand-button/);
  assert.match(wxml, /removeExpandedItem/);
  assert.match(wxml, /data-key="\{\{item\.itemKey\}\}"/);
  assert.match(wxml, /bindtap="toggleItemExpanded"/);
  assert.match(wxml, /item-editor/);
  assert.match(wxml, /hide-head="\{\{true\}\}"/);
  assert.match(wxml, /context-key="\{\{item\.itemKey\}\}"/);
  assert.match(wxml, /handleExpandedItemChange/);
  assert.doesNotMatch(wxml, /handleEditorCollapse/);
  assert.doesNotMatch(wxml, /segmented/);
  assert.doesNotMatch(wxml, />标注</);
  assert.doesNotMatch(wxml, />清单</);
  assert.doesNotMatch(wxml, /switchViewMode/);
  assert.doesNotMatch(wxml, /handleItemsChange/);
  assert.doesNotMatch(wxml, /scan-overlay/);
  assert.doesNotMatch(wxml, />识别中</);
  assert.doesNotMatch(wxml, /isEditMode/);
  assert.doesNotMatch(wxml, /list-expanded/);
  assert.doesNotMatch(wxml, /fake-input/);
  assert.doesNotMatch(wxml, /photo-strip/);
  assert.doesNotMatch(wxml, /quick-aside/);
  assert.doesNotMatch(wxss, /\.segmented/);
  assert.doesNotMatch(wxss, /\.segment/);
  assert.match(wxss, /\.quick-item\.expanded/);
  assert.match(wxss, /\.quick-toolbar/);
  assert.match(wxss, /\.quick-actions/);
  assert.match(wxss, /\.expand-button/);
  assert.match(wxss, /\.review-actions[\s\S]*right: 0[\s\S]*bottom: 0[\s\S]*left: 0/);
  assert.match(wxss, /\.review-actions[\s\S]*env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(cssBlock(wxss, '.photo-stage'), /background: #ffffff/);
});

test('runtime pages do not inject demo data into home or search', () => {
  const homeJs = readMiniProgramFile('pages', 'home', 'index.js');
  const searchJs = readMiniProgramFile('pages', 'search', 'index.js');
  const captureWxml = readMiniProgramFile('pages', 'capture', 'index.wxml');
  const appJs = readMiniProgramFile('app.js');
  const aiConfigJs = readMiniProgramFile('config', 'ai.js');

  assert.doesNotMatch(homeJs, /seedDemoData\(/);
  assert.doesNotMatch(searchJs, /seedDemoData\(/);
  assert.doesNotMatch(searchJs, /runSearch\('蓝色封面的书'\)/);
  assert.doesNotMatch(captureWxml, /使用示例数据/);
  assert.match(appJs, /mockMode: false/);
  assert.match(aiConfigJs, /fallbackToMock: false/);
});

test('capture flows compress analysis images while preserving stored content photos', () => {
  const captureJs = readMiniProgramFile('pages', 'capture', 'index.js');
  const reviewJs = readMiniProgramFile('pages', 'capture', 'review.js');
  const detailJs = readMiniProgramFile('pages', 'container', 'detail.js');

  for (const js of [captureJs, reviewJs, detailJs]) {
    assert.match(js, /prepareImageForAnalyze/);
    assert.match(js, /persistImage/);
    assert.match(js, /Promise\.all/);
    assert.match(js, /createImageMetadata/);
  }

  assert.match(reviewJs, /orientation:/);
  assert.match(reviewJs, /analyzeStatus:/);
  assert.match(detailJs, /analyzeStatus: 'analyzing'/);
});

test('container edit keeps a draft and returns home after saving', () => {
  const js = readMiniProgramFile('pages', 'container', 'edit.js');
  const wxml = readMiniProgramFile('pages', 'container', 'edit.wxml');
  const wxss = readMiniProgramFile('pages', 'container', 'edit.wxss');

  assert.match(js, /containerEditDraft/);
  assert.match(js, /persistDraft/);
  assert.match(js, /navigateHome\(\)/);
  assert.doesNotMatch(js, /redirectTo/);
  assert.match(wxml, /保存并回首页/);
  assert.match(wxml, /返回修改/);
  assert.match(wxml, /横过来拍，小懒看得更清楚/);
  assert.doesNotMatch(wxml, />[^<]*(4:3|16:9)[^<]*</);
  assert.doesNotMatch(js, /4:3|16:9/);
  assert.match(wxss, /\.save-actions[\s\S]*position: fixed/);
  assert.match(wxml, /outside-frame \{\{coverRatioClass\}\}/);
  assert.match(wxml, /data-ratio="\{\{coverRatioText\}\}"/);
  assert.doesNotMatch(cssBlock(wxss, '.cover'), /height:\s*382rpx/);
});

test('container save page follows the new cool-white pine prototype instead of the old warm-orange save UI', () => {
  const wxml = readMiniProgramFile('pages', 'container', 'edit.wxml');
  const wxss = readMiniProgramFile('pages', 'container', 'edit.wxss');

  assert.match(wxml, /sloth-chip/);
  assert.match(wxml, /form-panel/);
  assert.match(wxml, /field-grid/);
  assert.match(wxml, /adaptive-frame/);
  assert.match(wxml, /ratio-landscape|ratio-portrait|data-ratio/);
  assert.match(wxml, /coverRatioClass/);
  assert.match(wxml, /coverRatioText/);
  assert.doesNotMatch(wxml, /照片 \{\{index \+ 1\}\}/);

  assert.doesNotMatch(wxss, /#fff7e8|#fff9ee|#fff0b8|#ff7a59|#eadfc8|#f1e4c8/);
  assert.match(cssBlock(wxss, '.edit-page'), /#f3f2ed|linear-gradient\(180deg,\s*#f7f6f1 0%,\s*#f3f2ed 100%\)/);
  assert.match(cssBlock(wxss, '.form-panel'), /#fbfbf7|#ffffff/);
  assertCssHasAtLeast(wxss, '.field', 'height', 70);
  assert.match(cssBlock(wxss, '.save-actions'), /env\(safe-area-inset-bottom\)/);
});

test('container tab opens a real container list page', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'app.json'), 'utf8'));
  const homeJs = readMiniProgramFile('pages', 'home', 'index.js');
  const searchJs = readMiniProgramFile('pages', 'search', 'index.js');
  const listWxml = readMiniProgramFile('pages', 'container', 'list.wxml');
  const listJs = readMiniProgramFile('pages', 'container', 'list.js');

  assert.ok(appJson.pages.includes('pages/container/list'));
  assert.match(homeJs, /\/pages\/container\/list/);
  assert.match(searchJs, /\/pages\/container\/list/);
  assert.match(listWxml, /家里的东西，/);
  assert.match(listWxml, /都在这里/);
  assert.match(listWxml, /compact-search/);
  assert.match(listWxml, /library-summary/);
  assert.match(listWxml, /rowModeClass/);
  assert.match(listJs, /manage-row/);
  assert.match(listWxml, /batch-bar/);
  assert.match(listJs, /listUserContainers/);
  assert.match(listJs, /searchContainers/);
  assert.match(listJs, /toggleManageMode/);
  assert.match(listWxml, /catchtap="showContainerActions"/);
  assert.match(listJs, /showActionSheet/);
  assert.match(listJs, /confirmDeleteContainer/);
});

test('search page uses photo-first result cards and playful assistant wording', () => {
  const wxml = readMiniProgramFile('pages', 'search', 'index.wxml');
  const cardWxml = readMiniProgramFile('components', 'search-result-card', 'index.wxml');
  const cardWxss = readMiniProgramFile('components', 'search-result-card', 'index.wxss');

  assert.match(wxml, /想找什么/);
  assert.match(wxml, /result-stack/);
  assert.match(wxml, /小懒没有找到匹配物品/);
  assert.doesNotMatch(wxml, /search-submit/);
  assert.match(cardWxml, /photo-wrap/);
  assert.match(cardWxml, /match-summary/);
  assert.match(cardWxml, /查看容器/);
  assert.match(cardWxml, /locationText/);
  assert.match(cardWxss, /\.photo-badge[\s\S]*left:/);
  assert.match(cardWxss, /\.match-summary[\s\S]*#dbe9df/);
});

test('search page includes the Xiaolan searching chip and relaxed bottom navigation spacing', () => {
  const wxml = readMiniProgramFile('pages', 'search', 'index.wxml');
  const appWxss = readMiniProgramFile('app.wxss');

  assert.match(wxml, /sloth-chip/);
  assert.match(wxml, /xiaolan-sloth\.svg/);
  assert.match(wxml, /小懒在找/);
  assertCssHasAtLeast(appWxss, '.nav-item', 'gap', 10);
});

test('user-facing recognition copy uses Xiaolan instead of raw AI labels', () => {
  const files = [
    ['pages', 'capture', 'index.js'],
    ['pages', 'capture', 'review.js'],
    ['pages', 'capture', 'review.wxml'],
    ['pages', 'container', 'detail.js'],
    ['pages', 'settings', 'index.js'],
    ['pages', 'settings', 'index.wxml'],
    ['components', 'item-editor', 'index.wxml'],
    ['services', 'mock-ai.js']
  ];
  const content = files.map((segments) => readMiniProgramFile(...segments)).join('\n');
  const assetPath = path.join(__dirname, '..', 'miniprogram', 'assets', 'xiaolan-sloth.svg');

  assert.ok(fs.existsSync(assetPath));
  assert.match(content, /小懒正在分析中/);
  assert.match(content, /小懒暂时没看清/);
  assert.match(content, /小懒识别服务/);
  assert.match(content, /小懒识别/);
  assert.doesNotMatch(content, /AI 识别中|AI 识别失败|AI 未生效|AI 识别|AI 配置|本地 mock|mock 数据/);
});

test('container detail keeps carousel indicators instead of photo switch buttons', () => {
  const wxml = readMiniProgramFile('pages', 'container', 'detail.wxml');
  const wxss = readMiniProgramFile('pages', 'container', 'detail.wxss');

  assert.match(wxml, /detail-hero/);
  assert.match(wxml, /photo-card/);
  assert.match(wxml, /carousel-indicator/);
  assert.match(wxml, /compact="{{true}}"/);
  assert.match(wxml, /重新识别这张/);
  assert.match(wxml, /添加照片/);
  assert.match(wxml, /quiet-note/);
  assert.ok(wxml.indexOf('inventory-list') < wxml.indexOf('note-card'));
  assert.match(wxml, /bindtap="toggleItemExpanded"/);
  assert.match(wxml, /bindtap="addManualItem"/);
  assert.match(wxml, /item-editor/);
  assert.match(wxml, /handleExpandedItemChange/);
  assert.match(wxss, /\.inventory-list/);
  assert.match(wxss, /\.inventory-tags[\s\S]*flex-wrap: wrap/);
  assert.doesNotMatch(wxml, /照片 1<\/button>/);
  assert.doesNotMatch(wxml, /照片 2<\/button>/);
});

test('container detail does not render the appearance photo hero', () => {
  const wxml = readMiniProgramFile('pages', 'container', 'detail.wxml');
  const wxss = readMiniProgramFile('pages', 'container', 'detail.wxss');

  assert.match(wxml, /stats-row/);
  assert.doesNotMatch(wxml, /detail-cover|cover-photo|cover-label|cover-placeholder/);
  assert.doesNotMatch(wxml, /coverDisplayFileId|hasCoverImage|showCoverPlaceholder/);
  assert.doesNotMatch(wxss, /\.cover-photo|\.cover-label|\.cover-placeholder|\.cover-box-/);
});

test('photo display modes separate thumbnails from full-photo review surfaces', () => {
  const homeWxml = readMiniProgramFile('pages', 'home', 'index.wxml');
  const listWxml = readMiniProgramFile('pages', 'container', 'list.wxml');
  const resultCardWxml = readMiniProgramFile('components', 'search-result-card', 'index.wxml');
  const editWxml = readMiniProgramFile('pages', 'container', 'edit.wxml');
  const detailWxml = readMiniProgramFile('pages', 'container', 'detail.wxml');
  const annotatedWxml = readMiniProgramFile('components', 'annotated-image', 'index.wxml');
  const reviewWxml = readMiniProgramFile('pages', 'capture', 'review.wxml');

  assert.match(homeWxml, /mode="aspectFill"/);
  assert.match(listWxml, /mode="aspectFill"/);
  assert.match(resultCardWxml, /mode="aspectFill"/);
  assert.match(homeWxml, /lazy-load="\{\{true\}\}"/);
  assert.match(listWxml, /lazy-load="\{\{true\}\}"/);
  assert.match(resultCardWxml, /lazy-load="\{\{true\}\}"/);
  assert.match(editWxml, /lazy-load="\{\{true\}\}"/);
  assert.match(annotatedWxml, /lazy-load="\{\{true\}\}"/);
  assert.match(editWxml, /mode="aspectFit"/);
  assert.match(annotatedWxml, /mode="aspectFit"/);
  assert.match(reviewWxml, /class="plain-photo" mode="aspectFit"/);
});

test('container cover surfaces use landscape framing', () => {
  const homeWxss = readMiniProgramFile('pages', 'home', 'index.wxss');
  const listWxss = readMiniProgramFile('pages', 'container', 'list.wxss');

  assert.match(homeWxss, /\.container-thumb[\s\S]*height: 164rpx/);
  assert.match(listWxss, /\.container-photo[\s\S]*height: 124rpx/);
});

test('sloth minimal prototype visual tokens replace the warm orange style', () => {
  const appWxss = readMiniProgramFile('app.wxss');
  const searchWxss = readMiniProgramFile('pages', 'search', 'index.wxss');
  const listWxss = readMiniProgramFile('pages', 'container', 'list.wxss');

  assert.match(appWxss, /#f3f2ed/);
  assert.match(appWxss, /#fbfbf7/);
  assert.match(appWxss, /#1f6048/);
  assert.match(appWxss, /rgba\(21,\s*23,\s*19,\s*0\.12\)/);
  assert.doesNotMatch(cssBlock(appWxss, '.primary-button'), /#ff7a59/);
  assert.doesNotMatch(cssBlock(appWxss, '.bottom-nav'), /#fff7e8|#eadfc8/);
  assert.match(searchWxss, /\.search-mark[\s\S]*#1f6048/);
  assert.match(cssBlock(listWxss, '.manage-toggle.active'), /background:\s*#1f6048/);
  assert.match(cssBlock(listWxss, '.batch-bar'), /background:\s*rgba\(255,\s*255,\s*255,\s*0\.94\)/);
  assert.match(cssBlock(listWxss, '.batch-delete'), /background:\s*#9f3d32/);
});

test('item editor uses a high-fidelity card layout instead of cramped inline controls', () => {
  const wxml = readMiniProgramFile('components', 'item-editor', 'index.wxml');
  const js = readMiniProgramFile('components', 'item-editor', 'index.js');
  const wxss = readMiniProgramFile('components', 'item-editor', 'index.wxss');

  assert.match(wxml, /item-toolbar/);
  assert.match(wxml, /item-actions/);
  assert.match(wxml, /name-field/);
  assert.match(wxml, /field-grid/);
  assert.match(wxml, /description-field/);
  assert.match(wxml, /note-field/);
  assert.match(js, /hideHead/);
  assert.match(wxml, /bindblur="editTags"/);
  assert.match(wxml, /bindblur="editDescription"/);
  assert.match(wxml, /bindtap="removeItem"/);
  assert.match(js, /contextKey/);
  assert.match(js, /this\.triggerEvent\('change', \{\s*items,[\s\S]*contextKey: this\.data\.contextKey/);
  assert.doesNotMatch(wxml, /class="item /);
  assert.match(wxss, /\.item-card/);
  assert.match(wxss, /\.editor\.embedded/);
  assert.match(wxss, /\.editor button[\s\S]*margin: 0/);
  assert.match(wxss, /\.item-card[\s\S]*max-width: 100%/);
  assert.match(wxss, /\.item-actions[\s\S]*grid-template-columns: repeat\(2, 96rpx\)/);
  assert.match(wxss, /\.action-button[\s\S]*width: 96rpx/);
  assert.match(wxss, /\.name-input[\s\S]*height: 76rpx/);
  assert.match(wxss, /\.description-input[\s\S]*height: 132rpx/);
  assert.match(wxss, /\.note[\s\S]*height: 112rpx/);
});
