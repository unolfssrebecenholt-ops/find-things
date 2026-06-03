const ai = require('../../services/ai');
const imageStore = require('../../services/image-store');
const { createImageMetadata } = require('../../utils/image-metadata');
const privacy = require('../../utils/privacy');

function getChosenPath(result) {
  if (result && result.tempFiles && result.tempFiles[0]) {
    return result.tempFiles[0].tempFilePath;
  }
  if (result && result.tempFilePaths && result.tempFilePaths[0]) {
    return result.tempFilePaths[0];
  }
  return '';
}

function createUsageLimitMessage(status) {
  const message = status && status.errorMessage ? status.errorMessage : '今日识别次数已用完，请明天再试';
  const remaining = Number(status && status.remainingToday);
  const limit = Number(status && status.dailyAnalyzeLimit);
  if (Number.isFinite(remaining) && Number.isFinite(limit)) {
    return `${message}\n今日剩余 ${remaining}/${limit} 次`;
  }
  return message;
}

function showUsageLimit(status) {
  wx.showModal({
    title: status && status.errorCode === 'ANALYZE_DISABLED'
      ? '识别暂时不可用'
      : (status && status.blocked ? '账号暂时不可用' : '今日识别次数已用完'),
    content: createUsageLimitMessage(status),
    showCancel: false,
    confirmColor: '#1f6048'
  });
}

Page({
  data: {
    choosing: false,
    recognizing: false,
    recognizingDescText: '小懒正在认真扒拉照片，稍等一下下。',
    recognizingHintText: '这会儿适合眨眨眼，别和小懒一起紧张。',
    recognizingProgressCount: 0,
    recognizingProgressText: '正在找线索',
    recognizingProgressStateText: '快啦'
  },

  chooseImage() {
    this.setData({ choosing: true });
    const complete = () => this.setData({ choosing: false });
    const openPicker = () => {

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
    };

    Promise.resolve()
      .then(() => ai.getUsageStatus())
      .then((status) => {
        if (status && status.canAnalyze === false) {
          complete();
          showUsageLimit(status);
          return;
        }
        privacy.guardPrivateAction(wx, this, openPicker).then((result) => {
          if (!result || !result.authorized) complete();
        });
      })
      .catch(() => {
        privacy.guardPrivateAction(wx, this, openPicker).then((result) => {
          if (!result || !result.authorized) complete();
        });
      });
  },

  analyze(imagePath, options) {
    if (!imagePath) return;
    this.setData({
      recognizing: true,
      recognizingDescText: '小懒正在认真扒拉照片，稍等一下下。',
      recognizingHintText: '这会儿适合眨眨眼，别和小懒一起紧张。',
      recognizingProgressCount: 0,
      recognizingProgressText: '正在找线索',
      recognizingProgressStateText: '快啦'
    });
    const handleProgress = (progress) => {
      const count = Number(progress && progress.recognizedItemCount) || 0;
      if (count > 0) {
        console.log('[ftAnalyzeImage:page_progress]', {
          recognizedItemCount: count
        });
        this.setData({
          recognizingDescText: `小懒已经认出来 ${count} 件物品了。`,
          recognizingHintText: `小懒已经认出来 ${count} 件物品了，正在继续扒拉细节。`,
          recognizingProgressCount: count,
          recognizingProgressText: `已认出 ${count} 件`,
          recognizingProgressStateText: `${count} 件`
        });
      }
    };
    const persistOriginal = imageStore.persistImage(imagePath, 'find-things/content');
    const persistThumbnail = imageStore.persistThumbnail(imagePath, 'find-things/thumbs');
    const analyzePrepared = imageStore.prepareImageForAnalyze(imagePath)
      .then((analyzePath) => ai.analyzeImage(Object.assign({
        imagePath: analyzePath,
        allowMockFallback: false,
        onProgress: handleProgress
      }, options || {})));

    Promise.all([persistOriginal, persistThumbnail, analyzePrepared])
      .then(([storedPath, thumbPath, result]) => {
        return Object.assign({}, result, {
          imagePath: storedPath,
          fileId: storedPath,
          thumbFileId: thumbPath || '',
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
