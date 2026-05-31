const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const localAiConfigPath = path.join(__dirname, '..', 'miniprogram', 'config', 'ai.local.js');
require.cache[localAiConfigPath] = {
  id: localAiConfigPath,
  filename: localAiConfigPath,
  loaded: true,
  exports: {}
};
const ai = require('../miniprogram/services/ai');

function withWxStorage(values, fn) {
  const previousWx = global.wx;
  global.wx = {
    getStorageSync(key) {
      return values[key];
    },
    setStorageSync() {}
  };
  try {
    fn();
  } finally {
    if (previousWx === undefined) {
      delete global.wx;
    } else {
      global.wx = previousWx;
    }
  }
}

async function withImmediateTimers(fn) {
  const previousSetTimeout = global.setTimeout;
  global.setTimeout = (callback) => {
    callback();
    return 0;
  };
  try {
    await fn();
  } finally {
    global.setTimeout = previousSetTimeout;
  }
}

async function withQueuedTimers(fn) {
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  const timers = [];
  let nextId = 1;
  const activeTimers = new Set();
  global.setTimeout = (callback, delayMs) => {
    const id = nextId;
    nextId += 1;
    activeTimers.add(id);
    timers.push({ id, callback, delayMs });
    return id;
  };
  global.clearTimeout = (id) => {
    activeTimers.delete(id);
  };
  const runNextTimer = async () => {
    const timer = timers.shift();
    if (!timer) return false;
    if (activeTimers.has(timer.id)) {
      activeTimers.delete(timer.id);
      timer.callback();
      await Promise.resolve();
      await Promise.resolve();
    }
    return true;
  };
  try {
    await fn({ timers, runNextTimer });
  } finally {
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
  }
}

test('defaults to cloud transport so deployed function environment variables are used', () => {
  const config = ai.getRuntimeConfig();

  assert.equal(config.transport, 'cloud');
  assert.equal(config.cloudFunctionName, 'ftAnalyzeImage');
  assert.equal(config.maxItems, 12);
  assert.ok(config.relays.length >= 1);
  assert.equal(config.relays[0].baseUrl, 'https://aipaiai.cn');
});

test('uses cloud transport when stale direct setting has no local API key', () => {
  withWxStorage({
    'findThings.aiTransport': 'direct',
    'findThings.aiApiKey': ''
  }, () => {
    const config = ai.getRuntimeConfig();

    assert.equal(config.transport, 'cloud');
  });
});

test('keeps direct transport when a local API key is explicitly configured', () => {
  withWxStorage({
    'findThings.aiTransport': 'direct',
    'findThings.aiApiKey': 'sk-local-test'
  }, () => {
    const config = ai.getRuntimeConfig();

    assert.equal(config.transport, 'direct');
    assert.equal(config.apiKey, 'sk-local-test');
    assert.equal(config.relays[0].apiKey, 'sk-local-test');
  });
});

test('throws user-readable cloud analyze error payloads', () => {
  assert.throws(
    () => ai.unwrapCloudAnalyzePayload({
      errorCode: 'AI_REQUEST_TIMEOUT',
      errorMessage: '小懒看得有点久，请换一张更清晰或更小的照片后重试。'
    }),
    /小懒看得有点久/
  );
});

test('rewrites stale cloud network failures into Xiaolan copy', () => {
  assert.throws(
    () => ai.unwrapCloudAnalyzePayload({
      errorCode: 'ECONNREFUSED',
      errorMessage: 'AI 识别失败，请重试或手动添加物品。'
    }),
    (error) => {
      assert.equal(error.code, 'AI_SERVICE_UNREACHABLE');
      assert.match(error.message, /小懒没连上识别服务/);
      assert.doesNotMatch(error.message, /AI 识别失败/);
      return true;
    }
  );
});

test('rewrites cloud call socket timeouts into Xiaolan copy', () => {
  const error = ai.friendlyCloudCallError(new Error('cloud.callFunction:fail Error: errCode: -501002 resource server timeout | errMsg: ESOCKETTIMEDOUT'));

  assert.equal(error.code, 'AI_REQUEST_TIMEOUT');
  assert.match(error.message, /小懒看得有点久/);
  assert.doesNotMatch(error.message, /ESOCKETTIMEDOUT|-501002/);
});

