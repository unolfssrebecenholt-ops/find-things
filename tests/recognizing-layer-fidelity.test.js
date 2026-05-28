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

function assertRecognizingLayerMarkup(wxml, pageName) {
  assert.match(wxml, /recognizing-layer/, `${pageName} should render a custom recognizing layer`);
  assert.match(wxml, /recognizing-card/, `${pageName} should render the recognizing card`);
  assert.match(wxml, /recognizing-top/, `${pageName} should include the prototype card header`);
  assert.match(wxml, /recognizing-orbit/, `${pageName} should wrap Xiaolan in the orbit progress ring`);
  assert.match(wxml, /recognizing-spinner/, `${pageName} should render the rotating orbit image`);
  assert.match(wxml, /\/assets\/loading-orbit-arc\.svg/, `${pageName} should use the local orbit arc asset`);
  assert.match(wxml, /recognizing-mascot/, `${pageName} should keep Xiaolan separate from the spinner`);
  assert.match(wxml, /recognizing-title/, `${pageName} should include a title`);
  assert.match(wxml, /recognizing-copy/, `${pageName} should include explanatory copy`);
  assert.match(wxml, /\{\{recognizingDescText\}\}/, `${pageName} should bind live progress into the main recognizing description`);
  assert.match(wxml, /recognizing-progress-pill/, `${pageName} should show a visible live progress pill`);
  assert.match(wxml, /recognizing-dot/, `${pageName} should include step dots`);
  assert.match(wxml, /recognizing-state/, `${pageName} should include step statuses`);
  assert.match(wxml, /\{\{recognizingProgressStateText\}\}/, `${pageName} should show the live count in the step status`);
  assert.match(wxml, /recognizing-hint/, `${pageName} should include the bottom playful hint`);
  assert.match(wxml, /\{\{recognizingHintText\}\}/, `${pageName} should bind live recognized item progress into the hint`);
  assert.equal((wxml.match(/class="recognizing-step(?:\s|")/g) || []).length, 3, `${pageName} should render three richer steps`);
  assert.doesNotMatch(wxml, /<view class="recognizing-step active"><\/view>/, `${pageName} should not use empty bar steps`);
}

test('capture and review recognizing overlays match the richer sloth prototype structure', () => {
  const captureWxml = readMiniProgramFile('pages', 'capture', 'index.wxml');
  const reviewWxml = readMiniProgramFile('pages', 'capture', 'review.wxml');

  assertRecognizingLayerMarkup(captureWxml, 'capture page');
  assertRecognizingLayerMarkup(reviewWxml, 'review page');
});

test('recognizing overlay styles preserve orbit, step list, and hint fidelity', () => {
  for (const fileName of ['index.wxss', 'review.wxss']) {
    const wxss = readMiniProgramFile('pages', 'capture', fileName);

    assert.match(cssBlock(wxss, '.recognizing-layer'), /background:\s*rgba\(251,\s*251,\s*247,\s*0\.66\)/, `${fileName} should use prototype overlay wash`);
    assert.match(cssBlock(wxss, '.recognizing-card'), /background:\s*rgba\(255,\s*255,\s*255,\s*0\.92\)/, `${fileName} should use prototype card surface`);
    assert.match(cssBlock(wxss, '.recognizing-card'), /border-radius:\s*56rpx/, `${fileName} should use the prototype card radius`);
    assert.match(cssBlock(wxss, '.recognizing-top'), /display:\s*flex/, `${fileName} should lay out orbit and copy horizontally`);
    assert.match(cssBlock(wxss, '.recognizing-spinner'), /animation:\s*recognizing-orbit-spin\s+1\.05s\s+linear\s+infinite/, `${fileName} should spin the orbit image`);
    assert.match(cssBlock(wxss, '.recognizing-mascot'), /z-index:\s*2/, `${fileName} should keep Xiaolan above the spinner`);
    assert.match(wxss, /@keyframes\s+recognizing-orbit-spin/, `${fileName} should define the orbit spin animation`);
    assert.match(cssBlock(wxss, '.recognizing-step'), /grid-template-columns:\s*36rpx\s+minmax\(0,\s*1fr\)\s+auto/, `${fileName} should render dot, label, and status columns`);
    assert.match(cssBlock(wxss, '.recognizing-state'), /white-space:\s*nowrap/, `${fileName} should keep step status readable`);
    assert.match(cssBlock(wxss, '.recognizing-hint'), /rgba\(219,\s*233,\s*223,\s*0\.56\)/, `${fileName} should use the playful hint panel`);
  }
});
