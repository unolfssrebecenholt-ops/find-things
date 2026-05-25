const mockAi = require('../../services/mock-ai');

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
        sourceType: ['camera', 'album'],
        success: (result) => this.analyze(getChosenPath(result)),
        fail: () => wx.showToast({ title: '也可以先用 mock demo', icon: 'none' }),
        complete
      });
      return;
    }

    wx.chooseImage({
      count: 1,
      sourceType: ['camera', 'album'],
      success: (result) => this.analyze(getChosenPath(result)),
      fail: () => wx.showToast({ title: '也可以先用 mock demo', icon: 'none' }),
      complete
    });
  },

  useDemo() {
    this.analyze('/assets/mock-container-content.jpg');
  },

  analyze(imagePath) {
    const result = mockAi.analyzeImage({ imagePath });
    wx.setStorageSync('captureDraft', result);
    wx.navigateTo({ url: '/pages/capture/review' });
  }
});
