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
