const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_ENDPOINT = '/v1/chat/completions';
const localConfig = loadLocalConfig();
const ANALYZE_TASK_COLLECTION = 'ft_analyze_tasks';
const MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ITEMS = 12;
const MAX_ITEMS_LIMIT = 16;
const DEFAULT_FUNCTION_TIMEOUT_MS = 300000;
const FUNCTION_TIMEOUT_HEADROOM_MS = 15000;
const DEFAULT_AI_REQUEST_TIMEOUT_MS = 120000;
const MIN_AI_REQUEST_TIMEOUT_MS = 5000;
const STALE_TASK_GRACE_MS = 10000;
const AI_RESPONSE_META = Symbol('aiResponseMeta');
const TLS_CERTIFICATE_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID'
]);
const NETWORK_UNREACHABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ECONNABORTED',
  'EPIPE'
]);

function nowMs() {
  return Date.now();
}

function createTaskId() {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getWxContext() {
  if (typeof cloud.getWXContext !== 'function') return {};
  try {
    return cloud.getWXContext() || {};
  } catch (error) {
    return {};
  }
}

function taskCollection() {
  try {
    return cloud.database().collection(ANALYZE_TASK_COLLECTION);
  } catch (error) {
    return null;
  }
}

async function writeTask(taskId, data) {
  if (!taskId) return;
  const collection = taskCollection();
  if (!collection) return;
  const context = getWxContext();
  const payload = Object.assign({
    updatedAt: nowMs(),
    openid: context.OPENID || ''
  }, data || {});
  try {
    await collection.doc(taskId).set({ data: payload });
    logInfo('识别任务状态已写入数据库', {
      taskId,
      status: payload.status,
      hasResult: !!payload.result,
      hasError: !!payload.errorCode,
      aiRequest: payload.aiRequest || null
    });
  } catch (error) {
    logWarn('识别任务状态写入失败', {
      taskId,
      status: payload.status,
      errorMessage: error && error.message ? error.message : String(error)
    });
  }
}

async function updateTaskProgress(taskId, progress) {
  if (!taskId || !progress) return;
  const collection = taskCollection();
  if (!collection) return;
  const payload = {
    updatedAt: nowMs(),
    progress
  };
  try {
    await collection.doc(taskId).update({ data: payload });
    logInfo('识别任务进度已写入数据库', {
      taskId,
      progress
    });
  } catch (error) {
    logWarn('识别任务进度写入失败', {
      taskId,
      errorMessage: error && error.message ? error.message : String(error)
    });
  }
}

async function readTask(taskId) {
  const collection = taskCollection();
  if (!taskId || !collection) {
    return { status: 'missing' };
  }
  try {
    const result = await collection.doc(taskId).get();
    const data = result && result.data;
    if (!data) return { status: 'pending', taskId };
    return Object.assign({ taskId }, data);
  } catch (error) {
    return { status: 'pending', taskId };
  }
}

async function resolveTaskForClient(taskId) {
  const task = await readTask(taskId);
  if (!task || task.status !== 'processing') return task;

  const startedAt = Number(task.startedAt) || Number(task.updatedAt) || 0;
  if (!startedAt || nowMs() - startedAt < staleTaskMs()) return task;

  const timeoutPayload = publicError(new Error('AI request timeout'));
  const failedTask = Object.assign({}, task, timeoutPayload, {
    status: 'failed',
    finishedAt: nowMs(),
    stale: true
  });
  await writeTask(taskId, failedTask);
  logWarn('识别任务已超过函数预算，轮询时自动标记失败', {
    taskId,
    ageMs: nowMs() - startedAt,
    staleTaskMs: staleTaskMs()
  });
  return failedTask;
}

function dataUrlBytes(dataUrl) {
  const match = String(dataUrl || '').match(/^data:[^;]+;base64,(.*)$/);
  if (!match) return Buffer.byteLength(String(dataUrl || ''));
  return Math.floor(match[1].length * 3 / 4);
}

function summarizeAiRequest(meta) {
  const source = meta || {};
  return {
    relayId: source.relayId || '',
    relayName: source.relayName || '',
    host: source.host || '',
    endpoint: source.endpoint || '',
    payloadKind: source.payloadKind || '',
    model: source.model || '',
    timeoutMs: source.timeoutMs || 0,
    requestBytes: source.requestBytes || 0,
    imageBytes: source.imageBytes || 0,
    maxItems: source.maxItems || 0,
    stream: source.stream === true,
    firstChunkMs: source.stream === true && source.firstChunkMs != null ? source.firstChunkMs : null,
    eventCount: source.stream === true ? source.eventCount || 0 : 0,
    durationMs: source.durationMs || 0,
    statusCode: source.statusCode || 0,
    responseBytes: source.responseBytes || 0,
    responseItemCount: source.responseItemCount == null ? null : source.responseItemCount
  };
}

function logTiming(stage, startedAt, extra) {
  console.log('[ftAnalyzeImage:timing]', Object.assign({
    stage,
    durationMs: nowMs() - startedAt
  }, extra || {}));
}

function logInfo(message, extra) {
  console.log('[ftAnalyzeImage:信息]', Object.assign({ message }, extra || {}));
}

function logWarn(message, extra) {
  console.warn('[ftAnalyzeImage:警告]', Object.assign({ message }, extra || {}));
}

async function timed(stage, fn, extra) {
  const startedAt = nowMs();
  try {
    const result = await fn();
    logTiming(stage, startedAt, extra);
    return result;
  } catch (error) {
    logTiming(stage, startedAt, Object.assign({
      error: error && error.message ? error.message : String(error)
    }, extra || {}));
    throw error;
  }
}

function loadLocalConfig() {
  try {
    return require('./local.config');
  } catch (error) {
    return {};
  }
}

function env(name, fallback, localKey) {
  return process.env[name] || localConfig[localKey || name] || fallback || '';
}

function configValue(name, fallback, localKey) {
  if (Object.prototype.hasOwnProperty.call(process.env, name)) {
    return process.env[name];
  }
  const key = localKey || name;
  if (Object.prototype.hasOwnProperty.call(localConfig, key)) {
    return localConfig[key];
  }
  return fallback;
}

function isFalseValue(value) {
  return /^(false|0|no)$/i.test(String(value).trim());
}

function isTrueValue(value) {
  return /^(true|1|yes)$/i.test(String(value).trim());
}

function tlsRejectUnauthorized() {
  return !isFalseValue(configValue('OPENAI_COMPAT_TLS_REJECT_UNAUTHORIZED', 'true', 'tlsRejectUnauthorized'));
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(number, maximum));
}

