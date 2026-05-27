const imageStore = require('../../services/image-store');
const storage = require('../../services/storage');
const { navigateHome } = require('../../utils/navigation');

function getChosenPath(result) {
  if (result && result.tempFiles && result.tempFiles[0]) {
    return result.tempFiles[0].tempFilePath;
  }
  if (result && result.tempFilePaths && result.tempFilePaths[0]) {
    return result.tempFilePaths[0];
  }
  return '';
}

function createDraftId() {
  return `container_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function legacyContentImages(draft) {
  if (Array.isArray(draft.contentImages) && draft.contentImages.length) {
    return draft.contentImages;
  }
  if (draft.contentImageFileId) {
    return [{
      imageId: 'legacy_content_1',
      fileId: draft.contentImageFileId,
      label: '照片 1',
      sortOrder: 0,
      itemCount: (draft.items || []).length
    }];
  }
  return [];
}

function normalizeContentImages(images, items) {
  return (images || []).map((image, index) => {
    const itemCount = Number.isFinite(image.itemCount)
      ? image.itemCount
      : (items || []).filter((item) => item.sourceImageId === image.imageId || item.sourceImageFileId === image.fileId).length;
    return Object.assign({}, image, {
      label: image.label || `照片 ${index + 1}`,
      sortOrder: Number.isFinite(image.sortOrder) ? image.sortOrder : index,
      itemCount
    });
  });
}

function viewState(data) {
  const coverImageFileId = data.coverImageFileId || '';
  const contentImages = data.contentImages || [];
  const items = data.items || [];
  return {
    showCoverPlaceholder: !coverImageFileId,
    hasCoverImage: !!coverImageFileId,
    hasContentImages: contentImages.length > 0,
    itemPreviewItems: items.slice(0, 8),
    hiddenItemCount: Math.max(0, items.length - 8)
  };
}

Page({
  data: {
    draftId: '',
    name: '',
    locationPath: '',
    coverImageFileId: '',
    showCoverPlaceholder: true,
    hasCoverImage: false,
    contentImageFileId: '',
    contentImages: [],
    hasContentImages: false,
    items: [],
    itemPreviewItems: [],
    hiddenItemCount: 0
  },

  onLoad() {
    this.loadDraft();
  },

  onUnload() {
    if (this.saved) return;
    this.persistDraft(this.data);
  },

  loadDraft() {
    const reviewDraft = wx.getStorageSync('reviewDraft') || {};
    const editDraft = wx.getStorageSync('containerEditDraft') || {};
    const draftId = reviewDraft.draftId || editDraft.draftId || createDraftId();
    const canReuseEditDraft = editDraft.draftId === draftId;
    const items = reviewDraft.items || editDraft.items || [];
    const contentImages = normalizeContentImages(
      legacyContentImages(reviewDraft).length ? legacyContentImages(reviewDraft) : legacyContentImages(editDraft),
      items
    );
    const contentImageFileId = reviewDraft.contentImageFileId
      || editDraft.contentImageFileId
      || (contentImages[0] && contentImages[0].fileId)
      || '';
    const nextData = {
      draftId,
      name: canReuseEditDraft ? (editDraft.name || '') : '',
      locationPath: canReuseEditDraft ? (editDraft.locationPath || '') : '',
      coverImageFileId: canReuseEditDraft ? (editDraft.coverImageFileId || '') : '',
      contentImages,
      contentImageFileId,
      items
    };

    this.setData(Object.assign({}, nextData, viewState(nextData)));
    this.persistDraft(nextData);
  },

  persistDraft(data) {
    if (!data || !data.draftId) return;
    wx.setStorageSync('containerEditDraft', {
      draftId: data.draftId,
      name: data.name || '',
      locationPath: data.locationPath || '',
      coverImageFileId: data.coverImageFileId || '',
      contentImageFileId: data.contentImageFileId || '',
      contentImages: data.contentImages || [],
      items: data.items || []
    });
  },

  setAndPersist(patch) {
    const nextData = Object.assign({}, this.data, patch);
    this.setData(Object.assign({}, patch, viewState(nextData)));
    this.persistDraft(nextData);
  },

  inputName(event) {
    this.setAndPersist({ name: event.detail.value });
  },

  inputLocation(event) {
    this.setAndPersist({ locationPath: event.detail.value });
  },

  chooseCover() {
    const onSuccess = (result) => {
      const chosenPath = getChosenPath(result);
      if (!chosenPath) return;
      wx.showLoading({ title: '保存照片' });
      imageStore.persistImage(chosenPath, 'find-things/covers')
        .then((coverImageFileId) => {
          this.setAndPersist({ coverImageFileId });
        })
        .catch(() => {
          wx.showToast({ title: '封面保存失败', icon: 'none' });
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
        sourceType: ['album', 'camera'],
        success: onSuccess
      });
      return;
    }
    wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'], success: onSuccess });
  },

  useContentAsCover() {
    this.setAndPersist({
      coverImageFileId: this.data.contentImageFileId
    });
  },

  goBack() {
    this.persistDraft(this.data);
    wx.navigateBack({
      delta: 1,
      fail: () => wx.navigateTo({ url: '/pages/capture/review' })
    });
  },

  save() {
    const name = this.data.name.trim();
    if (!name) {
      wx.showToast({ title: '请填写容器名称', icon: 'none' });
      return;
    }
    storage.saveContainer({
      name,
      locationPath: this.data.locationPath,
      coverImageFileId: this.data.coverImageFileId,
      contentImageFileId: this.data.contentImageFileId,
      contentImages: this.data.contentImages,
      items: this.data.items
    });
    this.saved = true;
    wx.removeStorageSync('reviewDraft');
    wx.removeStorageSync('captureDraft');
    wx.removeStorageSync('containerEditDraft');
    wx.showToast({ title: '已保存', icon: 'success' });
    navigateHome();
  }
});
