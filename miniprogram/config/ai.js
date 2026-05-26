const defaults = {
  mode: 'real',
  transport: 'direct',
  cloudFunctionName: 'ftAnalyzeImage',
  baseUrl: 'https://aipaiai.cn',
  endpoint: '/v1/chat/completions',
  model: 'gpt-5.5',
  apiKey: '',
  apiKeyStorageKey: 'findThings.aiApiKey',
  baseUrlStorageKey: 'findThings.aiBaseUrl',
  modelStorageKey: 'findThings.aiModel',
  transportStorageKey: 'findThings.aiTransport',
  timeout: 60000,
  maxItems: 16,
  fallbackToMock: false
};

function loadLocalConfig() {
  try {
    return require('./ai.local');
  } catch (error) {
    return {};
  }
}

module.exports = Object.assign({}, defaults, loadLocalConfig());
