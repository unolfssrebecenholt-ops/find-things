const defaults = {
  mode: 'real',
  transport: 'cloud',
  lockTransport: true,
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
  maxItems: 12,
  fallbackToMock: false
};

module.exports = defaults;
