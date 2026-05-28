const ai = require('../../services/ai');

Page({
  data: {
    model: '',
    transport: 'direct',
    relayCount: 0,
    relayNames: ''
  },

  onShow() {
    const settings = ai.getSettingsViewModel();
    this.setData({
      model: settings.model,
      transport: settings.transport,
      relayCount: settings.relayCount,
      relayNames: settings.relayNames
    });
  }
});
