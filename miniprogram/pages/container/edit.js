const imageStore = require('../../services/image-store');
const imageDisplay = require('../../services/image-display');
const storage = require('../../services/storage');
const { navigateHome } = require('../../utils/navigation');
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
      thumbFileId: draft.contentThumbFileId || '',
      label: '箱内视角',
      orientation: 'landscape',
      sortOrder: 0,
      itemCount: (draft.items || []).length
    }];
  }
  return [];
}

function inferRatioClass(image) {
  const orientation = image && image.orientation;
  if (orientation === 'portrait') return 'ratio-portrait';
  if (orientation === 'square') return 'ratio-square';
  if (orientation === 'landscape') return 'ratio-landscape';

  const width = Number(image && image.width) || 0;
  const height = Number(image && image.height) || 0;
  if (width && height) {
    if (width > height) return 'ratio-landscape';
    if (height > width) return 'ratio-portrait';
    return 'ratio-square';
  }
  return 'ratio-landscape';
}

function ratioText(ratioClass) {
  if (ratioClass === 'ratio-portrait') return '竖拍';
  if (ratioClass === 'ratio-square') return '方图';
  return '横拍';
}

function summaryTitle(index) {
  return index === 0 ? '箱内视角' : '补充细节';
}

function normalizeContentImages(images, items) {
  return (images || []).map((image, index) => {
    const itemCount = Number.isFinite(image.itemCount)
      ? image.itemCount
      : (items || []).filter((item) => item.sourceImageId === image.imageId || item.sourceImageFileId === image.fileId).length;
    const ratioClass = inferRatioClass(image);
    const displayFileId = image.displayFileId || image.thumbFileId || image.thumbnailFileId || image.previewFileId || image.fileId || '';
    return Object.assign({}, image, {
      label: image.label || summaryTitle(index),
      sortOrder: Number.isFinite(image.sortOrder) ? image.sortOrder : index,
      itemCount,
      ratioClass,
      ratioText: ratioText(ratioClass),
      displayFileId,
      summaryTitle: summaryTitle(index),
      summaryMeta: itemCount > 0 ? `${itemCount} 件物品` : '待补充状态'
    });
  });
}

function stripImageViewFields(image) {
  const value = Object.assign({}, image);
  delete value.displayFileId;
  return value;
}

function collectDraftImagePaths(data) {
  const paths = [
    data && data.coverThumbFileId,
    data && data.coverImageFileId
  ];
  ((data && data.contentImages) || []).forEach((image) => {
    paths.push(image && image.thumbFileId);
    paths.push(image && image.thumbnailFileId);
    paths.push(image && image.previewFileId);
    paths.push(image && image.fileId);
  });
  return paths.filter(Boolean);
}

function applyDisplayPaths(data, resolvedPaths) {
  const resolved = resolvedPaths || {};
  const contentImages = (data.contentImages || []).map((image) => Object.assign({}, image, {
    displayFileId: imageDisplay.pickDisplayPath([
      image.thumbFileId,
      image.thumbnailFileId,
      image.previewFileId,
      image.fileId
    ], resolved)
  }));
  return Object.assign({}, data, {
    contentImages,
    coverDisplayFileId: imageDisplay.pickDisplayPath([
      data.coverThumbFileId,
      data.coverImageFileId
    ], resolved)
  });
}

function viewState(data) {
  const coverImageFileId = data.coverImageFileId || '';
  const coverThumbFileId = data.coverThumbFileId || '';
  const coverImageMetadata = data.coverImageMetadata || {};
  const contentImages = data.contentImages || [];
  const items = data.items || [];
  const showAllItems = !!data.showAllItems;
  const rawContentImageIndex = Number(data.currentContentImageIndex) || 0;
  const currentContentImageIndex = contentImages.length
    ? Math.min(Math.max(rawContentImageIndex, 0), contentImages.length - 1)
    : 0;
  const hiddenItemCount = Math.max(0, items.length - 8);
  const coverRatioClass = coverImageFileId ? inferRatioClass(coverImageMetadata) : 'ratio-landscape';
  return {
    showCoverPlaceholder: !coverImageFileId,
    hasCoverImage: !!coverImageFileId,
    coverDisplayFileId: data.coverDisplayFileId || coverThumbFileId || coverImageFileId,
    coverRatioClass,
    coverRatioText: coverImageFileId ? ratioText(coverRatioClass) : '横拍更清楚',
    hasContentImages: contentImages.length > 0,
    currentContentImageIndex,
    itemPreviewItems: showAllItems ? items : items.slice(0, 8),
    hiddenItemCount,
    contentImageCountText: `${contentImages.length} 张`,
    itemCountText: `${items.length} 件物品`,
    hasHiddenItems: hiddenItemCount > 0,
    showAllItems,
    itemPreviewToggleText: showAllItems ? '收起物品清单' : `还有 ${hiddenItemCount} 件一起保存`
  };
}

