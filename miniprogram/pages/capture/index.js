const ai = require('../../services/ai');
const imageStore = require('../../services/image-store');

function getChosenPath(result) {
  if (result && result.tempFiles && result.tempFiles[0]) {
    return result.tempFiles[0].tempFilePath;
  }
  if (result && result.tempFilePaths && result.tempFilePaths[0]) {
    return result.tempFilePaths[0];
  }
  return '';
}

Page({
  data: {
    choosing: false
  },

  chooseImage() {
    this.setData({ choosing: true });
    const complete = () => this.setData({ choosing: false });

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['camera', 'album'],
        success: (result) => this.analyze(getChosenPath(result)),
        fail: () => wx.showToast({ title: '已取消选择', icon: 'none' }),
        complete
      });
      return;
    }

    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['camera', 'album'],
      success: (result) => this.analyze(getChosenPath(result)),
      fail: () => wx.showToast({ title: '已取消选择', icon: 'none' }),
      complete
    });
  },

  analyze(imagePath, options) {
    if (!imagePath) return;
    wx.showLoading({ title: 'AI 识别中' });
    const persistOriginal = imageStore.persistImage(imagePath, 'find-things/content');
    const analyzePrepared = imageStore.prepareImageForAnalyze(imagePath)
      .then((analyzePath) => ai.analyzeImage(Object.assign({
        imagePath: analyzePath,
        allowMockFallback: false
      }, options || {})));

    Promise.all([persistOriginal, analyzePrepared])
      .then(([storedPath, result]) => {
        return Object.assign({}, result, {
          imagePath: storedPath,
          fileId: storedPath
        });
      })
      .then((result) => {
        wx.removeStorageSync('reviewDraft');
        wx.removeStorageSync('containerEditDraft');
        wx.setStorageSync('captureDraft', result);
        wx.navigateTo({ url: '/pages/capture/review' });
      })
      .catch((error) => {
        wx.showModal({
          title: 'AI 识别失败',
          content: error && error.message ? error.message : '请检查接口配置、合法域名和网络后重试。',
          showCancel: false,
          confirmColor: '#4f8f67'
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  }
});
