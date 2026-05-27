const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_ENDPOINT = '/v1/chat/completions';
const localConfig = loadLocalConfig();
const MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ITEMS = 12;
const MAX_ITEMS_LIMIT = 16;
const DEFAULT_FUNCTION_TIMEOUT_MS = 120000;
const FUNCTION_TIMEOUT_HEADROOM_MS = 15000;
const MIN_AI_REQUEST_TIMEOUT_MS = 5000;
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

function dataUrlBytes(dataUrl) {
  const match = String(dataUrl || '').match(/^data:[^;]+;base64,(.*)$/);
  if (!match) return Buffer.byteLength(String(dataUrl || ''));
  return Math.floor(match[1].length * 3 / 4);
}

function logTiming(stage, startedAt, extra) {
  console.log('[ftAnalyzeImage:timing]', Object.assign({
    stage,
    durationMs: nowMs() - startedAt
  }, extra || {}));
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
  const defaultTimeoutMs = Math.max(MIN_AI_REQUEST_TIMEOUT_MS, functionTimeoutMs - FUNCTION_TIMEOUT_HEADROOM_MS);
  return boundedInteger(
    env('OPENAI_COMPAT_TIMEOUT_MS', defaultTimeoutMs, 'timeoutMs'),
    defaultTimeoutMs,
    MIN_AI_REQUEST_TIMEOUT_MS,
    defaultTimeoutMs
  );
}

function endpointUrl() {
  const baseUrl = env('OPENAI_COMPAT_BASE_URL', 'https://aipaiai.cn', 'baseUrl').replace(/\/+$/, '');
  const endpoint = env('OPENAI_COMPAT_ENDPOINT', DEFAULT_ENDPOINT, 'endpoint');
  return `${baseUrl}${endpoint.charAt(0) === '/' ? endpoint : `/${endpoint}`}`;
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

async function callAi(imageDataUrl, maxItems) {
  const apiKey = env('OPENAI_COMPAT_API_KEY', '', 'apiKey');
  if (!apiKey) {
    const error = new Error('OPENAI_COMPAT_API_KEY is not configured');
    error.code = 'AI_KEY_MISSING';
    throw error;
  }

  const model = env('OPENAI_COMPAT_MODEL', 'gpt-5.5', 'model');
  const url = endpointUrl();
  const payload = {
    model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(maxItems) },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      }
    ]
  };
  const timeoutMs = aiRequestTimeoutMs();
  const response = await timed('ai_request', () => postJson(url, payload, apiKey, timeoutMs), {
    host: new URL(url).host,
    model,
    requestBytes: Buffer.byteLength(JSON.stringify(payload)),
    imageBytes: dataUrlBytes(imageDataUrl),
    maxItems,
    timeoutMs
  });

  return parseJsonPayload(extractMessageContent(response));
}

function postJson(url, payload, apiKey, timeoutMs) {
  const body = JSON.stringify(payload);
  const effectiveTimeoutMs = timeoutMs || aiRequestTimeoutMs();
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
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
    const deadlineTimer = setTimeout(() => {
      const error = createTimeoutError();
      if (request) {
        request.destroy(error);
      }
      finish(() => reject(error));
    }, effectiveTimeoutMs);

    request = https.request(createPostOptions(url, apiKey, body), (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const responseText = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`AI request failed with ${response.statusCode}: ${sanitizeErrorBody(responseText)}`);
          error.code = 'AI_REQUEST_FAILED';
          finish(() => reject(error));
          return;
        }
        try {
          finish(() => resolve(JSON.parse(responseText)));
        } catch (error) {
          finish(() => reject(new Error('AI response is not JSON')));
        }
      });
    });
    request.on('error', (error) => finish(() => reject(error)));
    request.setTimeout(effectiveTimeoutMs, () => {
      request.destroy(createTimeoutError());
    });
    request.write(body);
    request.end();
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
  const startedAt = nowMs();
  const maxItems = normalizeMaxItems(event && event.maxItems);
  const source = event && event.imageDataUrl
    ? 'imageDataUrl'
    : (event && event.imageFileId ? 'imageFileId' : (event && event.imageUrl ? 'imageUrl' : 'empty'));
  console.log('[ftAnalyzeImage:timing]', { stage: 'start', source, maxItems });

  try {
    const imageDataUrl = event.imageDataUrl
      || (event.imageFileId ? await timed('load_image', () => imageFileIdToDataUrl(event.imageFileId), { source }) : '')
      || (event.imageUrl ? await timed('load_image', () => remoteImageToDataUrl(event.imageUrl), { source }) : '');
    if (!imageDataUrl) {
      return { items: [], warnings: ['没有收到可识别图片。'] };
    }
    const result = await callAi(imageDataUrl, maxItems);
    logTiming('total', startedAt, {
      source,
      itemCount: result && Array.isArray(result.items) ? result.items.length : 0
    });
    return result;
  } catch (error) {
    console.error('[ftAnalyzeImage:error]', {
      code: error && error.code,
      message: error && error.message ? error.message : String(error)
    });
    return publicError(error);
  }
};

exports._test = {
  aiRequestTimeoutMs,
  normalizeMaxItems,
  buildPrompt,
  createPostOptions,
  publicError
};
