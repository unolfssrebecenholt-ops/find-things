const test = require('node:test');
const assert = require('node:assert/strict');

const { isMockAssetPath } = require('../miniprogram/utils/mock-assets');

test('recognizes design-only mock image paths so placeholders render instead of broken images', () => {
  assert.equal(isMockAssetPath('/assets/mock-container-content.jpg'), true);
  assert.equal(isMockAssetPath('/assets/mock-container-content-left.jpg'), true);
  assert.equal(isMockAssetPath('/tmp/user-photo.jpg'), false);
  assert.equal(isMockAssetPath('cloud://find-things/photo.jpg'), false);
});

test('home and image components guard mock image paths before rendering image tags', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..', 'miniprogram');

  const homeJs = fs.readFileSync(path.join(root, 'pages', 'home', 'index.js'), 'utf8');
  const annotatedJs = fs.readFileSync(path.join(root, 'components', 'annotated-image', 'index.js'), 'utf8');
  const resultCardJs = fs.readFileSync(path.join(root, 'components', 'search-result-card', 'index.js'), 'utf8');

  assert.match(homeJs, /isMockAssetPath/);
  assert.match(annotatedJs, /isMockAssetPath/);
  assert.match(resultCardJs, /isMockAssetPath/);
});