test('getUsageStatus normalizes cloud usage status for page preflight', async () => {
  const previousWx = global.wx;
  const calls = [];
  global.wx = {
    getStorageSync() {},
    cloud: {
      callFunction(options) {
        calls.push(options);
        return Promise.resolve({
          result: {
            usedToday: 2,
            dailyAnalyzeLimit: 5,
            remainingToday: 3,
            analyzeEnabled: true,
            blocked: false,
            canAnalyze: true,
            quotaOverrideSource: 'admin'
          }
        });
      }
    }
  };

  try {
    const status = await ai.getUsageStatus();

    assert.deepEqual(calls, [{
      name: 'ftAnalyzeImage',
      data: { action: 'getUsageStatus' }
    }]);
    assert.deepEqual(status, {
      usedToday: 2,
      dailyAnalyzeLimit: 5,
      remainingToday: 3,
      analyzeEnabled: true,
      blocked: false,
      canAnalyze: true,
      errorCode: '',
      errorMessage: ''
    });
  } finally {
    if (previousWx === undefined) {
      delete global.wx;
    } else {
      global.wx = previousWx;
    }
  }
});

test('getUsageStatus blocks preflight when disabled blocked or quota exhausted', async () => {
  const previousWx = global.wx;
  const payloads = [
    { usedToday: 5, dailyAnalyzeLimit: 5, remainingToday: 0, analyzeEnabled: true, blocked: false },
    { usedToday: 1, dailyAnalyzeLimit: 5, remainingToday: 4, analyzeEnabled: false, blocked: false },
    { usedToday: 1, dailyAnalyzeLimit: 5, remainingToday: 4, analyzeEnabled: true, blocked: true, errorCode: 'USER_BLOCKED' }
  ];
  let index = 0;
  global.wx = {
    getStorageSync() {},
    cloud: {
      callFunction() {
        const payload = payloads[index];
        index += 1;
        return Promise.resolve({ result: payload });
      }
    }
  };

  try {
    const statuses = [];
    for (const payload of payloads) {
      const status = await ai.getUsageStatus();
      statuses.push(status);

      assert.equal(status.canAnalyze, false);
      assert.equal(status.blocked, !!payload.blocked);
    }
    assert.match(statuses[0].errorMessage, /次数|明天|用完/);
    assert.match(statuses[1].errorMessage, /暂时|关闭|稍后/);
    assert.match(statuses[2].errorMessage, /账号|暂时|不能/);
  } finally {
    if (previousWx === undefined) {
      delete global.wx;
    } else {
      global.wx = previousWx;
    }
  }
});

test('getUsageStatus allows local preflight when cloud function is unavailable', async () => {
  const previousWx = global.wx;
  delete global.wx;

  try {
    const status = await ai.getUsageStatus();

    assert.equal(status.usedToday, 0);
    assert.equal(status.dailyAnalyzeLimit, null);
    assert.equal(status.remainingToday, null);
    assert.equal(status.analyzeEnabled, true);
    assert.equal(status.blocked, false);
    assert.equal(status.canAnalyze, true);
    assert.equal(status.errorCode, '');
    assert.equal(status.errorMessage, '');
  } finally {
    if (previousWx === undefined) {
      delete global.wx;
    } else {
      global.wx = previousWx;
    }
  }
});

test('polls analyze task when the initial cloud call times out', async () => {
  const previousWx = global.wx;
  let callCount = 0;
  global.wx = {
    getStorageSync() {},
    cloud: {
      callFunction(options) {
        callCount += 1;
        if (!options.data.action) {
          return Promise.reject(new Error('cloud.callFunction:fail errCode: -501002 ESOCKETTIMEDOUT'));
        }
        if (callCount === 2) {
          return Promise.resolve({ result: { status: 'processing' } });
        }
        return Promise.resolve({
          result: {
            status: 'success',
            result: {
              items: [{ displayName: '黑色鼠标', inContainer: true }]
            }
          }
        });
      }
    }
  };

  try {
    await withImmediateTimers(async () => {
      const result = await ai.analyzeImage({
        imagePath: 'cloud://env/path/photo.jpg',
        allowMockFallback: false
      });

      assert.equal(result.items[0].displayName, '黑色鼠标');
      assert.ok(callCount >= 3);
    });
  } finally {
    if (previousWx === undefined) {
      delete global.wx;
    } else {
      global.wx = previousWx;
    }
  }
});

