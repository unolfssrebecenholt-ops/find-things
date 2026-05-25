const test = require('node:test');
const assert = require('node:assert/strict');

const geometry = require('../miniprogram/utils/geometry');

test('converts normalized bbox into image overlay coordinates', () => {
  const rect = geometry.normalizedBboxToStyle(
    { x: 0.25, y: 0.1, width: 0.5, height: 0.2 },
    { width: 320, height: 240 }
  );

  assert.deepEqual(rect, {
    left: 80,
    top: 24,
    width: 160,
    height: 48
  });
});

test('clips invalid bbox values to stay within the visible image', () => {
  const rect = geometry.normalizedBboxToStyle(
    { x: -0.2, y: 0.9, width: 1.4, height: 0.4 },
    { width: 100, height: 50 }
  );

  assert.deepEqual(rect, {
    left: 0,
    top: 45,
    width: 100,
    height: 5
  });
});

test('adds display indexes without mutating recognition items', () => {
  const original = [{ tempId: 'a', bbox: { x: 0, y: 0, width: 0.1, height: 0.1 } }];
  const indexed = geometry.withDisplayIndexes(original);

  assert.equal(indexed[0].displayIndex, 1);
  assert.equal(original[0].displayIndex, undefined);
});
