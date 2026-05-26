const ai = require('../../services/ai');

Page({
  data: {
    apiKey: '',
    baseUrl: '',
    model: '',
    transport: 'direct',
    hasApiKey: false,
    maskedApiKey: ''
  },

  onShow() {
    const settings = ai.getSettingsViewModel();
    this.setData({
      apiKey: '',
      baseUrl: settings.baseUrl,
      model: settings.model,
      transport: settings.transport,
      hasApiKey: settings.hasApiKey,
      maskedApiKey: settings.maskedApiKey
    });
  },

  inputApiKey(event) {
    this.setData({ apiKey: event.detail.value });
  },

  inputBaseUrl(event) {
    this.setData({ baseUrl: event.detail.value });
  },

  inputModel(event) {
    this.setData({ model: event.detail.value });
  },

  useDirect() {
    this.setData({ transport: 'direct' });
  },

  useCloud() {
    this.setData({ transport: 'cloud' });
  },

  saveAiSettings() {
    const settings = {
      baseUrl: this.data.baseUrl,
      model: this.data.model,
      transport: this.data.transport
    };
    if (this.data.apiKey) {
      settings.apiKey = this.data.apiKey;
    }
    ai.saveRuntimeConfig(settings);
    wx.showToast({ title: '已保存 AI 配置', icon: 'success' });
    this.onShow();
  },

  clearApiKey() {
    ai.saveRuntimeConfig({ apiKey: '' });
    wx.showToast({ title: '已清除', icon: 'success' });
    this.onShow();
  }
});
