const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readMiniProgramFile(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', 'miniprogram', ...segments), 'utf8');
}

test('all image recognition page flows pass live progress into analyzeImage', () => {
  const captureJs = readMiniProgramFile('pages', 'capture', 'index.js');
  const reviewJs = readMiniProgramFile('pages', 'capture', 'review.js');
  const detailJs = readMiniProgramFile('pages', 'container', 'detail.js');

  assert.match(captureJs, /onProgress:\s*handleProgress/, 'first-photo capture should pass live progress to analyzeImage');
  assert.match(reviewJs, /onProgress:\s*handleProgress/, 'add-next-photo review flow should pass live progress to analyzeImage');
  assert.match(detailJs, /onProgress:\s*handleProgress/, 'container detail recognition flows should pass live progress to analyzeImage');
});

test('picker-backed recognition flows preflight usage before opening camera or album', () => {
  const files = [
    ['pages/capture/index.js', readMiniProgramFile('pages', 'capture', 'index.js')],
    ['pages/capture/review.js', readMiniProgramFile('pages', 'capture', 'review.js')],
    ['pages/container/detail.js', readMiniProgramFile('pages', 'container', 'detail.js')]
  ];

  for (const [relativePath, source] of files) {
    const preflightIndex = source.indexOf('ai.getUsageStatus()');
    assert.notEqual(preflightIndex, -1, `${relativePath} should call ai.getUsageStatus() before opening a picker`);

    for (const pickerCall of ['wx.chooseMedia', 'wx.chooseImage']) {
      const pickerIndex = source.indexOf(pickerCall);
      assert.notEqual(pickerIndex, -1, `${relativePath} should still support ${pickerCall}`);
    }

    assert.match(source, /const openPicker = \(\) => \{[\s\S]*wx\.chooseMedia[\s\S]*wx\.chooseImage[\s\S]*\};/, `${relativePath} should wrap picker calls in openPicker`);
    assert.match(source, /ai\.getUsageStatus\(\)[\s\S]*\.then\(\(status\) => \{[\s\S]*privacy\.guardPrivateAction\(wx,\s*this,\s*openPicker\)[\s\S]*\}\)[\s\S]*\.catch\(\(\)\s*=>[\s\S]*privacy\.guardPrivateAction\(wx,\s*this,\s*openPicker\)/, `${relativePath} should call openPicker only through privacy authorization after preflight or after preflight failure`);
    assert.match(source, /canAnalyze\s*===\s*false/, `${relativePath} should block picker opening when usage is exhausted`);
    assert.match(source, /remainingToday/, `${relativePath} should include remaining usage text when available`);
    assert.match(source, /dailyAnalyzeLimit/, `${relativePath} should include the daily limit when available`);
    assert.match(source, /\.catch\(\(\)\s*=>[\s\S]*privacy\.guardPrivateAction\(wx,\s*this,\s*openPicker\)/, `${relativePath} should allow picker opening through privacy authorization if preflight fails`);
  }
});

test('usage preflight modal titles distinguish disabled blocked and quota states', () => {
  const files = [
    ['pages/capture/index.js', readMiniProgramFile('pages', 'capture', 'index.js')],
    ['pages/capture/review.js', readMiniProgramFile('pages', 'capture', 'review.js')],
    ['pages/container/detail.js', readMiniProgramFile('pages', 'container', 'detail.js')]
  ];

  for (const [relativePath, source] of files) {
    assert.match(source, /ANALYZE_DISABLED/, `${relativePath} should label disabled recognition separately`);
    assert.match(source, /账号暂时不可用/, `${relativePath} should label blocked accounts separately`);
    assert.match(source, /今日识别次数已用完/, `${relativePath} should keep the quota title for exhausted quota`);
  }
});

test('recognition overlays always show a progress text slot', () => {
  const wxmlFiles = [
    ['pages', 'capture', 'index.wxml'],
    ['pages', 'capture', 'review.wxml'],
    ['pages', 'container', 'detail.wxml']
  ];

  for (const segments of wxmlFiles) {
    const relativePath = segments.join('/');
    const wxml = readMiniProgramFile(...segments);

    assert.match(
      wxml,
      /class="recognizing-progress-pill">\{\{recognizingProgressText\}\}<\/text>/,
      `${relativePath} should render the progress text slot even before a count arrives`
    );
    assert.doesNotMatch(
      wxml,
      /wx:if="\{\{recognizingProgressCount > 0\}\}"\s+class="recognizing-progress-pill"/,
      `${relativePath} should not hide the progress slot before the first count`
    );
  }
});