test('polls analyze task when the initial cloud call fails after task creation', async () => {
  const previousWx = global.wx;
  let callCount = 0;
  global.wx = {
    getStorageSync() {},
    cloud: {
      callFunction(options) {
        callCount += 1;
        if (!options.data.action) {
          return Promise.reject(new Error('cloud.callFunction:fail interrupted while function kept running'));
        }
        return Promise.resolve({
          result: {
            status: 'success',
            result: {
              items: [{ displayName: '娴佸紡璇嗗埆鐩掑瓙', inContainer: true }]
            }
          }
        });
      }
    }
  };

  try {
    await withImmediateTimers(async () => {
      const result = await ai.analyzeImage({
        imagePath: 'cloud://env/path/photo.jpg',
        allowMockFallback: false
      });

      assert.equal(result.items[0].displayName, '娴佸紡璇嗗埆鐩掑瓙');
      assert.equal(callCount, 2);
    });
  } finally {
    if (previousWx === undefined) {
      delete global.wx;
    } else {
      global.wx = previousWx;
    }
  }
});

test('reports analyze progress from task polling while waiting for final result', async () => {
  const previousWx = global.wx;
  const progressCounts = [];
  let callCount = 0;
  global.wx = {
    getStorageSync() {},
    cloud: {
      callFunction(options) {
        callCount += 1;
        if (!options.data.action) {
          return Promise.reject(new Error('cloud.callFunction:fail errCode: -501002 ESOCKETTIMEDOUT'));
        }
        if (callCount === 2) {
          return Promise.resolve({
            result: {
              status: 'processing',
              progress: { recognizedItemCount: 2 }
            }
          });
        }
        return Promise.resolve({
          result: {
            status: 'success',
            result: {
              items: [{ displayName: '榛戣壊榧犳爣', inContainer: true }]
            }
          }
        });
      }
    }
  };

  try {
    await withImmediateTimers(async () => {
      const result = await ai.analyzeImage({
        imagePath: 'cloud://env/path/photo.jpg',
        allowMockFallback: false,
        onProgress(progress) {
          progressCounts.push(progress.recognizedItemCount);
        }
      });

      assert.equal(result.items[0].displayName, '榛戣壊榧犳爣');
      assert.deepEqual(progressCounts, [2]);
    });
  } finally {
    if (previousWx === undefined) {
      delete global.wx;
    } else {
      global.wx = previousWx;
    }
  }
});

test('reports analyze progress while the initial cloud call is still running', async () => {
  const previousWx = global.wx;
  const progressCounts = [];
  let resolveInitialCall;
  let initialCallResolved = false;
  let progressPollCount = 0;
  global.wx = {
    getStorageSync() {},
    cloud: {
      callFunction(options) {
        if (!options.data.action) {
          return new Promise((resolve) => {
            resolveInitialCall = (value) => {
              initialCallResolved = true;
              resolve(value);
            };
          });
        }
        progressPollCount += 1;
        return Promise.resolve({
          result: {
            status: 'processing',
            progress: { recognizedItemCount: 3 }
          }
        });
      }
    }
  };

  try {
    await withQueuedTimers(async ({ runNextTimer }) => {
      const resultPromise = ai.analyzeImage({
        imagePath: 'cloud://env/path/photo.jpg',
        allowMockFallback: false,
        onProgress(progress) {
          progressCounts.push(progress.recognizedItemCount);
        }
      });

      await Promise.resolve();
      await Promise.resolve();
      await runNextTimer();

      assert.equal(initialCallResolved, false);
      assert.equal(progressPollCount, 1);
      assert.deepEqual(progressCounts, [3]);

      resolveInitialCall({
        result: {
          items: [{ displayName: '榛戣壊榧犳爣', inContainer: true }]
        }
      });
      const result = await resultPromise;
      assert.equal(result.items[0].displayName, '榛戣壊榧犳爣');
    });
  } finally {
    if (previousWx === undefined) {
      delete global.wx;
    } else {
      global.wx = previousWx;
    }
  }
});