function normalizeMaxItems(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) return DEFAULT_MAX_ITEMS;
  return Math.min(number, MAX_ITEMS_LIMIT);
}

function aiRequestTimeoutMs() {
  const functionTimeoutMs = boundedInteger(
    env('FUNCTION_TIMEOUT_MS', DEFAULT_FUNCTION_TIMEOUT_MS, 'functionTimeoutMs'),
    DEFAULT_FUNCTION_TIMEOUT_MS,
    FUNCTION_TIMEOUT_HEADROOM_MS + MIN_AI_REQUEST_TIMEOUT_MS,
    300000
  );
  const functionBudgetMs = Math.max(MIN_AI_REQUEST_TIMEOUT_MS, functionTimeoutMs - FUNCTION_TIMEOUT_HEADROOM_MS);
  const defaultTimeoutMs = Math.min(DEFAULT_AI_REQUEST_TIMEOUT_MS, functionBudgetMs);
  return boundedInteger(
    env('OPENAI_COMPAT_TIMEOUT_MS', defaultTimeoutMs, 'timeoutMs'),
    defaultTimeoutMs,
    MIN_AI_REQUEST_TIMEOUT_MS,
    defaultTimeoutMs
  );
}

function configuredFunctionTimeoutMs() {
  return boundedInteger(
    env('FUNCTION_TIMEOUT_MS', DEFAULT_FUNCTION_TIMEOUT_MS, 'functionTimeoutMs'),
    DEFAULT_FUNCTION_TIMEOUT_MS,
    FUNCTION_TIMEOUT_HEADROOM_MS + MIN_AI_REQUEST_TIMEOUT_MS,
    300000
  );
}

