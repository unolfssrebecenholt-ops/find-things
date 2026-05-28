const defaultRelays = [
  {
    id: 'primary',
    name: '主通道',
    enabled: true,
    baseUrl: 'https://aipaiai.cn',
    endpoint: '/v1/chat/completions',
    model: 'gpt-5.5',
    timeout: 120000,
    apiKey: ''
  }
];

function loadLocalConfig() {
  try {
    return require('./relay.local');
  } catch (error) {
    return {};
  }
}

function normalizeRelay(relay, index) {
  return {
    id: relay.id || `relay_${index + 1}`,
    name: relay.name || `通道 ${index + 1}`,
    enabled: relay.enabled !== false,
    baseUrl: relay.baseUrl || '',
    endpoint: relay.endpoint || '/v1/chat/completions',
    model: relay.model || 'gpt-5.5',
    timeout: Number(relay.timeout) || 120000,
    apiKey: relay.apiKey || ''
  };
}

function normalizeRelays(relays) {
  const source = Array.isArray(relays) && relays.length ? relays : defaultRelays;
  return source.map(normalizeRelay).filter((relay) => relay.enabled && relay.baseUrl);
}

const localConfig = loadLocalConfig();
const relays = normalizeRelays(localConfig.relays || defaultRelays);

module.exports = {
  relays,
  normalizeRelays
};
