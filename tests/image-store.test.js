const test = require('node:test');
const assert = require('node:assert/strict');

const imageStore = require('../miniprogram/services/image-store');

function withWx(wxMock, fn) {
  const previousWx = global.wx;
  global.wx = wxMock;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previousWx === undefined) {
        delete global.wx;
      } else {
        global.wx = previousWx;
      }
    });
}

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

test('compresses local images before AI analysis when WeChat supports it', async () => {
  await withWx({
    compressImage(options) {
      assert.equal(options.src, '/tmp/photo.jpg');
      assert.equal(options.quality, 72);
      options.success({ tempFilePath: '/tmp/photo-compressed.jpg' });
    }
  }, async () => {
    const prepared = await imageStore.prepareImageForAnalyze('/tmp/photo.jpg');

    assert.equal(prepared, '/tmp/photo-compressed.jpg');
  });
});

test('keeps persistent images unchanged before AI analysis', async () => {
  await withWx({
    compressImage() {
      throw new Error('persistent images should not be recompressed');
    }
  }, async () => {
    const prepared = await imageStore.prepareImageForAnalyze('cloud://env/path/photo.jpg');

    assert.equal(prepared, 'cloud://env/path/photo.jpg');
  });
});
