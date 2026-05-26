const ai = require('../../services/ai');
const imageStore = require('../../services/image-store');
const storage = require('../../services/storage');
const { withDisplayIndexes } = require('../../utils/geometry');

const FREE_CONTENT_IMAGE_LIMIT = storage.FREE_CONTENT_IMAGE_LIMIT || 2;

function getChosenPath(result) {
  if (result && result.tempFiles && result.tempFiles[0]) {
    return result.tempFiles[0].tempFilePath;
  }
  if (result && result.tempFilePaths && result.tempFilePaths[0]) {
    return result.tempFilePaths[0];
  }
  return '';
}

function createImageId(index) {
  return `draft_image_${Date.now()}_${index + 1}`;
}

function createDraftId() {
  return `review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function unique(values) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function createItemViewModel(item) {
  const confidence = Number(item.confidence);
  const featureSummary = (item.features || []).slice(0, 3).join(' / ') || '描述可搜索';
  const fullTagList = unique((item.colors || []).concat(item.features || [], item.aliases || []));
  const tagList = fullTagList.slice(0, 6);
  return Object.assign({}, item, {
    hasTags: tagList.length > 0,
    tagList,
    tagText: fullTagList.join(' '),
    featureSummary,
    displayDescription: item.description || featureSummary || '确认后会保存进这个容器',
    confidenceLabel: confidence ? `${Math.round(confidence * 100)}%` : '待确认'
  });
}

Page({
  data: {
    imagePath: '',
    items: [],
    warnings: [],
    imageDrafts: [],
    currentIndex: 0,
    viewMode: 'summary',
    isSummaryMode: true,
    isEditMode: false,
    showAddPhotoHint: true,
    currentLabel: '照片 1/1',
    showAiWarning: false,
    aiStatusText: '',
    freeLimit: FREE_CONTENT_IMAGE_LIMIT
  },

  onLoad() {
    const draft = wx.getStorageSync('captureDraft') || {
      imagePath: '',
      items: [],
      warnings: ['请先选择一张照片进行识别。']
    };
    const imageDrafts = draft.imageDrafts || [
      this.createImageDraft(draft, 0)
    ];
    this.setData({ imageDrafts });
    this.setCurrentImage(0);
  },

  createImageDraft(draft, index) {
    const imageId = draft.imageId || createImageId(index);
    const fileId = draft.fileId || draft.imagePath || draft.contentImageFileId || '';
    const items = withDisplayIndexes(draft.items || []).map((item) => Object.assign({}, item, {
      sourceImageId: imageId,
      sourceImageFileId: fileId
    }));
    return {
      imageId,
      fileId,
      imagePath: fileId,
      label: `照片 ${index + 1}`,
      sortOrder: index,
      itemCount: items.filter((item) => item.confirmed !== false).length,
      items,
      warnings: draft.warnings || [],
      usedMock: !!draft.usedMock,
      aiErrorMessage: draft.aiErrorMessage || ''
    };
  },

  setCurrentImage(index) {
    const imageDrafts = this.data.imageDrafts || [];
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, imageDrafts.length - 1));
    const draft = imageDrafts[safeIndex] || {};
    const items = withDisplayIndexes(draft.items || []).map(createItemViewModel);
    this.setData({
      currentIndex: safeIndex,
      showAddPhotoHint: imageDrafts.length < FREE_CONTENT_IMAGE_LIMIT,
      currentLabel: `照片 ${safeIndex + 1}/${Math.max(imageDrafts.length, 1)}`,
      imagePath: draft.imagePath || draft.fileId || '',
      items,
      showAiWarning: !!draft.usedMock,
      aiStatusText: draft.usedMock
        ? `AI 未生效：${draft.aiErrorMessage || '已回退到 mock 数据'}`
        : '',
      warnings: draft.warnings || []
    });
  },

  switchImage(event) {
    this.setCurrentImage(event.currentTarget.dataset.index);
  },

  switchViewMode(event) {
    const viewMode = event.currentTarget.dataset.mode || 'summary';
    this.setData({
      viewMode,
      isSummaryMode: viewMode === 'summary',
      isEditMode: viewMode === 'edit'
    });
  },

  handleItemsChange(event) {
    const imageDrafts = (this.data.imageDrafts || []).map((draft, index) => {
      if (index !== this.data.currentIndex) return draft;
      const items = withDisplayIndexes(event.detail.items || []).map((item) => Object.assign({}, item, {
        sourceImageId: draft.imageId,
        sourceImageFileId: draft.fileId
      }));
      return Object.assign({}, draft, {
        items,
        itemCount: items.filter((item) => item.confirmed !== false).length
      });
    });
    this.setData({
      imageDrafts,
      showAddPhotoHint: imageDrafts.length < FREE_CONTENT_IMAGE_LIMIT
    });
    this.setCurrentImage(this.data.currentIndex);
    wx.setStorageSync('captureDraft', { imageDrafts });
  },

  addNextPhoto() {
    if ((this.data.imageDrafts || []).length >= FREE_CONTENT_IMAGE_LIMIT) {
      wx.showModal({
        title: '免费额度已用完',
        content: `默认可保存 ${FREE_CONTENT_IMAGE_LIMIT} 张箱内照片，更多照片可在升级后使用。`,
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#4f8f67'
      });
      return;
    }

    const success = (result) => {
      const imagePath = getChosenPath(result);
      if (!imagePath) return;
      wx.showLoading({ title: 'AI 识别中' });
      const persistOriginal = imageStore.persistImage(imagePath, 'find-things/content');
      const analyzePrepared = imageStore.prepareImageForAnalyze(imagePath)
        .then((analyzePath) => ai.analyzeImage({ imagePath: analyzePath, allowMockFallback: false }));

      Promise.all([persistOriginal, analyzePrepared])
        .then(([storedPath, analyzed]) => {
          return Object.assign({}, analyzed, {
            imagePath: storedPath,
            fileId: storedPath
          });
        })
        .then((analyzed) => {
          const nextDraft = this.createImageDraft(analyzed, this.data.imageDrafts.length);
          const imageDrafts = (this.data.imageDrafts || []).concat(nextDraft);
          this.setData({
            imageDrafts,
            showAddPhotoHint: imageDrafts.length < FREE_CONTENT_IMAGE_LIMIT
          });
          wx.setStorageSync('captureDraft', { imageDrafts });
          this.setCurrentImage(imageDrafts.length - 1);
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
    };

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['camera', 'album'],
        success
      });
      return;
    }
    wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['camera', 'album'], success });
  },

  goNext() {
    const imageDrafts = this.data.imageDrafts || [];
    const confirmedItems = imageDrafts.reduce((items, draft) => {
      return items.concat((draft.items || [])
        .filter((item) => item.confirmed !== false)
        .map((item) => Object.assign({}, item, {
          sourceImageId: draft.imageId,
          sourceImageFileId: draft.fileId
        })));
    }, []);
    if (!confirmedItems.length) {
      wx.showToast({ title: '至少保留一件物品', icon: 'none' });
      return;
    }

    const contentImages = imageDrafts.map((draft, index) => ({
      imageId: draft.imageId,
      fileId: draft.fileId,
      label: draft.label || `照片 ${index + 1}`,
      sortOrder: index,
      itemCount: (draft.items || []).filter((item) => item.confirmed !== false).length
    }));

    const previousDraft = wx.getStorageSync('reviewDraft') || {};
    wx.setStorageSync('reviewDraft', {
      draftId: previousDraft.draftId || createDraftId(),
      contentImages,
      contentImageFileId: contentImages[0] ? contentImages[0].fileId : '',
      items: confirmedItems
    });
    wx.navigateTo({ url: '/pages/container/edit' });
  }
});