function staleTaskMs() {
  const fallback = configuredFunctionTimeoutMs() + STALE_TASK_GRACE_MS;
  return boundedInteger(
    env('ANALYZE_TASK_STALE_MS', fallback, 'analyzeTaskStaleMs'),
    fallback,
    MIN_AI_REQUEST_TIMEOUT_MS,
    360000
  );
}

function endpointUrl() {
  const baseUrl = env('OPENAI_COMPAT_BASE_URL', 'https://aipaiai.cn', 'baseUrl').replace(/\/+$/, '');
  const endpoint = env('OPENAI_COMPAT_ENDPOINT', DEFAULT_ENDPOINT, 'endpoint');
  return `${baseUrl}${endpoint.charAt(0) === '/' ? endpoint : `/${endpoint}`}`;
}

function normalizeRelay(relay, index) {
  return {
    id: relay.id || `relay_${index + 1}`,
    name: relay.name || `通道 ${index + 1}`,
    enabled: relay.enabled !== false,
    baseUrl: relay.baseUrl || '',
    endpoint: relay.endpoint || DEFAULT_ENDPOINT,
    model: relay.model || env('OPENAI_COMPAT_MODEL', 'gpt-5.5', 'model'),
    apiKey: relay.apiKey || '',
    timeoutMs: boundedInteger(relay.timeoutMs || relay.timeout, aiRequestTimeoutMs(), MIN_AI_REQUEST_TIMEOUT_MS, aiRequestTimeoutMs()),
    stream: relay.stream === true || isTrueValue(relay.stream)
  };
}

function parseEnvRelays() {
  const raw = process.env.OPENAI_COMPAT_RELAYS || '';
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[ftAnalyzeImage:relay_config]', { message: 'OPENAI_COMPAT_RELAYS is not valid JSON' });
    return [];
  }
}

function getRelays() {
  const configured = parseEnvRelays().concat(Array.isArray(localConfig.relays) ? localConfig.relays : []);
  const fallback = [{
    id: 'primary',
    name: '主通道',
    baseUrl: env('OPENAI_COMPAT_BASE_URL', 'https://aipaiai.cn', 'baseUrl'),
    endpoint: env('OPENAI_COMPAT_ENDPOINT', DEFAULT_ENDPOINT, 'endpoint'),
    model: env('OPENAI_COMPAT_MODEL', 'gpt-5.5', 'model'),
    apiKey: env('OPENAI_COMPAT_API_KEY', '', 'apiKey'),
    timeoutMs: aiRequestTimeoutMs()
  }];
  return (configured.length ? configured : fallback)
    .map(normalizeRelay)
    .filter((relay) => relay.enabled && relay.baseUrl);
}

function relayEndpointUrl(relay) {
  const baseUrl = String(relay.baseUrl || '').replace(/\/+$/, '');
  const endpoint = relay.endpoint || DEFAULT_ENDPOINT;
  return `${baseUrl}${endpoint.charAt(0) === '/' ? endpoint : `/${endpoint}`}`;
}

function relayPayloadKind(relay) {
  const endpoint = String(relay && relay.endpoint || DEFAULT_ENDPOINT).toLowerCase();
  return endpoint.indexOf('/responses') >= 0 ? 'responses' : 'chat_completions';
}

function shouldStreamRelay(relay) {
  return relay && relay.stream === true;
}

function relayLogSummary(relay) {
  let host = '';
  try {
    host = new URL(relayEndpointUrl(relay)).host;
  } catch (error) {
    host = 'invalid-url';
  }
  return {
    relayId: relay.id,
    relayName: relay.name,
    host,
    endpoint: relay.endpoint,
    model: relay.model,
    timeoutMs: relay.timeoutMs,
    hasApiKey: !!relay.apiKey
  };
}

