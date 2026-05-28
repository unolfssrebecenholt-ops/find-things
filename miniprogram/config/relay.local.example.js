module.exports = {
  relays: [
    {
      id: 'primary',
      name: '主通道',
      enabled: true,
      baseUrl: 'https://aipaiai.cn',
      endpoint: '/v1/chat/completions',
      model: 'gpt-5.5',
      timeout: 120000,
      apiKey: ''
    },
    {
      id: 'backup',
      name: '备用通道',
      enabled: false,
      baseUrl: '',
      endpoint: '/v1/chat/completions',
      model: 'gpt-5.5',
      timeout: 120000,
      apiKey: ''
    }
  ]
};
