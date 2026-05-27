const ai = require('../../services/ai');
const imageStore = require('../../services/image-store');
const { createImageMetadata } = require('../../utils/image-metadata');

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
    choosing: false,
    recognizing: false
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
        success: (result) => this.analyze(getChosenPath(result), { chooseResult: result }),
        fail: () => wx.showToast({ title: '已取消选择', icon: 'none' }),
        complete
      });
      return;
    }

    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['camera', 'album'],
      success: (result) => this.analyze(getChosenPath(result), { chooseResult: result }),
      fail: () => wx.showToast({ title: '已取消选择', icon: 'none' }),
      complete
    });
  },

  analyze(imagePath, options) {
    if (!imagePath) return;
    this.setData({ recognizing: true });
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
          fileId: storedPath,
          imageMetadata: createImageMetadata(Object.assign({
            chooseResult: options && options.chooseResult
          }, result && result.imageMetadata || {}))
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
          title: '小懒暂时没看清',
          content: error && error.message ? error.message : '请检查识别服务配置、合法域名和网络后重试。',
          showCancel: false,
          confirmColor: '#1f6048'
        });
      })
      .finally(() => {
        this.setData({ recognizing: false });
      });
  }
});
