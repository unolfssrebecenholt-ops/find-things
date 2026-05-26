const aiConfig = require('../config/ai');
const mockAi = require('./mock-ai');
const { normalizeBbox, withDisplayIndexes } = require('../utils/geometry');

function hasWx() {
  return typeof wx !== 'undefined';
}

function mergeConfig(overrides) {
  return Object.assign({}, aiConfig, overrides || {});
}

function getStorageValue(key, fallback) {
  if (!hasWx() || !key) return fallback;
  const value = wx.getStorageSync(key);
  return value === undefined || value === null || value === '' ? fallback : value;
}

function getRuntimeConfig() {
  const config = mergeConfig();
  return mergeConfig({
    apiKey: getStorageValue(config.apiKeyStorageKey, config.apiKey),
    baseUrl: getStorageValue(config.baseUrlStorageKey, config.baseUrl),
    model: getStorageValue(config.modelStorageKey, config.model),
    transport: config.lockTransport ? config.transport : getStorageValue(config.transportStorageKey, config.transport)
  });
}

function saveRuntimeConfig(input) {
  if (!hasWx()) return;
  const config = mergeConfig();
  if (Object.prototype.hasOwnProperty.call(input, 'apiKey')) {
    wx.setStorageSync(config.apiKeyStorageKey, input.apiKey || '');
  }
  if (Object.prototype.hasOwnProperty.call(input, 'baseUrl')) {
    wx.setStorageSync(config.baseUrlStorageKey, input.baseUrl || config.baseUrl);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'model')) {
    wx.setStorageSync(config.modelStorageKey, input.model || config.model);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'transport')) {
    wx.setStorageSync(config.transportStorageKey, input.transport || config.transport);
  }
}

function maskApiKey(apiKey) {
  const value = String(apiKey || '');
  if (!value) return '';
  if (value.length <= 10) return '已配置';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function getSettingsViewModel() {
  const config = getRuntimeConfig();
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    transport: config.transport,
    hasApiKey: !!config.apiKey,
    maskedApiKey: maskApiKey(config.apiKey)
  };
}

function endpointUrl(config) {
  const baseUrl = String(config.baseUrl || '').replace(/\/+$/, '');
  const endpoint = String(config.endpoint || '/v1/chat/completions');
  return `${baseUrl}${endpoint.charAt(0) === '/' ? endpoint : `/${endpoint}`}`;
}

function mimeFromPath(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function readImageAsDataUrl(filePath) {
  if (!hasWx()) {
    return Promise.reject(new Error('当前环境不能读取小程序图片文件'));
  }
  if (/^https?:\/\//.test(filePath)) {
    return Promise.resolve(filePath);
  }
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (result) => resolve(`data:${mimeFromPath(filePath)};base64,${result.data}`),
      fail: () => reject(new Error('读取图片失败，请重新选择图片'))
    });
  });
}

function extensionFromPath(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.webp')) return 'webp';
  if (lower.endsWith('.gif')) return 'gif';
  return 'jpg';
}

function getCloudImageSource(filePath) {
  const value = String(filePath || '');
  if (/^cloud:\/\//.test(value)) {
    return { kind: 'cloud', imageFileId: value };
  }
  if (/^https?:\/\//.test(value)) {
    try {
      const url = new URL(value);
      const localHosts = ['tmp', 'usr', 'localhost', '127.0.0.1'];
      if (localHosts.includes(url.hostname)) {
        return { kind: 'local', filePath: value };
      }
      return { kind: 'remote', imageUrl: value };
    } catch (error) {
      return { kind: 'local', filePath: value };
    }
  }
  return { kind: 'local', filePath: value };
}

