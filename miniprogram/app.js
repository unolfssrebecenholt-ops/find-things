const cloudConfig = require('./config/cloud');
App({
  globalData: {
    appName: '拍箱找物',
    mockMode: false,
    cloudEnvId: cloudConfig.envId,
    collections: cloudConfig.collections
  },

  onLaunch() {
    const launchedAt = Date.now();
    this.globalData.launchedAt = launchedAt;

    if (typeof wx !== 'undefined' && wx.cloud) {
      try {
        wx.cloud.init({
          env: cloudConfig.envId,
          traceUser: true
        });
      } catch (error) {
        console.warn('cloud init skipped', error);
      }
    }
  }
});
