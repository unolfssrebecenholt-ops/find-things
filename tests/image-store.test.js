const test = require('node:test');
const assert = require('node:assert/strict');

const imageStore = require('../miniprogram/services/image-store');

test('recognizes only durable image paths as persistent', () => {
  assert.equal(imageStore.isPersistentPath('cloud://env/path/photo.jpg'), true);
  assert.equal(imageStore.isPersistentPath('https://example.com/photo.jpg'), true);
  assert.equal(imageStore.isPersistentPath('wxfile://usr/saved-photo.jpg'), true);
  assert.equal(imageStore.isPersistentPath('http://tmp/abc.jpg'), false);
  assert.equal(imageStore.isPersistentPath('https://localhost/photo.jpg'), false);
  assert.equal(imageStore.isPersistentPath('/tmp/photo.jpg'), false);
});

test('falls back to the original path outside WeChat runtime', async () => {
  const stored = await imageStore.persistImage('/tmp/photo.jpg', 'find-things/test');

  assert.equal(stored, '/tmp/photo.jpg');
});
