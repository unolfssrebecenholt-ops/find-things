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

test('project is named find-things while V1 remains only a version label', () => {
  const projectConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'project.config.json'), 'utf8'));

  assert.equal(projectConfig.projectname, 'find-things');
  assert.notEqual(projectConfig.projectname.toLowerCase(), 'v1');
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
  assert.match(wxml, /album-grid/);
  assert.match(wxml, /bottom-nav/);
  assert.match(wxml, /最近整理/);
  assert.match(wxml, /小懒还没有东西可找/);
  assert.match(wxml, /xiaolan-sloth\.svg/);
});

test('review page presents a plain photo and inventory list before editing', () => {
  const wxml = readMiniProgramFile('pages', 'capture', 'review.wxml');
  const wxss = readMiniProgramFile('pages', 'capture', 'review.wxss');

  assert.match(wxml, /segmented/);
  assert.match(wxml, />清单</);
  assert.match(wxml, />编辑</);
  assert.match(wxml, /拍下一张/);
  assert.match(wxml, /下一步：拍容器/);
  assert.match(wxml, /summary-panel/);
  assert.match(wxml, /plain-photo/);
  assert.match(wxml, /quick-list/);
  assert.doesNotMatch(wxml, /annotated-image/);
  assert.doesNotMatch(wxml, />标注</);
  assert.doesNotMatch(wxml, /标框/);
  assert.doesNotMatch(wxml, /list-expanded/);
  assert.doesNotMatch(wxml, /fake-input/);
  assert.doesNotMatch(wxml, /photo-strip/);
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
  }
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
  assert.match(wxml, /建议横拍/);
  assert.match(wxml, /16:9/);
  assert.match(wxss, /\.save-actions[\s\S]*position: fixed/);
  assert.match(wxss, /\.cover[\s\S]*height: 382rpx/);
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
  assert.match(listWxml, /全部容器/);
  assert.match(listJs, /listUserContainers/);
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
  assert.match(cardWxss, /\.photo-badge[\s\S]*left:/);
  assert.match(cardWxss, /\.match-summary[\s\S]*#fff0b8/);
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
  assert.match(wxml, /carousel-indicator/);
  assert.match(wxml, /compact="{{true}}"/);
  assert.match(wxml, /重新识别这张/);
  assert.match(wxml, /添加照片/);
  assert.ok(wxml.indexOf('item-tags') < wxml.indexOf('note-card'));
  assert.match(wxss, /\.item-tags[\s\S]*flex-wrap: wrap/);
  assert.doesNotMatch(wxml, /照片 1<\/button>/);
  assert.doesNotMatch(wxml, /照片 2<\/button>/);
});

test('photo display modes separate thumbnails from full-photo review surfaces', () => {
  const homeWxml = readMiniProgramFile('pages', 'home', 'index.wxml');
  const listWxml = readMiniProgramFile('pages', 'container', 'list.wxml');
  const resultCardWxml = readMiniProgramFile('components', 'search-result-card', 'index.wxml');
  const editWxml = readMiniProgramFile('pages', 'container', 'edit.wxml');
  const detailWxml = readMiniProgramFile('pages', 'container', 'detail.wxml');
  const annotatedWxml = readMiniProgramFile('components', 'annotated-image', 'index.wxml');

  assert.match(homeWxml, /mode="aspectFill"/);
  assert.match(listWxml, /mode="aspectFill"/);
  assert.match(resultCardWxml, /mode="aspectFill"/);
  assert.match(editWxml, /mode="aspectFit"/);
  assert.match(detailWxml, /mode="aspectFit"/);
  assert.match(annotatedWxml, /mode="aspectFit"/);
});

test('container cover surfaces use landscape framing', () => {
  const homeWxss = readMiniProgramFile('pages', 'home', 'index.wxss');
  const listWxss = readMiniProgramFile('pages', 'container', 'list.wxss');
  const detailWxss = readMiniProgramFile('pages', 'container', 'detail.wxss');

  assert.match(homeWxss, /\.album-photo[\s\S]*height: 186rpx/);
  assert.match(listWxss, /\.container-photo[\s\S]*height: 124rpx/);
  assert.match(detailWxss, /\.cover-photo[\s\S]*height: 382rpx/);
});

test('item editor uses a high-fidelity card layout instead of cramped inline controls', () => {
  const wxml = readMiniProgramFile('components', 'item-editor', 'index.wxml');
  const wxss = readMiniProgramFile('components', 'item-editor', 'index.wxss');

  assert.match(wxml, /item-toolbar/);
  assert.match(wxml, /item-actions/);
  assert.match(wxml, /name-field/);
  assert.match(wxml, /field-grid/);
  assert.match(wxml, /description-field/);
  assert.match(wxml, /note-field/);
  assert.match(wxml, /bindblur="editTags"/);
  assert.match(wxml, /bindblur="editDescription"/);
  assert.match(wxml, /bindtap="removeItem"/);
  assert.doesNotMatch(wxml, /class="item /);
  assert.match(wxss, /\.item-card/);
  assert.match(wxss, /\.editor button[\s\S]*margin: 0/);
  assert.match(wxss, /\.item-card[\s\S]*max-width: 100%/);
  assert.match(wxss, /\.item-actions[\s\S]*grid-template-columns: repeat\(2, 96rpx\)/);
  assert.match(wxss, /\.action-button[\s\S]*width: 96rpx/);
  assert.match(wxss, /\.name-input[\s\S]*height: 76rpx/);
  assert.match(wxss, /\.description-input[\s\S]*height: 132rpx/);
  assert.match(wxss, /\.note[\s\S]*height: 112rpx/);
});
