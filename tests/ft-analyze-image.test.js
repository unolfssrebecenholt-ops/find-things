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

async function withNow(value, fn) {
  const originalNow = Date.now;
  Date.now = () => value;
  try {
    return await fn();
  } finally {
    Date.now = originalNow;
  }
}

function loadAnalyzeFunction(options = {}) {
  const modulePath = path.join(__dirname, '..', 'cloudfunctions', 'ftAnalyzeImage', 'index.js');
  const originalLoad = Module._load;
  const collections = options.collections || {};
  if (!collections.ft_analyze_tasks) {
    collections.ft_analyze_tasks = Object.assign({}, options.taskRows || {});
  } else {
    Object.assign(collections.ft_analyze_tasks, options.taskRows || {});
  }
  const taskUpdates = options.taskUpdates || [];
  delete require.cache[require.resolve(modulePath)];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'https' && options.https) {
      return options.https;
    }
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'dynamic',
        init() {},
        getWXContext() {
          return options.wxContext || { OPENID: options.openid || 'test-openid' };
        },
        database() {
          const db = {
            collection(name) {
              if (!collections[name]) collections[name] = {};
              return {
                doc(id) {
                  return {
                    get() {
                      return Promise.resolve({ data: collections[name][id] || null });
                    },
                    set({ data }) {
                      collections[name][id] = Object.assign({ _id: id }, data);
                      return Promise.resolve({});
                    },
                    update({ data }) {
                      taskUpdates.push({ collection: name, id, data });
                      collections[name][id] = Object.assign({ _id: id }, collections[name][id] || {}, data);
                      return Promise.resolve({});
                    }
                  };
                }
              };
            }
          };
          if (Object.prototype.hasOwnProperty.call(options, 'runTransaction')) {
            db.runTransaction = options.runTransaction;
          }
          return db;
        },
        downloadFile() {
          return Promise.resolve({ fileContent: Buffer.from('image') });
        }
      };
    }
    if (request === './local.config' && Object.prototype.hasOwnProperty.call(options, 'localConfig')) {
      return options.localConfig;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function createMockHttps(responseBody, options = {}) {
  const { EventEmitter } = require('node:events');
  return {
    request(requestOptions, callback) {
      if (options.requests) options.requests.push(requestOptions);
      const request = new EventEmitter();
      request.write = () => {};
      request.end = () => {
        const response = new EventEmitter();
        response.statusCode = options.statusCode || 200;
        response.headers = options.headers || {};
        callback(response);
        process.nextTick(() => {
          response.emit('data', Buffer.from(responseBody));
          response.emit('end');
        });
      };
      request.setTimeout = () => request;
      request.destroy = (error) => {
        if (error) request.emit('error', error);
      };
      return request;
    }
  };
}

function createMockSseHttps(events, options = {}) {
  const { EventEmitter } = require('node:events');
  return {
    request(requestOptions, callback) {
      const request = new EventEmitter();
      request.write = () => {};
      request.end = () => {
        const response = new EventEmitter();
        response.statusCode = options.statusCode || 200;
        response.headers = Object.assign({ 'content-type': 'text/event-stream' }, options.headers || {});
        callback(response);
        process.nextTick(() => {
          for (const event of events) {
            response.emit('data', Buffer.from(`data: ${event}\n\n`));
          }
          response.emit('data', Buffer.from('data: [DONE]\n\n'));
          response.emit('end');
        });
      };
      request.setTimeout = () => request;
      request.destroy = (error) => {
        if (error) request.emit('error', error);
      };
      return request;
    }
  };
}

test('cloud function AI request timeout defaults to 120s for relay failover', () => {
  const analyzeFunction = loadAnalyzeFunction();

  assert.ok(analyzeFunction._test);
  assert.equal(analyzeFunction._test.aiRequestTimeoutMs(), 120000);
});

test('cloud function AI request timeout can be bounded for 60s deployments', () => {
  const analyzeFunction = loadAnalyzeFunction();

  withEnv({ FUNCTION_TIMEOUT_MS: '60000' }, () => {
    assert.equal(analyzeFunction._test.aiRequestTimeoutMs(), 45000);
  });
});

test('cloud function AI request timeout respects the function budget headroom', () => {
  const analyzeFunction = loadAnalyzeFunction();

  withEnv({ FUNCTION_TIMEOUT_MS: '120000' }, () => {
    assert.equal(analyzeFunction._test.aiRequestTimeoutMs(), 105000);
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

test('cloud function supports multiple relay entries for failover', () => {
  const analyzeFunction = loadAnalyzeFunction({
    localConfig: {
      relays: [
        {
          id: 'primary',
          baseUrl: 'https://primary.example.com',
          endpoint: '/v1/chat/completions',
          model: 'gpt-5.5',
          apiKey: 'test-primary'
        },
        {
          id: 'backup',
          baseUrl: 'https://backup.example.com',
          endpoint: '/v1/chat/completions',
          model: 'gpt-5.5',
          apiKey: 'test-backup'
        }
      ]
    }
  });

  const relays = analyzeFunction._test.getRelays();

  assert.equal(relays.length, 2);
  assert.equal(relays[0].id, 'primary');
  assert.equal(analyzeFunction._test.relayEndpointUrl(relays[1]), 'https://backup.example.com/v1/chat/completions');
});

test('cloud function can read relay entries from environment JSON', () => {
  const analyzeFunction = loadAnalyzeFunction({ localConfig: {} });
  withEnv({
    OPENAI_COMPAT_RELAYS: JSON.stringify([
      {
        id: 'env-primary',
        baseUrl: 'https://env.example.com',
        endpoint: '/v1/chat/completions',
        model: 'gpt-5.5',
        apiKey: 'test-env'
      }
    ])
  }, () => {
    const relays = analyzeFunction._test.getRelays();

    assert.equal(relays.length, 1);
    assert.equal(relays[0].id, 'env-primary');
  });
});

test('cloud function builds chat completions payload for chat endpoint relays', () => {
  const analyzeFunction = loadAnalyzeFunction();
  const request = analyzeFunction._test.buildAiRequest({
    endpoint: '/v1/chat/completions',
    model: 'gpt-5.5'
  }, 'data:image/jpeg;base64,aW1hZ2U=', 12);

  assert.equal(request.payloadKind, 'chat_completions');
  assert.equal(request.payload.model, 'gpt-5.5');
  assert.equal(request.payload.response_format.type, 'json_object');
  assert.equal(request.payload.messages[0].content[0].type, 'text');
  assert.equal(request.payload.messages[0].content[1].type, 'image_url');
  assert.equal(request.payload.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,aW1hZ2U=');
  assert.ok(request.requestBytes > 0);
});

test('cloud function builds responses payload for responses endpoint relays', () => {
  const analyzeFunction = loadAnalyzeFunction();
  const request = analyzeFunction._test.buildAiRequest({
    endpoint: '/v1/responses',
    model: 'gpt-5.5'
  }, 'data:image/jpeg;base64,aW1hZ2U=', 12);

  assert.equal(request.payloadKind, 'responses');
  assert.equal(request.payload.model, 'gpt-5.5');
  assert.equal(request.payload.text.format.type, 'json_object');
  assert.equal(request.payload.stream, undefined);
  assert.equal(request.payload.response_format, undefined);
  assert.equal(request.payload.input[0].content[0].type, 'input_text');
  assert.equal(request.payload.input[0].content[1].type, 'input_image');
  assert.equal(request.payload.input[0].content[1].image_url, 'data:image/jpeg;base64,aW1hZ2U=');
  assert.ok(request.requestBytes > 0);
});

test('cloud function adds stream flag only for streaming relays', () => {
  const analyzeFunction = loadAnalyzeFunction();
  const request = analyzeFunction._test.buildAiRequest({
    endpoint: '/v1/responses',
    model: 'gpt-5.5',
    stream: true
  }, 'data:image/jpeg;base64,aW1hZ2U=', 12);

  assert.equal(request.stream, true);
  assert.equal(request.payload.stream, true);
});

test('cloud function extracts JSON text from responses API payloads', () => {
  const analyzeFunction = loadAnalyzeFunction();

  assert.equal(
    analyzeFunction._test.extractAiResponseText('responses', { output_text: '{"items":[]}' }),
    '{"items":[]}'
  );
  assert.equal(
    analyzeFunction._test.extractAiResponseText('responses', {
      output: [
        {
          content: [
            { type: 'output_text', text: '{"items":[{"displayName":"red box"}]}' }
          ]
        }
      ]
    }),
    '{"items":[{"displayName":"red box"}]}'
  );
});

test('cloud function stores AI endpoint details with successful analyze task', async () => {
  const analyzeFunction = loadAnalyzeFunction({
    https: createMockHttps(JSON.stringify({
      output_text: '{"items":[{"displayName":"red box"}]}'
    })),
    localConfig: {
      relays: [
        {
          id: 'responses-test',
          baseUrl: 'https://relay.example.com',
          endpoint: '/v1/responses',
          model: 'gpt-5.5',
          apiKey: 'test-key',
          timeoutMs: 60000
        }
      ]
    }
  });

  await analyzeFunction.main({
    taskId: 'task_endpoint_details',
    imageDataUrl: 'data:image/jpeg;base64,aW1hZ2U=',
    maxItems: 4
  });
  const task = await analyzeFunction.main({ action: 'getTask', taskId: 'task_endpoint_details' });

  assert.equal(task.status, 'success');
  assert.equal(task.aiRequest.endpoint, '/v1/responses');
  assert.equal(task.aiRequest.payloadKind, 'responses');
  assert.equal(task.aiRequest.relayId, 'responses-test');
  assert.equal(task.aiRequest.model, 'gpt-5.5');
  assert.equal(task.aiRequest.timeoutMs, 60000);
  assert.ok(task.aiRequest.durationMs >= 0);
  assert.equal(task.aiRequest.statusCode, 200);
  assert.equal(task.result.items[0].displayName, 'red box');
});

test('cloud function can measure streaming responses without changing final result', async () => {
  const analyzeFunction = loadAnalyzeFunction({
    https: createMockSseHttps([
      JSON.stringify({ type: 'response.output_text.delta', delta: '{"items":[' }),
      JSON.stringify({ type: 'response.output_text.delta', delta: '{"displayName":"streamed box"}]}' })
    ]),
    localConfig: {
      relays: [
        {
          id: 'responses-stream-test',
          baseUrl: 'https://relay.example.com',
          endpoint: '/v1/responses',
          model: 'gpt-5.5',
          apiKey: 'test-key',
          timeoutMs: 60000,
          stream: true
        }
      ]
    }
  });

  await analyzeFunction.main({
    taskId: 'task_stream_details',
    imageDataUrl: 'data:image/jpeg;base64,aW1hZ2U=',
    maxItems: 4
  });
  const task = await analyzeFunction.main({ action: 'getTask', taskId: 'task_stream_details' });

  assert.equal(task.status, 'success');
  assert.equal(task.result.items[0].displayName, 'streamed box');
  assert.equal(task.aiRequest.endpoint, '/v1/responses');
  assert.equal(task.aiRequest.payloadKind, 'responses');
  assert.equal(task.aiRequest.stream, true);
  assert.ok(task.aiRequest.firstChunkMs >= 0);
  assert.equal(task.aiRequest.eventCount, 2);
  assert.equal(task.aiRequest.statusCode, 200);
});

test('cloud function writes streaming recognized item progress while response is still running', async () => {
  const taskUpdates = [];
  const analyzeFunction = loadAnalyzeFunction({
    taskUpdates,
    https: createMockSseHttps([
      JSON.stringify({ type: 'response.output_text.delta', delta: '{"items":[{"displayName":"box"}' }),
      JSON.stringify({ type: 'response.output_text.delta', delta: ',{"displayName":"clip"}]}' })
    ]),
    localConfig: {
      relays: [
        {
          id: 'responses-progress-test',
          baseUrl: 'https://relay.example.com',
          endpoint: '/v1/responses',
          model: 'gpt-5.5',
          apiKey: 'test-key',
          timeoutMs: 60000,
          stream: true
        }
      ]
    }
  });

  await analyzeFunction.main({
    taskId: 'task_stream_progress',
    imageDataUrl: 'data:image/jpeg;base64,aW1hZ2U=',
    maxItems: 4
  });

  const progressCounts = taskUpdates
    .filter((update) => update.id === 'task_stream_progress' && update.data.progress)
    .map((update) => update.data.progress.recognizedItemCount);

  assert.deepEqual(progressCounts, [1, 2]);
});

test('cloud function reports default daily usage status for a new user', async () => {
  const analyzeFunction = loadAnalyzeFunction();

  const result = await withNow(Date.UTC(2026, 4, 29, 16, 30), () => analyzeFunction.main({ action: 'getUsageStatus' }));

  assert.equal(result.status, 'usage');
  assert.equal(result.openid, 'test-openid');
  assert.equal(result.day, '2026-05-30');
  assert.equal(result.usedToday, 0);
  assert.equal(result.dailyAnalyzeLimit, 15);
  assert.equal(result.remainingToday, 15);
  assert.equal(result.analyzeEnabled, true);
  assert.equal(result.blocked, false);
  assert.equal(result.canAnalyze, true);
});

test('cloud function usage status honors ops default quota override', async () => {
  const analyzeFunction = loadAnalyzeFunction({
    collections: {
      ft_ops_config: {
        global: { dailyFreeAnalyzeLimit: 7 }
      }
    }
  });

  const result = await analyzeFunction.main({ action: 'getUsageStatus' });

  assert.equal(result.dailyAnalyzeLimit, 7);
  assert.equal(result.remainingToday, 7);
  assert.equal(result.canAnalyze, true);
});

test('cloud function usage status honors higher user quota override', async () => {
  const analyzeFunction = loadAnalyzeFunction({
    collections: {
      ft_user_quota_overrides: {
        'test-openid': { dailyAnalyzeLimit: 20 }
      }
    }
  });

  const result = await analyzeFunction.main({ action: 'getUsageStatus' });

  assert.equal(result.dailyAnalyzeLimit, 20);
  assert.equal(result.remainingToday, 20);
  assert.equal(result.canAnalyze, true);
});

test('cloud function usage status honors lower user quota override', async () => {
  const analyzeFunction = loadAnalyzeFunction({
    collections: {
      ft_ops_config: {
        global: { dailyFreeAnalyzeLimit: 15 }
      },
      ft_user_quota_overrides: {
        'test-openid': { dailyAnalyzeLimit: 3 }
      }
    }
  });

  const result = await analyzeFunction.main({ action: 'getUsageStatus' });

  assert.equal(result.dailyAnalyzeLimit, 3);
  assert.equal(result.remainingToday, 3);
  assert.equal(result.canAnalyze, true);
});

test('cloud function usage status honors zero user quota override', async () => {
  const analyzeFunction = loadAnalyzeFunction({
    collections: {
      ft_user_quota_overrides: {
        'test-openid': { dailyAnalyzeLimit: 0 }
      }
    }
  });

  const result = await analyzeFunction.main({ action: 'getUsageStatus' });

  assert.equal(result.dailyAnalyzeLimit, 0);
  assert.equal(result.remainingToday, 0);
  assert.equal(result.canAnalyze, false);
  assert.equal(result.errorCode, 'ANALYZE_QUOTA_EXHAUSTED');
  assert.match(result.errorMessage, /今日/);
});

test('cloud function usage status counts in-flight reserved analyzes against remaining quota', async () => {
  const analyzeFunction = loadAnalyzeFunction({
    collections: {
      ft_user_usage: {
        'test-openid_2026-05-30': {
          successfulAnalyzeCount: 14,
          reservedAnalyzeCount: 1,
          attemptCount: 15
        }
      }
    }
  });

  const result = await withNow(Date.UTC(2026, 4, 29, 17, 0), () => analyzeFunction.main({ action: 'getUsageStatus' }));

  assert.equal(result.usedToday, 14);
  assert.equal(result.reservedToday, 1);
  assert.equal(result.dailyAnalyzeLimit, 15);
  assert.equal(result.remainingToday, 0);
  assert.equal(result.canAnalyze, false);
  assert.equal(result.errorCode, 'ANALYZE_QUOTA_EXHAUSTED');
});

test('cloud function increments successful usage only after AI succeeds', async () => {
  const collections = {};
  const analyzeFunction = loadAnalyzeFunction({
    collections,
    https: createMockHttps(JSON.stringify({
      output_text: '{"items":[{"displayName":"red box"}]}'
    })),
    localConfig: {
      relays: [
        {
          id: 'responses-test',
          baseUrl: 'https://relay.example.com',
          endpoint: '/v1/responses',
          model: 'gpt-5.5',
          apiKey: 'test-key',
          timeoutMs: 60000
        }
      ]
    }
  });

  await withNow(Date.UTC(2026, 4, 29, 17, 0), () => analyzeFunction.main({
    taskId: 'task_success_usage',
    imageDataUrl: 'data:image/jpeg;base64,aW1hZ2U=',
    maxItems: 4
  }));

  assert.equal(collections.ft_user_usage['test-openid_2026-05-30'].successfulAnalyzeCount, 1);
  assert.equal(collections.ft_user_usage['test-openid_2026-05-30'].reservedAnalyzeCount, 0);
  assert.equal(collections.ft_user_usage['test-openid_2026-05-30'].attemptCount, 1);
});

test('cloud function allows the final remaining analyze slot after reserving it', async () => {
  const collections = {
    ft_user_usage: {
      'test-openid_2026-05-30': {
        successfulAnalyzeCount: 14,
        reservedAnalyzeCount: 0,
        attemptCount: 14
      }
    }
  };
  const requests = [];
  const analyzeFunction = loadAnalyzeFunction({
    collections,
    https: createMockHttps(JSON.stringify({
      output_text: '{"items":[{"displayName":"red box"}]}'
    }), { requests }),
    localConfig: {
      relays: [
        {
          id: 'responses-test',
          baseUrl: 'https://relay.example.com',
          endpoint: '/v1/responses',
          model: 'gpt-5.5',
          apiKey: 'test-key',
          timeoutMs: 60000
        }
      ]
    }
  });

  const result = await withNow(Date.UTC(2026, 4, 29, 17, 0), () => analyzeFunction.main({
    taskId: 'task_last_slot',
    imageDataUrl: 'data:image/jpeg;base64,aW1hZ2U=',
    maxItems: 4
  }));

  assert.equal(result.items[0].displayName, 'red box');
  assert.equal(requests.length, 1);
  assert.equal(collections.ft_user_usage['test-openid_2026-05-30'].successfulAnalyzeCount, 15);
  assert.equal(collections.ft_user_usage['test-openid_2026-05-30'].reservedAnalyzeCount, 0);
  assert.equal(collections.ft_user_usage['test-openid_2026-05-30'].attemptCount, 15);
});

test('cloud function does not increment successful usage when AI fails', async () => {
  const collections = {};
  const analyzeFunction = loadAnalyzeFunction({
    collections,
    https: createMockHttps(JSON.stringify({ error: 'bad gateway' }), { statusCode: 502 }),
    localConfig: {
      relays: [
        {
          id: 'responses-test',
          baseUrl: 'https://relay.example.com',
          endpoint: '/v1/responses',
          model: 'gpt-5.5',
          apiKey: 'test-key',
          timeoutMs: 60000
        }
      ]
    }
  });

  await withNow(Date.UTC(2026, 4, 29, 17, 0), () => analyzeFunction.main({
    taskId: 'task_failed_usage',
    imageDataUrl: 'data:image/jpeg;base64,aW1hZ2U=',
    maxItems: 4
  }));

  assert.equal(collections.ft_user_usage['test-openid_2026-05-30'].successfulAnalyzeCount || 0, 0);
  assert.equal(collections.ft_user_usage['test-openid_2026-05-30'].reservedAnalyzeCount, 0);
  assert.equal(collections.ft_user_usage['test-openid_2026-05-30'].attemptCount, 1);
});

test('cloud function rejects quota-exhausted analyze before calling AI', async () => {
  const requests = [];
  const analyzeFunction = loadAnalyzeFunction({
    collections: {
      ft_user_usage: {
        'test-openid_2026-05-30': { successfulAnalyzeCount: 15, attemptCount: 15 }
      }
    },
    https: createMockHttps(JSON.stringify({
      output_text: '{"items":[{"displayName":"red box"}]}'
    }), { requests }),
    localConfig: {
      relays: [
        {
          id: 'responses-test',
          baseUrl: 'https://relay.example.com',
          endpoint: '/v1/responses',
          model: 'gpt-5.5',
          apiKey: 'test-key'
        }
      ]
    }
  });

  const result = await withNow(Date.UTC(2026, 4, 29, 17, 0), () => analyzeFunction.main({
    taskId: 'task_quota_exhausted',
    imageDataUrl: 'data:image/jpeg;base64,aW1hZ2U='
  }));

  assert.equal(result.errorCode, 'ANALYZE_QUOTA_EXHAUSTED');
  assert.equal(requests.length, 0);
});

test('cloud function rejects analyze when global recognition is disabled', async () => {
  const requests = [];
  const analyzeFunction = loadAnalyzeFunction({
    collections: {
      ft_ops_config: {
        global: { analyzeEnabled: false }
      }
    },
    https: createMockHttps(JSON.stringify({
      output_text: '{"items":[{"displayName":"red box"}]}'
    }), { requests }),
    localConfig: {
      relays: [
        {
          id: 'responses-test',
          baseUrl: 'https://relay.example.com',
          endpoint: '/v1/responses',
          model: 'gpt-5.5',
          apiKey: 'test-key'
        }
      ]
    }
  });

  const usage = await analyzeFunction.main({ action: 'getUsageStatus' });
  const result = await analyzeFunction.main({
    taskId: 'task_disabled',
    imageDataUrl: 'data:image/jpeg;base64,aW1hZ2U='
  });

  assert.equal(usage.canAnalyze, false);
  assert.equal(usage.errorCode, 'ANALYZE_DISABLED');
  assert.equal(result.errorCode, 'ANALYZE_DISABLED');
  assert.equal(requests.length, 0);
});

test('cloud function rejects hourly attempt limit before calling AI', async () => {
  const requests = [];
  const baseTime = Date.UTC(2026, 4, 29, 17, 0);
  const analyzeFunction = loadAnalyzeFunction({
    collections: {
      ft_user_usage: {
        'test-openid_2026-05-30': {
          successfulAnalyzeCount: 0,
          attemptCount: 30,
          recentAttemptTimestamps: Array.from({ length: 30 }, (_, index) => baseTime - (index * 60 * 1000))
        }
      }
    },
    https: createMockHttps(JSON.stringify({
      output_text: '{"items":[{"displayName":"red box"}]}'
    }), { requests }),
    localConfig: {
      relays: [
        {
          id: 'responses-test',
          baseUrl: 'https://relay.example.com',
          endpoint: '/v1/responses',
          model: 'gpt-5.5',
          apiKey: 'test-key'
        }
      ]
    }
  });

  const result = await withNow(baseTime, () => analyzeFunction.main({
    taskId: 'task_hourly_limit',
    imageDataUrl: 'data:image/jpeg;base64,aW1hZ2U='
  }));

  assert.equal(result.errorCode, 'ANALYZE_HOURLY_LIMIT');
  assert.equal(requests.length, 0);
});

test('cloud function rejects analyze when usage transaction cannot reserve quota', async () => {
  const requests = [];
  const analyzeFunction = loadAnalyzeFunction({
    runTransaction() {
      return Promise.reject(new Error('transaction unavailable'));
    },
    https: createMockHttps(JSON.stringify({
      output_text: '{"items":[{"displayName":"red box"}]}'
    }), { requests }),
    localConfig: {
      relays: [
        {
          id: 'responses-test',
          baseUrl: 'https://relay.example.com',
          endpoint: '/v1/responses',
          model: 'gpt-5.5',
          apiKey: 'test-key'
        }
      ]
    }
  });

  const result = await analyzeFunction.main({
    taskId: 'task_transaction_failed',
    imageDataUrl: 'data:image/jpeg;base64,aW1hZ2U='
  });

  assert.equal(result.errorCode, 'ANALYZE_USAGE_UPDATE_FAILED');
  assert.equal(requests.length, 0);
});

test('cloud function rejects oversized images before calling AI', async () => {
  const requests = [];
  const tooLargeImage = `data:image/jpeg;base64,${Buffer.alloc((6 * 1024 * 1024) + 1).toString('base64')}`;
  const analyzeFunction = loadAnalyzeFunction({
    https: createMockHttps(JSON.stringify({
      output_text: '{"items":[{"displayName":"red box"}]}'
    }), { requests }),
    localConfig: {
      relays: [
        {
          id: 'responses-test',
          baseUrl: 'https://relay.example.com',
          endpoint: '/v1/responses',
          model: 'gpt-5.5',
          apiKey: 'test-key'
        }
      ]
    }
  });

  const result = await analyzeFunction.main({
    taskId: 'task_oversized',
    imageDataUrl: tooLargeImage
  });

  assert.equal(result.errorCode, 'IMAGE_TOO_LARGE');
  assert.equal(requests.length, 0);
});

test('cloud function cooldown rejects rapid analyze before calling AI', async () => {
  const requests = [];
  const analyzeFunction = loadAnalyzeFunction({
    collections: {
      ft_user_usage: {
        'test-openid_2026-05-30': { successfulAnalyzeCount: 0, attemptCount: 1, lastAttemptAt: Date.UTC(2026, 4, 29, 17, 0, 0) }
      }
    },
    https: createMockHttps(JSON.stringify({
      output_text: '{"items":[{"displayName":"red box"}]}'
    }), { requests }),
    localConfig: {
      relays: [
        {
          id: 'responses-test',
          baseUrl: 'https://relay.example.com',
          endpoint: '/v1/responses',
          model: 'gpt-5.5',
          apiKey: 'test-key'
        }
      ]
    }
  });

  const result = await withNow(Date.UTC(2026, 4, 29, 17, 0, 10), () => analyzeFunction.main({
    taskId: 'task_cooldown',
    imageDataUrl: 'data:image/jpeg;base64,aW1hZ2U='
  }));

  assert.equal(result.errorCode, 'ANALYZE_COOLDOWN');
  assert.equal(requests.length, 0);
});

test('cloud function blocks blacklisted users from usage status and analyze', async () => {
  const requests = [];
  const analyzeFunction = loadAnalyzeFunction({
    collections: {
      ft_abuse_flags: {
        'test-openid': { blocked: true, reason: 'abuse' }
      }
    },
    https: createMockHttps(JSON.stringify({
      output_text: '{"items":[{"displayName":"red box"}]}'
    }), { requests }),
    localConfig: {
      relays: [
        {
          id: 'responses-test',
          baseUrl: 'https://relay.example.com',
          endpoint: '/v1/responses',
          model: 'gpt-5.5',
          apiKey: 'test-key'
        }
      ]
    }
  });

  const usage = await analyzeFunction.main({ action: 'getUsageStatus' });
  const analyze = await analyzeFunction.main({
    taskId: 'task_blocked',
    imageDataUrl: 'data:image/jpeg;base64,aW1hZ2U='
  });

  assert.equal(usage.blocked, true);
  assert.equal(usage.canAnalyze, false);
  assert.equal(usage.errorCode, 'ANALYZE_USER_BLOCKED');
  assert.equal(analyze.errorCode, 'ANALYZE_USER_BLOCKED');
  assert.equal(requests.length, 0);
});

test('cloud function getTask only exposes results to the task owner', async () => {
  const analyzeFunction = loadAnalyzeFunction({
    openid: 'other-openid',
    taskRows: {
      task_owned: {
        status: 'success',
        openid: 'owner-openid',
        result: { items: [{ displayName: 'private item' }] }
      }
    }
  });

  const result = await analyzeFunction.main({ action: 'getTask', taskId: 'task_owned' });

  assert.equal(result.status, 'missing');
  assert.equal(result.result, undefined);
  assert.equal(result.errorCode, undefined);
});

test('cloud function getTask does not expose legacy tasks without an owner openid', async () => {
  const analyzeFunction = loadAnalyzeFunction({
    openid: 'test-openid',
    taskRows: {
      task_legacy_ownerless: {
        status: 'success',
        result: { items: [{ displayName: 'legacy private item' }] }
      }
    }
  });

  const result = await analyzeFunction.main({ action: 'getTask', taskId: 'task_legacy_ownerless' });

  assert.equal(result.status, 'missing');
  assert.equal(result.result, undefined);
});

test('cloud function exposes analyze task polling results', async () => {
  const analyzeFunction = loadAnalyzeFunction({
    taskRows: {
      task_done: {
        status: 'success',
        openid: 'test-openid',
        result: { items: [{ displayName: '钥匙' }] }
      }
    }
  });

  const result = await analyzeFunction.main({ action: 'getTask', taskId: 'task_done' });

  assert.equal(result.status, 'success');
  assert.equal(result.result.items[0].displayName, '钥匙');
});

test('cloud function marks stale processing analyze tasks as timed out during polling', async () => {
  const analyzeFunction = loadAnalyzeFunction({
    taskRows: {
      stale_task: {
        status: 'processing',
        openid: 'test-openid',
        startedAt: 1000,
        updatedAt: 1000
      }
    }
  });

  const result = await withNow(312000, () => analyzeFunction.main({ action: 'getTask', taskId: 'stale_task' }));

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'AI_REQUEST_TIMEOUT');
  assert.equal(result.stale, true);
  assert.match(result.errorMessage, /小懒看得有点久/);
});

test('cloud function maps AI timeout to a user-readable payload', () => {
  const analyzeFunction = loadAnalyzeFunction();
  const payload = analyzeFunction._test.publicError(new Error('AI request timeout'));

  assert.equal(payload.errorCode, 'AI_REQUEST_TIMEOUT');
  assert.equal(payload.items.length, 0);
  assert.match(payload.errorMessage, /小懒看得有点久/);
  assert.match(payload.warnings[0], /小懒看得有点久/);
  assert.doesNotMatch(payload.errorMessage, /AI 识别/);
});

test('cloud function maps self-signed certificate errors to a diagnostic payload', () => {
  const analyzeFunction = loadAnalyzeFunction();
  const error = new Error('self signed certificate');
  error.code = 'DEPTH_ZERO_SELF_SIGNED_CERT';
  const payload = analyzeFunction._test.publicError(error);

  assert.equal(payload.errorCode, 'AI_TLS_CERTIFICATE_INVALID');
  assert.match(payload.errorMessage, /证书/);
});

test('cloud function maps provider certificate chain errors to a diagnostic payload', () => {
  const analyzeFunction = loadAnalyzeFunction();
  const certificateErrorCodes = [
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID'
  ];

  for (const code of certificateErrorCodes) {
    const error = new Error('certificate verification failed');
    error.code = code;
    const payload = analyzeFunction._test.publicError(error);

    assert.equal(payload.errorCode, 'AI_TLS_CERTIFICATE_INVALID');
  }
});

test('cloud function maps refused provider connections to an unreachable service payload', () => {
  const analyzeFunction = loadAnalyzeFunction();
  const error = new Error('connect ECONNREFUSED 154.9.232.80:443');
  error.code = 'ECONNREFUSED';
  const payload = analyzeFunction._test.publicError(error);

  assert.equal(payload.errorCode, 'AI_SERVICE_UNREACHABLE');
  assert.match(payload.errorMessage, /小懒没连上识别服务/);
  assert.doesNotMatch(payload.errorMessage, /AI 识别失败/);
});

test('cloud function maps transient network errors to an unreachable service payload', () => {
  const analyzeFunction = loadAnalyzeFunction();
  const networkErrorCodes = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH'];

  for (const code of networkErrorCodes) {
    const error = new Error('network unavailable');
    error.code = code;
    const payload = analyzeFunction._test.publicError(error);

    assert.equal(payload.errorCode, 'AI_SERVICE_UNREACHABLE');
    assert.match(payload.errorMessage, /识别服务/);
  }
});

test('cloud function can opt in to self-signed compatible provider TLS mode', () => {
  const analyzeFunction = loadAnalyzeFunction();

  withEnv({ OPENAI_COMPAT_TLS_REJECT_UNAUTHORIZED: 'false' }, () => {
    const options = analyzeFunction._test.createPostOptions(
      'https://llmhub.ltd/v1/chat/completions',
      'test-key',
      '{}'
    );
    assert.equal(options.rejectUnauthorized, false);
  });
});

test('cloud function accepts boolean false from local TLS compatibility config', () => {
  const analyzeFunction = loadAnalyzeFunction({
    localConfig: { tlsRejectUnauthorized: false }
  });

  withEnv({ OPENAI_COMPAT_TLS_REJECT_UNAUTHORIZED: undefined }, () => {
    const options = analyzeFunction._test.createPostOptions(
      'https://llmhub.ltd/v1/chat/completions',
      'test-key',
      '{}'
    );
    assert.equal(options.rejectUnauthorized, false);
  });
});
