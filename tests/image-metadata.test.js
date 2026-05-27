const test = require('node:test');
const assert = require('node:assert/strict');

const { createImageMetadata } = require('../miniprogram/utils/image-metadata');

test('creates image metadata from chosen file dimensions', () => {
  const metadata = createImageMetadata({
    chooseResult: {
      tempFiles: [{ width: 1600, height: 900 }]
    },
    analyzedAt: 123
  });

  assert.deepEqual(metadata, {
    orientation: 'landscape',
    width: 1600,
    height: 900,
    analyzeStatus: 'ready',
    analyzedAt: 123
  });
});

test('prefers provided analysis metadata over inferred values', () => {
  const metadata = createImageMetadata({
    chooseResult: {
      tempFiles: [{ width: 800, height: 1200 }]
    },
    imageMetadata: {
      orientation: 'landscape',
      width: 1920,
      height: 1080,
      analyzeStatus: 'ready',
      analyzedAt: 456
    }
  });

  assert.deepEqual(metadata, {
    orientation: 'landscape',
    width: 1920,
    height: 1080,
    analyzeStatus: 'ready',
    analyzedAt: 456
  });
});
