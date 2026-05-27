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

test('save container cover actions match the prototype pill action area without cramped labels', () => {
  const wxml = readMiniProgramFile('pages', 'container', 'edit.wxml');
  const wxss = readMiniProgramFile('pages', 'container', 'edit.wxss');
  const actions = cssBlock(wxss, '.cover-actions');
  const actionButton = cssBlock(wxss, '.cover-actions .action');

  assert.match(wxml, /class="primary-button action" bindtap="chooseCover">拍\/选封面<\/button>/);
  assert.match(wxml, /class="soft-button action" bindtap="useContentAsCover">用箱内图<\/button>/);
  assert.match(actions, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(actions, /gap:\s*10rpx/);
  assert.match(actionButton, /min-height:\s*86rpx/);
  assert.match(actionButton, /white-space:\s*normal/);
});