function buildPrompt(maxItems) {
  return [
    '你是一个储物照片识别助手。目标是尽量完整盘点主收纳容器内部的可搜索物品，容器可能是抽屉、箱子、收纳袋、柜格或其他储物空间。',
    '返回严格 JSON，不要 Markdown，不要解释。',
    '字段结构：{"items":[{"displayName":"标题，优先品牌/文字 + 物品类型；无法判断具体名称时用特征描述","brandName":"可见品牌或Logo，没有则空字符串","category":"类别","features":["关键特征"],"colors":["颜色"],"visibleText":"所有可读文字/型号/Logo文字","description":"一句自然语言描述，必须包含大致方位、外观、用途线索","aliases":["可搜索别名"],"inContainer":true,"confidence":0.8}]}',
    '只识别容器内部：先判断主收纳容器的内侧边界；边界外的任何物品、家具、桌面、地面、墙面、人体或背景元素必须设为 inContainer:false 或直接不返回。',
    '请按区域从左上到右下扫描，不要只返回最显眼、最大或最容易识别的物品。',
    '不要把多个物品合成一个条目；每个条目只描述一个独立物品，不要返回一堆杂物、容器边缘、把手或容器本身。',
    '凡是之后可能被用户搜索、取用或盘点的独立实物都算可搜索物品；容器结构、装饰、反光、阴影和背景元素不算。',
    '如果看到品牌、Logo、型号、包装文字，或物体封面上的图标、图案、文字，必须 OCR 并理解其含义：brandName 填可见品牌/Logo，visibleText 填所有可读文字/型号/Logo文字；displayName 优先使用“品牌/文字 + 物品类型”。如果文字/图标完整，尽量识别品牌、系列或商品名；如果不完整，描述可见图标/文字的内容含义，并把可靠结果合理拼接到 displayName。识别不到具体名称时，用主要颜色、材质、形状或用途组成特征描述，同时写入 features。',
    '如果物品展示信息不足以分析出具体物品名或物品类别，不要硬猜；用可见特征 + 简述 + 形状来总结 displayName 标题，并在 description 中说明不确定点。',
    '遮挡或只露出一部分但仍可辨认的物品也要返回；名称不确定时使用“疑似…”或外观描述，并降低 confidence。',
    `最多返回 ${maxItems || 16} 个物品。可以合并高度相似、紧邻且用途相同的重复小件，但要保留明显不同的物品。`,
    '不要把容器、容器边缘、把手、墙面、桌面、地面、阴影当作物品；完全无法辨认的杂乱区域不要返回。'
  ].join('\n');
}

function extractMessageContent(response) {
  const message = response
    && response.choices
    && response.choices[0]
    && response.choices[0].message;
  const content = message && message.content;
  if (Array.isArray(content)) {
    return content.map((part) => part.text || '').join('\n');
  }
  return String(content || '');
}

function extractResponsesContent(response) {
  if (response && typeof response.output_text === 'string') return response.output_text;
  const output = Array.isArray(response && response.output) ? response.output : [];
  return output.flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((part) => part.text || part.output_text || '')
    .join('\n');
}

function extractAiResponseText(payloadKind, response) {
  return payloadKind === 'responses'
    ? extractResponsesContent(response)
    : extractMessageContent(response);
}

function extractStreamTextDelta(payloadKind, event) {
  if (!event || typeof event !== 'object') return '';
  if (typeof event.delta === 'string') return event.delta;
  if (typeof event.output_text === 'string') return event.output_text;
  if (payloadKind === 'responses') {
    const output = Array.isArray(event.output) ? event.output : [];
    const outputText = output.flatMap((item) => Array.isArray(item.content) ? item.content : [])
      .map((part) => part.text || part.output_text || '')
      .join('');
    if (outputText) return outputText;
  }
  const choice = event.choices && event.choices[0];
  const delta = choice && choice.delta;
  if (delta) {
    if (typeof delta.content === 'string') return delta.content;
    if (Array.isArray(delta.content)) {
      return delta.content.map((part) => part.text || '').join('');
    }
  }
  const message = choice && choice.message;
  if (message && typeof message.content === 'string') return message.content;
  return '';
}

