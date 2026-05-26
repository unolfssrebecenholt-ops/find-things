const ai = require('../../services/ai');
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
  return `content_image_${Date.now()}_${index + 1}`;
}

function pickAddedContentImage(result, imageInput, index) {
  if (result && result.image) return result.image;
  if (result && result.contentImage) return result.contentImage;

  const container = result && result.container ? result.container : result;
  const images = container && Array.isArray(container.contentImages) ? container.contentImages : [];
  const matchedById = images.find((image) => image.imageId === imageInput.imageId);
  if (matchedById) return matchedById;
  return images[index] || imageInput;
}

function createContainerViewModel(container) {
  return Object.assign({}, container, {
    displayLocation: container.locationPath || '未填写位置'
  });
}

Page({
  data: {
    id: '',
    container: null,
    hasContainer: false,
    showMissingContainer: false,
    hasCoverImage: false,
    showCoverPlaceholder: false,
    items: [],
    currentItems: [],
    contentImages: [],
    hasContentImages: false,
    showContentEmpty: true,
    currentImageIndex: 0,
    currentPhotoLabel: '照片 1/1',
    addPhotoLabel: '添加照片',
    freeLimit: FREE_CONTENT_IMAGE_LIMIT
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    this.load();
  },

  load() {
    if (typeof storage.removeDemoData === 'function') {
      storage.removeDemoData();
    }
    const container = storage.getContainer(this.data.id);
    if (!container) {
      this.setData({
        container: null,
        hasContainer: false,
        showMissingContainer: true,
        hasCoverImage: false,
        showCoverPlaceholder: false,
        items: [],
        currentItems: [],
        contentImages: [],
        hasContentImages: false,
        showContentEmpty: true
      });
      return;
    }

    const items = storage.getItemsByContainer(container._id);
    const baseImages = this.getContentImages(container);
    const contentImages = baseImages.map((image, index) => {
      const imageItems = items.filter((item) => {
        if (item.sourceImageId && image.imageId) return item.sourceImageId === image.imageId;
        if (item.sourceImageFileId && image.fileId) return item.sourceImageFileId === image.fileId;
        return index === 0;
      });
      return Object.assign({}, image, {
        label: image.label || `照片 ${index + 1}`,
        sortOrder: image.sortOrder || index,
        itemCount: image.itemCount || imageItems.length,
        items: withDisplayIndexes(imageItems)
      });
    });

    this.setData({
      container: createContainerViewModel(container),
      hasContainer: true,
      showMissingContainer: false,
      hasCoverImage: !!container.coverImageFileId,
      showCoverPlaceholder: !container.coverImageFileId,
      items,
      contentImages,
      hasContentImages: contentImages.length > 0,
      showContentEmpty: contentImages.length === 0
    });
    this.syncCurrentImage(this.data.currentImageIndex);
  },

  getContentImages(container) {
    if (typeof storage.getContentImages === 'function') {
      const images = storage.getContentImages(container._id);
      if (Array.isArray(images) && images.length) return images;
    }
    if (Array.isArray(container.contentImages) && container.contentImages.length) {
      return container.contentImages;
    }
    if (container.contentImageFileId) {
      return [{
        imageId: 'legacy_content_1',
        fileId: container.contentImageFileId,
        label: '照片 1',
        sortOrder: 0,
        itemCount: container.itemCount || 0
      }];
    }
    return [];
  },

  syncCurrentImage(index) {
    const contentImages = this.data.contentImages || [];
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, contentImages.length - 1));
    const image = contentImages[safeIndex] || {};
    const nextPhotoNumber = contentImages.length + 1;
    this.setData({
      currentImageIndex: safeIndex,
      currentItems: image.items || [],
      currentPhotoLabel: `照片 ${safeIndex + 1}/${Math.max(contentImages.length, 1)}`,
      addPhotoLabel: contentImages.length >= FREE_CONTENT_IMAGE_LIMIT ? '添加照片' : `加第 ${nextPhotoNumber} 张`
    });
  },

  onSwiperChange(event) {
    this.syncCurrentImage(event.detail.current);
  },

  reRecognizeCurrent() {
    const image = (this.data.contentImages || [])[this.data.currentImageIndex];
    if (!image) return;

    wx.showLoading({ title: 'AI 识别中' });
    ai.analyzeImage({ imagePath: image.fileId, allowMockFallback: false })
      .then((analyzed) => {
        const items = withDisplayIndexes(analyzed.items || []).map((item) => Object.assign({}, item, {
          sourceImageId: image.imageId,
          sourceImageFileId: image.fileId
        }));

        if (typeof storage.replaceItemsForImage === 'function') {
          storage.replaceItemsForImage(this.data.container._id, image.imageId, items);
          wx.showToast({ title: '已重新识别', icon: 'success' });
          this.load();
          return;
        }

        wx.showToast({ title: '数据层同步中，暂未保存', icon: 'none' });
        const contentImages = (this.data.contentImages || []).map((contentImage, index) => {
          if (index !== this.data.currentImageIndex) return contentImage;
          return Object.assign({}, contentImage, { items, itemCount: items.length });
        });
        this.setData({
          contentImages,
          hasContentImages: contentImages.length > 0,
          showContentEmpty: contentImages.length === 0
        });
        this.syncCurrentImage(this.data.currentImageIndex);
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
  },

  addContentPhoto() {
    if ((this.data.contentImages || []).length >= FREE_CONTENT_IMAGE_LIMIT) {
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
      const fileId = getChosenPath(result);
      if (!fileId) return;
      const index = (this.data.contentImages || []).length;
      const imageInput = {
        imageId: createImageId(index),
        fileId,
        label: `照片 ${index + 1}`,
        sortOrder: index,
        itemCount: 0
      };
      wx.showLoading({ title: 'AI 识别中' });
      ai.analyzeImage({ imagePath: fileId, allowMockFallback: false })
        .then((analyzed) => {
          imageInput.fileId = analyzed.imagePath || fileId;
          if (typeof storage.addContentImage === 'function') {
            const savedImage = storage.addContentImage(this.data.container._id, imageInput);
            const image = pickAddedContentImage(savedImage, imageInput, index);
            const items = withDisplayIndexes(analyzed.items || []).map((item) => Object.assign({}, item, {
              sourceImageId: image.imageId,
              sourceImageFileId: image.fileId
            }));
            if (typeof storage.replaceItemsForImage === 'function') {
              storage.replaceItemsForImage(this.data.container._id, image.imageId, items);
            }
            wx.showToast({ title: '已添加照片', icon: 'success' });
            this.load();
            this.syncCurrentImage(index);
            return;
          }

          wx.showToast({ title: '数据层同步中，暂未保存', icon: 'none' });
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

  deleteContainer() {
    wx.showModal({
      title: '删除容器',
      content: '删除后，本地搜索不会再显示这个容器里的物品。',
      confirmColor: '#a33b2f',
      success: (result) => {
        if (!result.confirm) return;
        storage.deleteContainer(this.data.container._id);
        wx.showToast({ title: '已删除', icon: 'success' });
        wx.reLaunch({ url: '/pages/home/index' });
      }
    });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/index' });
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/index' });
  }
});
