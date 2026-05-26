const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_ENDPOINT = '/v1/chat/completions';
const localConfig = loadLocalConfig();
const MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024;

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

function endpointUrl() {
  const baseUrl = env('OPENAI_COMPAT_BASE_URL', 'https://aipaiai.cn', 'baseUrl').replace(/\/+$/, '');
  const endpoint = env('OPENAI_COMPAT_ENDPOINT', DEFAULT_ENDPOINT, 'endpoint');
  return `${baseUrl}${endpoint.charAt(0) === '/' ? endpoint : `/${endpoint}`}`;
}

function buildPrompt(maxItems) {
  return [
    '你是一个储物照片识别助手。请识别照片里对“之后找东西”有价值的具体物品。',
    '返回严格 JSON，不要 Markdown，不要解释。',
    '字段结构：{"items":[{"displayName":"物品名称","category":"类别","features":["关键特征"],"colors":["颜色"],"visibleText":"可见文字","description":"一句自然语言描述，包含位置、外观、用途线索","aliases":["可搜索别名"],"bbox":{"x":0,"y":0,"width":0,"height":0},"confidence":0.8}]}',
    'bbox 必须是相对整张图片的归一化坐标，x/y/width/height 都在 0 到 1 之间，并尽量紧贴物品可见区域。',
    `最多返回 ${maxItems || 16} 个物品。可以合并重复小件，例如多包同类纸巾或多枚钥匙，但要保留明显不同的物品。`,
    '不要把抽屉、墙面、桌面、阴影当作物品。'
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
  const response = await timed('ai_request', () => postJson(url, payload, apiKey), {
    host: new URL(url).host,
    model,
    requestBytes: Buffer.byteLength(JSON.stringify(payload)),
    imageBytes: dataUrlBytes(imageDataUrl),
    maxItems
  });

  return parseJsonPayload(extractMessageContent(response));
}

function postJson(url, payload, apiKey) {
  const body = JSON.stringify(payload);
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = https.request({
      method: 'POST',
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      port: target.port || 443,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const responseText = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`AI request failed with ${response.statusCode}: ${sanitizeErrorBody(responseText)}`);
          error.code = 'AI_REQUEST_FAILED';
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(responseText));
        } catch (error) {
          reject(new Error('AI response is not JSON'));
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(60000, () => {
      request.destroy(new Error('AI request timeout'));
    });
    request.write(body);
    request.end();
  });
}

function sanitizeErrorBody(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9]+/g, 'sk-****')
    .slice(0, 600);
}

exports.main = async (event) => {
  const startedAt = nowMs();
  const maxItems = event && event.maxItems ? Number(event.maxItems) : 16;
  const source = event && event.imageDataUrl
    ? 'imageDataUrl'
    : (event && event.imageFileId ? 'imageFileId' : (event && event.imageUrl ? 'imageUrl' : 'empty'));
  console.log('[ftAnalyzeImage:timing]', { stage: 'start', source, maxItems });

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
};