test('keeps the original cloud call error when fallback polling cannot recover', async () => {
  const previousWx = global.wx;
  let callCount = 0;
  global.wx = {
    getStorageSync() {},
    cloud: {
      callFunction(options) {
        callCount += 1;
        if (!options.data.action) {
          return Promise.reject(new Error('cloud.callFunction:fail bad request'));
        }
        return Promise.resolve({ result: { status: 'processing' } });
      }
    }
  };

  try {
    await withImmediateTimers(async () => {
      await assert.rejects(
        ai.analyzeImage({
          imagePath: 'cloud://env/path/photo.jpg',
          allowMockFallback: false
        }),
        /cloud\.callFunction:fail bad request/
      );
      assert.equal(callCount, 11);
    });
  } finally {
    if (previousWx === undefined) {
      delete global.wx;
    } else {
      global.wx = previousWx;
    }
  }
});

test('normalizes AI payload into editable recognized items', () => {
  const result = ai.normalizeAiPayload({
    items: [
      {
        displayName: '黑色鼠标',
        category: 'electronics',
        brandName: 'Logi',
        features: ['黑色外壳', '红色滚轮'],
        colors: ['黑色', '红色'],
        visibleText: 'M185',
        description: '一个黑色有线鼠标，位于抽屉内部上方。',
        aliases: ['鼠标', '有线鼠标'],
        bbox: { x: 10, y: 5, width: 40, height: 20 },
        confidence: 0.91
      }
    ]
  }, '/tmp/photo.jpg');

  assert.equal(result.imagePath, '/tmp/photo.jpg');
  assert.equal(result.items[0].displayName, 'Logi 黑色鼠标');
  assert.equal(result.items[0].brandName, 'Logi');
  assert.equal(result.items[0].visibleText, 'M185');
  assert.ok(result.items[0].aliases.includes('Logi'));
  assert.ok(result.items[0].aliases.includes('M185'));
  assert.deepEqual(result.items[0].features, ['黑色外壳', '红色滚轮']);
  assert.deepEqual(result.items[0].colors, ['黑色', '红色']);
  assert.equal(result.items[0].bbox.x, 0.1);
  assert.equal(result.items[0].bbox.width, 0.4);
  assert.equal(result.items[0].confirmed, true);
  assert.equal(result.items[0].displayIndex, 1);
});

test('filters items that the model marks outside the container interior', () => {
  const result = ai.normalizeAiPayload({
    items: [
      {
        displayName: '抽屉外插线板',
        inContainer: false,
        description: '位于抽屉外上方，不应保存。'
      },
      {
        displayName: '红色铁盒',
        inContainer: true,
        description: '位于抽屉内部。'
      }
    ]
  }, '/tmp/photo.jpg');

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].displayName, '红色铁盒');
});

test('parses JSON payload even when model wraps it in a fenced block', () => {
  const parsed = ai.parseJsonPayload('```json\n{"items":[{"displayName":"钥匙"}]}\n```');

  assert.equal(parsed.items[0].displayName, '钥匙');
});

test('normalizes item titles with brand first and feature fallback', () => {
  const result = ai.normalizeAiPayload({
    items: [
      {
        displayName: '护手霜礼盒',
        brandName: 'Herbacin',
        features: ['红色铁盒']
      },
      {
        brandName: '',
        category: '发饰',
        features: ['粉色', '心形', '小号'],
        description: '位于右下角的粉色心形小发夹。'
      }
    ]
  }, '/tmp/photo.jpg');

  assert.equal(result.items[0].displayName, 'Herbacin 护手霜礼盒');
  assert.equal(result.items[1].displayName, '粉色心形小号发饰');
});

test('vision prompt requires searchable fields without bbox positioning', () => {
  const prompt = ai.buildVisionPrompt(12);

  assert.match(prompt, /features/);
  assert.match(prompt, /description/);
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