Page({
  data: {
    draftId: '',
    name: '',
    locationPath: '',
    coverImageFileId: '',
    coverThumbFileId: '',
    coverImageMetadata: {},
    coverDisplayFileId: '',
    coverRatioClass: 'ratio-landscape',
    coverRatioText: '横拍更清楚',
    showCoverPlaceholder: true,
    hasCoverImage: false,
    contentImageFileId: '',
    contentThumbFileId: '',
    contentImages: [],
    currentContentImageIndex: 0,
    hasContentImages: false,
    items: [],
    itemPreviewItems: [],
    hiddenItemCount: 0,
    contentImageCountText: '0 张',
    itemCountText: '0 件物品',
    hasHiddenItems: false,
    showAllItems: false,
    itemPreviewToggleText: ''
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
    const contentThumbFileId = reviewDraft.contentThumbFileId
      || editDraft.contentThumbFileId
      || (contentImages[0] && contentImages[0].thumbFileId)
      || '';
    const nextData = {
      draftId,
      name: canReuseEditDraft ? (editDraft.name || '') : '',
      locationPath: canReuseEditDraft ? (editDraft.locationPath || '') : '',
      coverImageFileId: canReuseEditDraft ? (editDraft.coverImageFileId || '') : '',
      coverThumbFileId: canReuseEditDraft ? (editDraft.coverThumbFileId || '') : '',
      coverImageMetadata: canReuseEditDraft ? (editDraft.coverImageMetadata || {}) : {},
      currentContentImageIndex: canReuseEditDraft ? (Number(editDraft.currentContentImageIndex) || 0) : 0,
      contentImages,
      contentImageFileId,
      contentThumbFileId,
      items
    };

    this.renderDraft(nextData, true);
  },

  renderDraft(nextData, shouldPersist) {
    imageDisplay.resolveImagePaths(collectDraftImagePaths(nextData))
      .then((resolvedPaths) => {
        const displayData = applyDisplayPaths(nextData, resolvedPaths);
        this.setData(Object.assign({}, displayData, viewState(displayData)));
        if (shouldPersist) this.persistDraft(displayData);
      });
  },

  persistDraft(data) {
    if (!data || !data.draftId) return;
    wx.setStorageSync('containerEditDraft', {
      draftId: data.draftId,
      name: data.name || '',
      locationPath: data.locationPath || '',
      coverImageFileId: data.coverImageFileId || '',
      coverThumbFileId: data.coverThumbFileId || '',
      coverImageMetadata: data.coverImageMetadata || {},
      contentImageFileId: data.contentImageFileId || '',
      contentThumbFileId: (data.contentImages || [])[0] && (data.contentImages || [])[0].thumbFileId || '',
      contentImages: (data.contentImages || []).map(stripImageViewFields),
      currentContentImageIndex: Number(data.currentContentImageIndex) || 0,
      items: data.items || []
    });
  },

  setAndPersist(patch) {
    const nextData = Object.assign({}, this.data, patch);
    this.renderDraft(nextData, true);
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
      Promise.all([
        imageStore.persistImage(chosenPath, 'find-things/covers'),
        imageStore.persistThumbnail(chosenPath, 'find-things/thumbs')
      ])
        .then(([coverImageFileId, coverThumbFileId]) => {
          this.setAndPersist({
            coverImageFileId,
            coverThumbFileId: coverThumbFileId || '',
            coverImageMetadata: createImageMetadata({ chooseResult: result })
          });
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
    const currentImage = (this.data.contentImages || [])[this.data.currentContentImageIndex];
    const contentImage = currentImage
      || (this.data.contentImages || []).find((image) => image.fileId === this.data.contentImageFileId)
      || (this.data.contentImages || [])[0]
      || {};
    this.setAndPersist({
      coverImageFileId: contentImage.fileId || this.data.contentImageFileId,
      coverThumbFileId: contentImage.thumbFileId || '',
      coverImageMetadata: {
        orientation: contentImage.orientation || '',
        width: contentImage.width || 0,
        height: contentImage.height || 0
      }
    });
    wx.showToast({ title: '已用箱内图做封面', icon: 'success' });
  },

  onContentSwiperChange(event) {
    const current = Number(event.detail && event.detail.current) || 0;
    this.setAndPersist({ currentContentImageIndex: current });
  },

  toggleItemPreview() {
    this.setAndPersist({ showAllItems: !this.data.showAllItems });
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
    wx.showLoading({ title: '保存中' });
    const saveData = {
      name,
      locationPath: this.data.locationPath,
      coverImageFileId: this.data.coverImageFileId,
      coverThumbFileId: this.data.coverThumbFileId,
      contentImageFileId: this.data.contentImageFileId,
      contentThumbFileId: (this.data.contentImages || [])[0] && (this.data.contentImages || [])[0].thumbFileId || '',
      contentImages: (this.data.contentImages || []).map(stripImageViewFields),
      items: this.data.items
    };
    const runSave = typeof storage.saveContainerAsync === 'function'
      ? storage.saveContainerAsync(saveData)
      : Promise.resolve(storage.saveContainer(saveData));
    runSave
      .then(() => {
        this.saved = true;
        wx.removeStorageSync('reviewDraft');
        wx.removeStorageSync('captureDraft');
        wx.removeStorageSync('containerEditDraft');
        wx.showToast({ title: '已保存', icon: 'success' });
        navigateHome();
      })
      .catch((error) => {
        wx.showToast({
          title: error && error.message ? error.message : '保存失败',
          icon: 'none'
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  }
});
