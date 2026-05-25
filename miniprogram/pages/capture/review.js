const mockAi = require('../../services/mock-ai');
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

function createItemViewModel(item) {
  const confidence = Number(item.confidence);
  return Object.assign({}, item, {
    displayDescription: item.description || '确认后会保存进这个容器',
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
    viewMode: 'mark',
    isMarkMode: true,
    isListMode: false,
    showAddPhotoHint: true,
    currentLabel: '照片 1/1',
    editPreviewItems: [],
    previewNote: '放在靠左一侧，常用',
    freeLimit: FREE_CONTENT_IMAGE_LIMIT
  },

  onLoad() {
    const draft = wx.getStorageSync('captureDraft') || mockAi.analyzeImage({});
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
      warnings: draft.warnings || []
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
      editPreviewItems: items.slice(0, 2),
      warnings: draft.warnings || []
    });
  },

  switchImage(event) {
    this.setCurrentImage(event.currentTarget.dataset.index);
  },

  switchViewMode(event) {
    const viewMode = event.currentTarget.dataset.mode || 'mark';
    this.setData({
      viewMode,
      isMarkMode: viewMode === 'mark',
      isListMode: viewMode !== 'mark'
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
      const analyzed = mockAi.analyzeImage({ imagePath });
      const nextDraft = this.createImageDraft(analyzed, this.data.imageDrafts.length);
      const imageDrafts = (this.data.imageDrafts || []).concat(nextDraft);
      this.setData({
        imageDrafts,
        showAddPhotoHint: imageDrafts.length < FREE_CONTENT_IMAGE_LIMIT
      });
      wx.setStorageSync('captureDraft', { imageDrafts });
      this.setCurrentImage(imageDrafts.length - 1);
    };

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        success
      });
      return;
    }
    wx.chooseImage({ count: 1, sourceType: ['camera', 'album'], success });
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

    wx.setStorageSync('reviewDraft', {
      contentImages,
      contentImageFileId: contentImages[0] ? contentImages[0].fileId : '',
      items: confirmedItems
    });
    wx.navigateTo({ url: '/pages/container/edit' });
  }
});