function estimateStreamItemCount(text) {
  const matches = String(text || '').match(/"displayName"\s*:/g);
  return matches ? matches.length : 0;
}

function parseSsePayload(text, payloadKind) {
  const events = [];
  const lines = String(text || '').split(/\r?\n/);
  let dataLines = [];
  for (const line of lines) {
    if (!line) {
      if (dataLines.length) {
        events.push(dataLines.join('\n'));
        dataLines = [];
      }
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length) events.push(dataLines.join('\n'));

  let textContent = '';
  let eventCount = 0;
  for (const rawEvent of events) {
    if (!rawEvent || rawEvent === '[DONE]') continue;
    let parsed;
    try {
      parsed = JSON.parse(rawEvent);
    } catch (error) {
      continue;
    }
    eventCount += 1;
    textContent += extractStreamTextDelta(payloadKind, parsed);
  }
  const response = payloadKind === 'responses'
    ? { output_text: textContent }
    : { choices: [{ message: { content: textContent } }] };
  response[AI_RESPONSE_META] = { eventCount };
  return response;
}

function buildAiRequest(relay, imageDataUrl, maxItems) {
  const payloadKind = relayPayloadKind(relay);
  const prompt = buildPrompt(maxItems);
  const stream = shouldStreamRelay(relay);
  const payload = payloadKind === 'responses'
    ? {
        model: relay.model,
        temperature: 0.1,
        text: { format: { type: 'json_object' } },
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: imageDataUrl }
            ]
          }
        ]
      }
    : {
        model: relay.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageDataUrl } }
            ]
          }
        ]
      };
  if (stream) {
    payload.stream = true;
  }
  return {
    payloadKind,
    stream,
    payload,
    requestBytes: Buffer.byteLength(JSON.stringify(payload))
  };
}

function parseJsonPayload(text) {
  const raw = String(text || '').trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(raw);
  } catch (error) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw error;
  }
}

async function imageFileIdToDataUrl(fileID) {
  const result = await cloud.downloadFile({ fileID });
  const buffer = result.fileContent;
  return `data:${mimeFromFileID(fileID)};base64,${buffer.toString('base64')}`;
}

function mimeFromFileID(fileID) {
  const lower = String(fileID || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function remoteImageToDataUrl(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (['tmp', 'usr', 'localhost', '127.0.0.1'].includes(target.hostname)) {
      reject(new Error('received local temp image URL in cloud function; upload it to cloud storage first'));
      return;
    }
    const request = https.request({
      method: 'GET',
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      port: target.port || 443
    }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`download image failed with ${response.statusCode}`));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_REMOTE_IMAGE_BYTES) {
          request.destroy(new Error('image is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const contentType = response.headers['content-type'] || mimeFromFileID(url);
        resolve(`data:${contentType};base64,${Buffer.concat(chunks).toString('base64')}`);
      });
    });
    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error('download image timeout'));
    });
    request.end();
  });
}

