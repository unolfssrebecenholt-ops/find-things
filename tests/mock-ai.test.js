const test = require('node:test');
const assert = require('node:assert/strict');

const mockAi = require('../miniprogram/services/mock-ai');

test('mock analysis returns editable items with normalized bbox values', () => {
  const result = mockAi.analyzeImage({ imagePath: '/tmp/demo.jpg' });

  assert.ok(result.items.length >= 4);
  assert.ok(result.items.every((item) => item.confirmed === true));
  assert.ok(result.items.every((item) => item.bbox.x >= 0 && item.bbox.x <= 1));
  assert.ok(result.items.every((item) => item.bbox.y >= 0 && item.bbox.y <= 1));
  assert.ok(result.items.some((item) => item.displayName.includes('书') || item.category === 'book'));
});
