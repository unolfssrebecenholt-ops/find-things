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

test('home page matches the warm four-screen prototype structure', () => {
  const wxml = readMiniProgramFile('pages', 'home', 'index.wxml');

  assert.match(wxml, /今天整理一点点/);
  assert.match(wxml, /一搜就知道/);
  assert.match(wxml, /album-grid/);
  assert.match(wxml, /bottom-nav/);
  assert.match(wxml, /最近整理/);
});

test('review page exposes mark-list switching and a next photo entry', () => {
  const wxml = readMiniProgramFile('pages', 'capture', 'review.wxml');
  const wxss = readMiniProgramFile('pages', 'capture', 'review.wxss');

  assert.match(wxml, /segmented/);
  assert.match(wxml, />标注</);
  assert.match(wxml, />清单</);
  assert.match(wxml, /拍下一张/);
  assert.match(wxml, /下一步：拍容器/);
  assert.match(wxml, /list-expanded/);
  assert.match(wxml, /fake-input/);
  assert.doesNotMatch(wxml, /photo-strip/);
  assert.match(wxss, /\.review-actions[\s\S]*right: 36rpx[\s\S]*bottom: 24rpx[\s\S]*left: 36rpx/);
  assert.doesNotMatch(wxss, /\.review-actions[\s\S]*background: rgba\(255, 253, 248, 0\.96\)/);
  assert.doesNotMatch(cssBlock(wxss, '.photo-stage'), /background: #ffffff/);
});

test('search page uses photo-first result cards and prototype wording', () => {
  const wxml = readMiniProgramFile('pages', 'search', 'index.wxml');
  const cardWxml = readMiniProgramFile('components', 'search-result-card', 'index.wxml');
  const cardWxss = readMiniProgramFile('components', 'search-result-card', 'index.wxss');

  assert.match(wxml, /想找什么/);
  assert.match(wxml, /result-stack/);
  assert.doesNotMatch(wxml, /search-submit/);
  assert.match(cardWxml, /photo-wrap/);
  assert.match(cardWxml, /match-summary/);
  assert.match(cardWxml, /查看容器/);
  assert.match(cardWxss, /\.photo-badge[\s\S]*left:/);
  assert.match(cardWxss, /\.match-summary[\s\S]*#fff1cf/);
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