async function callAi(imageDataUrl, maxItems, taskId) {
  const relays = getRelays();
  logInfo('准备请求识别中转站', {
    relayCount: relays.length,
    relays: relays.map(relayLogSummary),
    maxItems,
    imageBytes: dataUrlBytes(imageDataUrl)
  });
  if (!relays.some((relay) => relay.apiKey)) {
    const error = new Error('OPENAI_COMPAT_API_KEY is not configured');
    error.code = 'AI_KEY_MISSING';
    throw error;
  }

  const errors = [];
  for (const relay of relays) {
    if (!relay.apiKey) continue;
    const url = relayEndpointUrl(relay);
    const request = buildAiRequest(relay, imageDataUrl, maxItems);
    try {
      logInfo('即将请求中转站', Object.assign(relayLogSummary(relay), {
        payloadKind: request.payloadKind,
        requestBytes: request.requestBytes,
        imageBytes: dataUrlBytes(imageDataUrl),
        maxItems
      }));
      const requestSummary = Object.assign({}, relayLogSummary(relay), {
        taskId,
        payloadKind: request.payloadKind,
        stream: request.stream,
        requestBytes: request.requestBytes,
        imageBytes: dataUrlBytes(imageDataUrl),
        maxItems
      });
      console.log('[ftAnalyzeImage:ai_request_start]', requestSummary);
      const aiStartedAt = nowMs();
      const response = await timed('ai_request', () => postJson(url, request.payload, relay.apiKey, relay.timeoutMs, {
        payloadKind: request.payloadKind,
        stream: request.stream,
        taskId
      }), {
        host: new URL(url).host,
        relayId: relay.id,
        taskId,
        endpoint: relay.endpoint,
        payloadKind: request.payloadKind,
        stream: request.stream,
        model: relay.model,
        requestBytes: request.requestBytes,
        imageBytes: dataUrlBytes(imageDataUrl),
        maxItems,
        timeoutMs: relay.timeoutMs
      });
      const result = parseJsonPayload(extractAiResponseText(request.payloadKind, response));
      const aiRequest = summarizeAiRequest(Object.assign({}, requestSummary, response[AI_RESPONSE_META] || {}, {
        durationMs: nowMs() - aiStartedAt,
        responseItemCount: result && Array.isArray(result.items) ? result.items.length : null
      }));
      logInfo('中转站请求成功，准备解析模型返回', Object.assign(relayLogSummary(relay), {
        payloadKind: request.payloadKind,
        requestBytes: request.requestBytes,
        imageBytes: dataUrlBytes(imageDataUrl),
        maxItems,
        responseItemCount: result && Array.isArray(result.items) ? result.items.length : null
      }));
      console.log('[ftAnalyzeImage:ai_request_summary]', aiRequest);
      return { result, aiRequest };
    } catch (error) {
      errors.push(error);
      logWarn('中转站请求失败，准备尝试下一个可用通道', Object.assign(relayLogSummary(relay), {
        payloadKind: request.payloadKind,
        requestBytes: request.requestBytes,
        imageBytes: dataUrlBytes(imageDataUrl),
        code: error && error.code,
        errorMessage: error && error.message ? error.message : String(error)
      }));
      console.warn('[ftAnalyzeImage:relay_failed]', {
        relayId: relay.id,
        endpoint: relay.endpoint,
        payloadKind: request.payloadKind,
        code: error && error.code,
        message: error && error.message ? error.message : String(error)
      });
    }
  }

  throw errors[errors.length - 1] || new Error('AI request failed');
}

