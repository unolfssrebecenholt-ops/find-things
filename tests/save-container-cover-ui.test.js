const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readMiniProgramFile(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', 'miniprogram', ...segments), 'utf8');
}

function cssBlock(css, selector) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : '';
}

test('save container cover area uses playful landscape guidance without visible ratio terms', () => {
  const wxml = readMiniProgramFile('pages', 'container', 'edit.wxml');
  const js = readMiniProgramFile('pages', 'container', 'edit.js');
  const visibleText = Array.from(wxml.matchAll(/>([^<>{}]+)</g), (match) => match[1]).join('\n');

  assert.match(wxml, /横过来拍，小懒看得更清楚/);
  assert.doesNotMatch(visibleText, /4:3|16:9|\bratio\b/i);
  assert.doesNotMatch(js, /4:3|16:9/);
});

test('save container uses Xiaolan themed saving overlay instead of native saving loading', () => {
  const wxml = readMiniProgramFile('pages', 'container', 'edit.wxml');
  const wxss = readMiniProgramFile('pages', 'container', 'edit.wxss');
  const js = readMiniProgramFile('pages', 'container', 'edit.js');

  assert.match(wxml, /wx:if="\{\{saving\}\}" class="saving-layer"/);
  assert.match(wxml, /saving-orbit/);
  assert.match(wxml, /saving-spinner/);
  assert.match(wxml, /xiaolan-sloth\.svg/);
  assert.match(wxml, /小懒正在收纳/);
  assert.match(wxml, /先把照片和清单塞进小抽屉/);
  assert.match(js, /saving:\s*false/);
  assert.match(js, /this\.setData\(\{\s*saving:\s*true\s*\}\)/);
  assert.match(js, /this\.setData\(\{\s*saving:\s*false\s*\}\)/);
  assert.doesNotMatch(js, /wx\.showLoading\(\{\s*title:\s*['"]保存中/);
  assert.doesNotMatch(js, /save\(\)\s*\{[\s\S]*wx\.hideLoading\(\)/);
  assert.match(cssBlock(wxss, '.saving-layer'), /position:\s*fixed/);
  assert.match(cssBlock(wxss, '.saving-spinner'), /animation:\s*saving-orbit-spin\s+1\.05s\s+linear\s+infinite/);
});

test('save container cover actions match the prototype pill action area without cramped labels', () => {
  const wxml = readMiniProgramFile('pages', 'container', 'edit.wxml');
  const wxss = readMiniProgramFile('pages', 'container', 'edit.wxss');
  const actions = cssBlock(wxss, '.cover-actions');
  const actionButton = cssBlock(wxss, '.cover-actions .action');

  assert.match(wxml, /class="primary-button action" bindtap="chooseCover">拍\/选封面<\/button>/);
  assert.match(wxml, /class="soft-button action" bindtap="useContentAsCover">用箱内图<\/button>/);
  assert.match(readMiniProgramFile('pages', 'container', 'edit.js'), /已用箱内图做封面/);
  assert.match(actions, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(actions, /gap:\s*10rpx/);
  assert.match(actionButton, /min-height:\s*86rpx/);
  assert.match(actionButton, /white-space:\s*normal/);
});

test('save container inside photos use a swipe carousel instead of a cramped grid', () => {
  const wxml = readMiniProgramFile('pages', 'container', 'edit.wxml');
  const wxss = readMiniProgramFile('pages', 'container', 'edit.wxss');
  const js = readMiniProgramFile('pages', 'container', 'edit.js');

  assert.match(wxml, /class="inside-carousel"/);
  assert.match(wxml, /<swiper[\s\S]*class="inside-swiper"[\s\S]*bindchange="onContentSwiperChange"/);
  assert.match(wxml, /carousel-dot \{\{index == currentContentImageIndex \? 'active' : ''\}\}/);
  assert.match(wxml, /carousel-count/);
  assert.doesNotMatch(wxml, /inside-photo-grid/);
  assert.doesNotMatch(wxml, /photo-copy/);
  assert.doesNotMatch(wxml, /photo-summary-meta/);
  assert.match(wxss, /\.inside-swiper[\s\S]*height:\s*330rpx/);
  assert.match(wxss, /\.carousel-dot\.active[\s\S]*width:\s*42rpx/);
  assert.doesNotMatch(wxss, /\.photo-copy/);
  assert.doesNotMatch(wxss, /\.photo-summary-meta/);
  assert.match(js, /currentContentImageIndex/);
  assert.match(js, /onContentSwiperChange/);
});

test('save container hidden item summary can expand and collapse', () => {
  const wxml = readMiniProgramFile('pages', 'container', 'edit.wxml');
  const js = readMiniProgramFile('pages', 'container', 'edit.js');

  assert.match(wxml, /bindtap="toggleItemPreview"/);
  assert.match(wxml, /itemPreviewToggleText/);
  assert.match(js, /toggleItemPreview/);
  assert.match(js, /showAllItems/);
  assert.match(js, /收起物品清单/);
});