function uploadImageForCloudAnalyze(filePath) {
  if (!hasWx() || !wx.cloud || !wx.cloud.uploadFile) {
    return Promise.reject(new Error('当前环境不可上传图片到云存储'));
  }
  const source = getCloudImageSource(filePath);
  if (source.kind === 'cloud') {
    return Promise.resolve({ imageFileId: source.imageFileId });
  }
  if (source.kind === 'remote') {
    return Promise.resolve({ imageUrl: source.imageUrl });
  }
  const cloudPath = `find-things/analyze/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extensionFromPath(filePath)}`;
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath: source.filePath,
      success: (result) => {
        if (result && result.fileID) {
          resolve({ imageFileId: result.fileID });
          return;
        }
        reject(new Error('上传图片到云存储失败'));
      },
      fail: () => reject(new Error('上传图片到云存储失败，请检查云环境和网络'))
    });
  });
}

function buildVisionPrompt(maxItems) {
  return [
    '你是一个储物照片识别助手。请识别照片里对“之后找东西”有价值的具体物品。',
    '返回严格 JSON，不要 Markdown，不要解释。',
    '字段结构：{"items":[{"displayName":"物品名称","category":"类别","features":["关键特征"],"colors":["颜色"],"visibleText":"可见文字","description":"一句自然语言描述，包含位置、外观、用途线索","aliases":["可搜索别名"],"bbox":{"x":0,"y":0,"width":0,"height":0},"confidence":0.8}]}',
    'bbox 必须是相对整张图片的归一化坐标，x/y/width/height 都在 0 到 1 之间，并尽量紧贴物品可见区域。',
    `最多返回 ${maxItems || 16} 个物品。可以合并重复小件，例如多包同类纸巾或多枚钥匙，但要保留明显不同的物品。`,
    '不要把抽屉、墙面、桌面、阴影当作物品。遮挡严重但可辨认的物品可以返回，置信度降低。'
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

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  return String(value).split(/[、,，;；\s]+/).filter(Boolean);
}

function normalizeReturnedBbox(rawBbox) {
  if (!rawBbox) return null;
  const bbox = rawBbox || {};
  let normalized = null;
  if (Number.isFinite(Number(bbox.x)) || Number.isFinite(Number(bbox.width))) {
    const values = {
      x: Number(bbox.x),
      y: Number(bbox.y),
      width: Number(bbox.width),
      height: Number(bbox.height)
    };
    const looksPercent = [values.x, values.y, values.width, values.height].some((value) => value > 1 && value <= 100);
    if (looksPercent) {
      normalized = normalizeBbox({
        x: values.x / 100,
        y: values.y / 100,
        width: values.width / 100,
        height: values.height / 100
      });
    } else {
      normalized = normalizeBbox(values);
    }
  }

  const left = Number(bbox.left);
  const top = Number(bbox.top);
  const right = Number(bbox.right);
  const bottom = Number(bbox.bottom);
  if (!normalized && [left, top, right, bottom].every(Number.isFinite)) {
    const divisor = [left, top, right, bottom].some((value) => value > 1 && value <= 100) ? 100 : 1;
    normalized = normalizeBbox({
      x: left / divisor,
      y: top / divisor,
      width: (right - left) / divisor,
      height: (bottom - top) / divisor
    });
  }

  if (!normalized || !normalized.width || !normalized.height) return null;
  return normalized;
}

function normalizeAiItem(item, index) {
  const displayName = String(item.displayName || item.name || item.objectName || `物品 ${index + 1}`).trim();
  const features = toArray(item.features || item.feature || item.traits);
  const colors = toArray(item.colors || item.color);
  const aliases = toArray(item.aliases || item.keywords || item.searchTerms);
  const description = String(item.description || item.desc || features.join('，') || displayName).trim();
  return {
    tempId: item.tempId || `ai_${Date.now()}_${index + 1}`,
    displayName,
    aiName: String(item.aiName || item.name || displayName).trim(),
    category: String(item.category || item.type || 'other').trim(),
    features,
    colors,
    visibleText: String(item.visibleText || item.text || '').trim(),
    description,
    aliases,
    bbox: normalizeReturnedBbox(item.bbox || item.box || item.boundingBox),
    confidence: Math.max(0, Math.min(1, Number(item.confidence || item.score || 0.72))),
    uncertaintyReason: String(item.uncertaintyReason || item.uncertainReason || '').trim(),
    confirmed: item.confirmed !== false,
    note: ''
  };
}

function normalizeAiPayload(payload, imagePath) {
  const sourceItems = Array.isArray(payload) ? payload : (payload && payload.items) || [];
  const items = sourceItems.map(normalizeAiItem).filter((item) => item.displayName);
  const sourceImage = payload && payload.__sourceImage;
  const storedImagePath = sourceImage && (sourceImage.imageFileId || sourceImage.imageUrl);
  return {
    imagePath: storedImagePath || imagePath,
    localImagePath: storedImagePath && storedImagePath !== imagePath ? imagePath : '',
    items: withDisplayIndexes(items),
    warnings: payload && payload.warnings ? payload.warnings : [],
    usedMock: false,
    aiProvider: 'gpt-5.5'
  };
}

function requestOpenAiCompatible(config, imageDataUrl) {
  if (!config.apiKey) {
    return Promise.reject(new Error('未配置 AI API Key'));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: endpointUrl(config),
      method: 'POST',
      timeout: config.timeout || 60000,
      header: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      data: {
        model: config.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: buildVisionPrompt(config.maxItems) },
              { type: 'image_url', image_url: { url: imageDataUrl } }
            ]
          }
        ]
      },
      success: (result) => {
        if (result.statusCode < 200 || result.statusCode >= 300) {
          reject(new Error(`AI 接口返回 ${result.statusCode}`));
          return;
        }
        try {
          resolve(parseJsonPayload(extractMessageContent(result.data)));
        } catch (error) {
          reject(new Error('AI 返回内容不是可解析 JSON'));
        }
      },
      fail: () => reject(new Error('AI 请求失败，请检查网络和域名配置'))
    });
  });
}