function postJson(url, payload, apiKey, timeoutMs, requestMeta) {
  const body = JSON.stringify(payload);
  const effectiveTimeoutMs = timeoutMs || aiRequestTimeoutMs();
  const meta = requestMeta || {};
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    let firstChunkMs = null;
    let streamText = '';
    let streamEventCount = 0;
    let lastProgressItemCount = 0;
    const requestStartedAt = nowMs();
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      callback();
    };
    const createTimeoutError = () => {
      const error = new Error('AI request timeout');
      error.code = 'AI_REQUEST_TIMEOUT';
      return error;
    };
    const target = new URL(url);
    logInfo('HTTP 请求已创建，准备发送到中转站', {
      host: target.host,
      path: `${target.pathname}${target.search}`,
      payloadKind: meta.payloadKind || '',
      timeoutMs: effectiveTimeoutMs,
      bodyBytes: Buffer.byteLength(body)
    });
    const deadlineTimer = setTimeout(() => {
      const error = createTimeoutError();
      logWarn('中转站请求达到本通道超时时间，主动结束请求', {
        host: target.host,
        payloadKind: meta.payloadKind || '',
        timeoutMs: effectiveTimeoutMs
      });
      if (request) {
        request.destroy(error);
      }
      finish(() => reject(error));
    }, effectiveTimeoutMs);

    request = https.request(createPostOptions(url, apiKey, body), (response) => {
      logInfo('中转站已返回 HTTP 响应头', {
        host: target.host,
        payloadKind: meta.payloadKind || '',
        statusCode: response.statusCode
      });
      const chunks = [];
      let sseBuffer = '';
      const handleStreamEvent = (rawEvent) => {
        if (!rawEvent || rawEvent === '[DONE]') return;
        let parsed;
        try {
          parsed = JSON.parse(rawEvent);
        } catch (error) {
          return;
        }
        streamEventCount += 1;
        streamText += extractStreamTextDelta(meta.payloadKind, parsed);
        const recognizedItemCount = estimateStreamItemCount(streamText);
        if (recognizedItemCount > lastProgressItemCount) {
          lastProgressItemCount = recognizedItemCount;
          updateTaskProgress(meta.taskId, {
            stage: 'ai_stream',
            recognizedItemCount,
            eventCount: streamEventCount
          });
        }
      };
      const handleStreamChunk = (chunkText) => {
        if (!meta.stream) return;
        sseBuffer += chunkText;
        const parts = sseBuffer.split(/\r?\n\r?\n/);
        sseBuffer = parts.pop() || '';
        for (const part of parts) {
          const dataLines = part.split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart());
          if (dataLines.length) {
            handleStreamEvent(dataLines.join('\n'));
          }
        }
      };
      response.on('data', (chunk) => {
        if (firstChunkMs == null) {
          firstChunkMs = nowMs() - requestStartedAt;
        }
        chunks.push(chunk);
        handleStreamChunk(chunk.toString('utf8'));
      });
      response.on('end', () => {
        if (meta.stream && sseBuffer) {
          const dataLines = sseBuffer.split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart());
          if (dataLines.length) {
            handleStreamEvent(dataLines.join('\n'));
          }
        }
        const responseText = Buffer.concat(chunks).toString('utf8');
        logInfo('中转站响应体接收完成', {
          host: target.host,
          payloadKind: meta.payloadKind || '',
          statusCode: response.statusCode,
          responseBytes: Buffer.byteLength(responseText)
        });
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`AI request failed with ${response.statusCode}: ${sanitizeErrorBody(responseText)}`);
          error.code = 'AI_REQUEST_FAILED';
          finish(() => reject(error));
          return;
        }
        try {
          const parsed = meta.stream
            ? parseSsePayload(responseText, meta.payloadKind)
            : JSON.parse(responseText);
          const existingMeta = parsed[AI_RESPONSE_META] || {};
          parsed[AI_RESPONSE_META] = Object.assign({}, existingMeta, {
            stream: meta.stream === true,
            firstChunkMs,
            statusCode: response.statusCode,
            responseBytes: Buffer.byteLength(responseText)
          });
          finish(() => resolve(parsed));
        } catch (error) {
          finish(() => reject(new Error('AI response is not JSON')));
        }
      });
    });
    request.on('error', (error) => {
      logWarn('中转站 HTTP 请求发生错误', {
        host: target.host,
        payloadKind: meta.payloadKind || '',
        code: error && error.code,
        errorMessage: error && error.message ? error.message : String(error)
      });
      finish(() => reject(error));
    });
    request.setTimeout(effectiveTimeoutMs, () => {
      logWarn('底层 socket 达到本通道超时时间', {
        host: target.host,
        payloadKind: meta.payloadKind || '',
        timeoutMs: effectiveTimeoutMs
      });
      request.destroy(createTimeoutError());
    });
    request.write(body);
    request.end();
    logInfo('HTTP 请求体已发送到中转站', {
      host: target.host,
      payloadKind: meta.payloadKind || '',
      bodyBytes: Buffer.byteLength(body)
    });
  });
}

function createPostOptions(url, apiKey, body) {
  const target = new URL(url);
  return {
    method: 'POST',
    hostname: target.hostname,
    path: `${target.pathname}${target.search}`,
    port: target.port || 443,
    rejectUnauthorized: tlsRejectUnauthorized(),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };
}

function sanitizeErrorBody(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9]+/g, 'sk-****')
    .slice(0, 600);
}

