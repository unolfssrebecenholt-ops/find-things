const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

function loadAnalyzeFunction() {
  const modulePath = path.join(__dirname, '..', 'cloudfunctions', 'ftAnalyzeImage', 'index.js');
  const originalLoad = Module._load;
  delete require.cache[require.resolve(modulePath)];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'dynamic',
        init() {},
        downloadFile() {
          return Promise.resolve({ fileContent: Buffer.from('image') });
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test('cloud function AI request timeout uses the 120s function budget with headroom', () => {
  const analyzeFunction = loadAnalyzeFunction();

  assert.ok(analyzeFunction._test);
  assert.equal(analyzeFunction._test.aiRequestTimeoutMs(), 105000);
});

test('cloud function AI request timeout can be bounded for 60s deployments', () => {
  const analyzeFunction = loadAnalyzeFunction();

  withEnv({ FUNCTION_TIMEOUT_MS: '60000' }, () => {
    assert.equal(analyzeFunction._test.aiRequestTimeoutMs(), 45000);
  });
});

test('cloud function bounds requested item count to keep vision requests smaller', () => {
  const analyzeFunction = loadAnalyzeFunction();

  assert.equal(analyzeFunction._test.normalizeMaxItems(), 12);
  assert.equal(analyzeFunction._test.normalizeMaxItems(3), 3);
  assert.equal(analyzeFunction._test.normalizeMaxItems(18), 16);
  assert.equal(analyzeFunction._test.normalizeMaxItems(-1), 12);
});

test('cloud function prompt asks for region-by-region inventory, not only obvious items', () => {
  const analyzeFunction = loadAnalyzeFunction();
  const prompt = analyzeFunction._test.buildPrompt(12);

  assert.match(prompt, /从左上到右下/);
  assert.match(prompt, /不要只返回最显眼/);
  assert.match(prompt, /遮挡/);
  assert.match(prompt, /inContainer/);
  assert.match(prompt, /brandName/);
  assert.match(prompt, /只识别容器内部/);
  assert.match(prompt, /Logo/);
  assert.match(prompt, /品牌\/文字 \+ 物品类型/);
  assert.match(prompt, /物体封面上的图标、图案、文字/);
  assert.match(prompt, /必须 OCR/);
  assert.match(prompt, /合理拼接到 displayName/);
  assert.doesNotMatch(prompt, /要尽量 OCR/);
  assert.match(prompt, /展示信息不足以分析出具体物品名或物品类别/);
  assert.match(prompt, /可见特征 \+ 简述 \+ 形状/);
  assert.match(prompt, /特征描述/);
  assert.match(prompt, /不要把多个物品合成一个条目/);
  assert.doesNotMatch(prompt, /bbox|boundingBox|归一化坐标|标框/);
  assert.doesNotMatch(prompt, /插线板|袋子|抽屉外上方/);
});

test('cloud function maps AI timeout to a user-readable payload', () => {
  const analyzeFunction = loadAnalyzeFunction();
  const payload = analyzeFunction._test.publicError(new Error('AI request timeout'));

  assert.equal(payload.errorCode, 'AI_REQUEST_TIMEOUT');
  assert.equal(payload.items.length, 0);
  assert.match(payload.errorMessage, /AI 识别超时/);
  assert.match(payload.warnings[0], /AI 识别超时/);
});