function callCloudAnalyze(config, imagePath) {
  if (!hasWx() || !wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(new Error('当前环境不可调用云函数'));
  }
  return uploadImageForCloudAnalyze(imagePath).then((imageInput) => {
    const data = Object.assign({ maxItems: config.maxItems }, imageInput);
    return wx.cloud.callFunction({
      name: config.cloudFunctionName,
      data
    }).then((result) => {
      const payload = result && result.result;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        return Object.assign({}, payload, { __sourceImage: imageInput });
      }
      return { items: Array.isArray(payload) ? payload : [], __sourceImage: imageInput };
    });
  });
}

function fallbackAnalyze(imagePath, reason) {
  const result = mockAi.analyzeImage({ imagePath });
  return Object.assign({}, result, {
    usedMock: true,
    aiErrorMessage: reason,
    aiProvider: 'mock',
    warnings: [`${reason}，已使用本地 mock 识别结果。`].concat(result.warnings || [])
  });
}

function analyzeImage(options) {
  const imagePath = options && options.imagePath ? options.imagePath : '';
  const config = getRuntimeConfig();
  if ((options && options.forceMock) || config.mode === 'mock') {
    return Promise.resolve(fallbackAnalyze(imagePath, '当前为 mock 模式'));
  }
  const allowMockFallback = !(options && options.allowMockFallback === false) && config.fallbackToMock;

  const run = config.transport === 'cloud'
    ? callCloudAnalyze(config, imagePath)
    : readImageAsDataUrl(imagePath)
      .then((imageDataUrl) => requestOpenAiCompatible(config, imageDataUrl));

  return run
    .then((payload) => normalizeAiPayload(payload, imagePath))
    .catch((error) => {
      if (!allowMockFallback) throw error;
      return fallbackAnalyze(imagePath, error.message || 'AI 识别不可用');
    });
}

module.exports = {
  analyzeImage,
  buildVisionPrompt,
  getRuntimeConfig,
  saveRuntimeConfig,
  getSettingsViewModel,
  normalizeAiPayload,
  normalizeAiItem,
  parseJsonPayload,
  getCloudImageSource
};