function publicError(error) {
  const message = error && error.message ? error.message : String(error || '');
  const rawCode = error && error.code;
  const code = TLS_CERTIFICATE_ERROR_CODES.has(rawCode)
    ? 'AI_TLS_CERTIFICATE_INVALID'
    : (NETWORK_UNREACHABLE_ERROR_CODES.has(rawCode) ? 'AI_SERVICE_UNREACHABLE' : rawCode)
    || (/timeout/i.test(message) ? 'AI_REQUEST_TIMEOUT' : 'AI_ANALYZE_FAILED');
  const friendlyMessages = {
    AI_KEY_MISSING: '小懒还没接上识别服务，请检查云函数环境变量 OPENAI_COMPAT_API_KEY。',
    AI_REQUEST_TIMEOUT: '小懒看得有点久，请换一张更清晰或更小的照片后重试。',
    AI_TLS_CERTIFICATE_INVALID: '小懒没法信任识别服务的证书，请换可信服务地址或配置证书后重试。',
    AI_SERVICE_UNREACHABLE: '小懒没连上识别服务，请稍后重试或检查服务地址。',
    AI_REQUEST_FAILED: '小懒请求识别服务失败，请稍后重试。',
    AI_ANALYZE_FAILED: '小懒暂时没看清，请重试或手动添加物品。'
  };
  const errorMessage = friendlyMessages[code] || friendlyMessages.AI_ANALYZE_FAILED;
  return {
    items: [],
    warnings: [errorMessage],
    errorCode: code,
    errorMessage
  };
}

exports.main = async (event) => {
  if (event && event.action === 'getTask') {
    const task = await resolveTaskForClient(event.taskId);
    logInfo('客户端轮询识别任务', {
      taskId: event.taskId,
      status: task.status,
      hasResult: !!task.result,
      hasError: !!task.errorCode,
      aiRequest: task.aiRequest || null
    });
    return task;
  }

  const startedAt = nowMs();
  const taskId = (event && event.taskId) || createTaskId();
  const maxItems = normalizeMaxItems(event && event.maxItems);
  const source = event && event.imageDataUrl
    ? 'imageDataUrl'
    : (event && event.imageFileId ? 'imageFileId' : (event && event.imageUrl ? 'imageUrl' : 'empty'));
  console.log('[ftAnalyzeImage:timing]', { stage: 'start', source, maxItems, taskId });

  try {
    await writeTask(taskId, {
      status: 'processing',
      source,
      maxItems,
      startedAt
    });
    const imageDataUrl = event.imageDataUrl
      || (event.imageFileId ? await timed('load_image', () => imageFileIdToDataUrl(event.imageFileId), { source }) : '')
      || (event.imageUrl ? await timed('load_image', () => remoteImageToDataUrl(event.imageUrl), { source }) : '');
    if (!imageDataUrl) {
      const emptyResult = { items: [], warnings: ['没有收到可识别图片。'] };
      await writeTask(taskId, {
        status: 'success',
        finishedAt: nowMs(),
        result: emptyResult
      });
      return Object.assign({ taskId }, emptyResult);
    }
    const aiResponse = await callAi(imageDataUrl, maxItems, taskId);
    const result = aiResponse.result;
    const aiRequest = aiResponse.aiRequest;
    await writeTask(taskId, {
      status: 'success',
      finishedAt: nowMs(),
      result,
      aiRequest
    });
    logTiming('total', startedAt, {
      source,
      taskId,
      itemCount: result && Array.isArray(result.items) ? result.items.length : 0,
      aiRequest
    });
    return Object.assign({ taskId }, result);
  } catch (error) {
    console.error('[ftAnalyzeImage:error]', {
      taskId,
      code: error && error.code,
      message: error && error.message ? error.message : String(error)
    });
    const payload = publicError(error);
    await writeTask(taskId, Object.assign({
      status: 'failed',
      finishedAt: nowMs()
    }, payload));
    return Object.assign({ taskId }, payload);
  }
};

exports._test = {
  aiRequestTimeoutMs,
  staleTaskMs,
  normalizeMaxItems,
  buildPrompt,
  buildAiRequest,
  extractAiResponseText,
  estimateStreamItemCount,
  createPostOptions,
  getRelays,
  relayEndpointUrl,
  publicError
};
