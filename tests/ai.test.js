const test = require('node:test');
const assert = require('node:assert/strict');

const ai = require('../miniprogram/services/ai');

test('normalizes AI payload into editable recognized items', () => {
  const result = ai.normalizeAiPayload({
    items: [
      {
        displayName: '黑色鼠标',
        category: 'electronics',
        features: ['黑色外壳', '红色滚轮'],
        colors: ['黑色', '红色'],
        description: '一个黑色有线鼠标，位于抽屉上方。',
        aliases: ['鼠标', '有线鼠标'],
        bbox: { x: 10, y: 5, width: 40, height: 20 },
        confidence: 0.91
      }
    ]
  }, '/tmp/photo.jpg');

  assert.equal(result.imagePath, '/tmp/photo.jpg');
  assert.equal(result.items[0].displayName, '黑色鼠标');
  assert.deepEqual(result.items[0].features, ['黑色外壳', '红色滚轮']);
  assert.deepEqual(result.items[0].colors, ['黑色', '红色']);
  assert.equal(result.items[0].bbox.x, 0.1);
  assert.equal(result.items[0].bbox.width, 0.4);
  assert.equal(result.items[0].confirmed, true);
  assert.equal(result.items[0].displayIndex, 1);
});

test('parses JSON payload even when model wraps it in a fenced block', () => {
  const parsed = ai.parseJsonPayload('```json\n{"items":[{"displayName":"钥匙"}]}\n```');

  assert.equal(parsed.items[0].displayName, '钥匙');
});

test('vision prompt requires searchable fields and normalized bboxes', () => {
  const prompt = ai.buildVisionPrompt(8);

  assert.match(prompt, /features/);
  assert.match(prompt, /description/);
  assert.match(prompt, /bbox/);
  assert.match(prompt, /归一化坐标/);
});

test('keeps recognized items without drawable bboxes in the editable list', () => {
  const result = ai.normalizeAiPayload({
    items: [
      {
        displayName: '被遮挡的小物件',
        description: '只露出一角，无法可靠标框。'
      },
      {
        displayName: '零面积框',
        bbox: { x: 0.2, y: 0.2, width: 0, height: 0.1 }
      }
    ]
  }, '/tmp/photo.jpg');

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].bbox, null);
  assert.equal(result.items[1].bbox, null);
  assert.equal(result.items[0].displayName, '被遮挡的小物件');
});

test('classifies WeChat temp image paths as local files for cloud upload', () => {
  assert.deepEqual(
    ai.getCloudImageSource('http://tmp/abc.jpg'),
    { kind: 'local', filePath: 'http://tmp/abc.jpg' }
  );
  assert.deepEqual(
    ai.getCloudImageSource('wxfile://tmp_abc.jpg'),
    { kind: 'local', filePath: 'wxfile://tmp_abc.jpg' }
  );
  assert.deepEqual(
    ai.getCloudImageSource('/tmp/demo.jpg'),
    { kind: 'local', filePath: '/tmp/demo.jpg' }
  );
});

test('classifies only real remote images as cloud-downloadable URLs', () => {
  assert.deepEqual(
    ai.getCloudImageSource('https://example.com/photo.jpg'),
    { kind: 'remote', imageUrl: 'https://example.com/photo.jpg' }
  );
  assert.deepEqual(
    ai.getCloudImageSource('cloud://env/path/photo.jpg'),
    { kind: 'cloud', imageFileId: 'cloud://env/path/photo.jpg' }
  );
});
