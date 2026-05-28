const ai = require('../../services/ai');
const imageStore = require('../../services/image-store');
const storage = require('../../services/storage');
const { withDisplayIndexes } = require('../../utils/geometry');
const { navigateHome } = require('../../utils/navigation');
const { createImageMetadata } = require('../../utils/image-metadata');
const { getContainerPreview } = require('../../utils/image-preview');

const CONTENT_IMAGE_LIMIT = storage.CONTENT_IMAGE_LIMIT || 5;

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
  const preview = getContainerPreview(container);
  return Object.assign({}, container, {
    displayLocation: container.locationPath || '未填写位置',
    coverDisplayFileId: preview.thumb || container.coverImageFileId || ''
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
    recognizing: false,
    recognizingDescText: '小懒正在认真扒拉照片，稍等一下下。',
    recognizingHintText: '这会儿适合眨眨眼，别和小懒一起紧张。',
    recognizingProgressCount: 0,
    recognizingProgressText: '正在找线索',
    recognizingProgressStateText: '快啦',
    photoLimit: CONTENT_IMAGE_LIMIT
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    this.load();
  },

  load() {
    const loadContainer = typeof storage.removeDemoDataAsync === 'function'
      ? storage.removeDemoDataAsync().then(() => storage.getContainerAsync(this.data.id))
      : Promise.resolve(storage.getContainer(this.data.id));
    loadContainer
      .then((container) => this.renderContainer(container))
      .catch((error) => {
        wx.showToast({
          title: error && error.message ? error.message : '数据同步失败',
          icon: 'none'
        });
      });
  },

  renderContainer(container) {
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

    const loadItems = typeof storage.getItemsByContainerAsync === 'function'
      ? Promise.all([storage.getItemsByContainerAsync(container._id), storage.getContentImagesAsync(container._id)])
      : Promise.resolve([storage.getItemsByContainer(container._id), this.getContentImages(container)]);

    loadItems
      .then(([items, baseImages]) => {
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
          hasCoverImage: !!(container.coverThumbFileId || container.coverImageFileId),
          showCoverPlaceholder: !(container.coverThumbFileId || container.coverImageFileId),
          items,
          contentImages,
          hasContentImages: contentImages.length > 0,
          showContentEmpty: contentImages.length === 0
        });
        this.syncCurrentImage(this.data.currentImageIndex);
      })
      .catch((error) => {
        wx.showToast({
          title: error && error.message ? error.message : '数据同步失败',
          icon: 'none'
        });
      });
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
        thumbFileId: container.contentThumbFileId || '',
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
      addPhotoLabel: contentImages.length >= CONTENT_IMAGE_LIMIT ? '添加照片' : `加第 ${nextPhotoNumber} 张`
    });
  },

  onSwiperChange(event) {
    this.syncCurrentImage(event.detail.current);
  },

  reRecognizeCurrent() {
    const image = (this.data.contentImages || [])[this.data.currentImageIndex];
    if (!image) return;

    this.showRecognizingLayer('小懒正在重新看这张，旧线索先放一边。');
    const handleProgress = (progress) => this.updateRecognizingProgress(progress);
    ai.analyzeImage({
      imagePath: image.fileId,
      allowMockFallback: false,
      onProgress: handleProgress
    })
      .then((analyzed) => {
        const items = withDisplayIndexes(analyzed.items || []).map((item) => Object.assign({}, item, {
          sourceImageId: image.imageId,
          sourceImageFileId: image.fileId
        }));

        if (typeof storage.replaceItemsForImageAsync === 'function') {
          return storage.replaceItemsForImageAsync(this.data.container._id, image.imageId, items).then(() => {
            wx.showToast({ title: '已重新识别', icon: 'success' });
            this.load();
          });
        }
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
          title: '小懒暂时没看清',
          content: error && error.message ? error.message : '请检查识别服务配置、合法域名和网络后重试。',
          showCancel: false,
          confirmColor: '#1f6048'
        });
      })
      .finally(() => {
        this.setData({ recognizing: false });
      });
  },

  addContentPhoto() {
    if ((this.data.contentImages || []).length >= CONTENT_IMAGE_LIMIT) {
      wx.showModal({
        title: '照片数量已达上限',
        content: `当前最多可保存 ${CONTENT_IMAGE_LIMIT} 张箱内照片。`,
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#1f6048'
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
        itemCount: 0,
        analyzeStatus: 'analyzing'
      };
      this.showRecognizingLayer('这张照片会加入当前容器清单。');
      const handleProgress = (progress) => this.updateRecognizingProgress(progress);
      const persistOriginal = imageStore.persistImage(fileId, 'find-things/content');
      const persistThumbnail = imageStore.persistThumbnail(fileId, 'find-things/thumbs');
      const analyzePrepared = imageStore.prepareImageForAnalyze(fileId)
        .then((analyzePath) => ai.analyzeImage({
          imagePath: analyzePath,
          allowMockFallback: false,
          onProgress: handleProgress
        }));

      Promise.all([persistOriginal, persistThumbnail, analyzePrepared])
        .then(([storedPath, thumbPath, analyzed]) => {
          imageInput.fileId = storedPath;
          imageInput.thumbFileId = thumbPath || '';
          Object.assign(imageInput, createImageMetadata({
            chooseResult: result,
            imageMetadata: analyzed.imageMetadata
          }));
          if (typeof storage.addContentImageAsync === 'function') {
            return storage.addContentImageAsync(this.data.container._id, imageInput).then((savedImage) => {
              const image = pickAddedContentImage(savedImage, imageInput, index);
              const items = withDisplayIndexes(analyzed.items || []).map((item) => Object.assign({}, item, {
                sourceImageId: image.imageId,
                sourceImageFileId: image.fileId
              }));
              if (typeof storage.replaceItemsForImageAsync === 'function') {
                return storage.replaceItemsForImageAsync(this.data.container._id, image.imageId, items);
              }
              if (typeof storage.replaceItemsForImage === 'function') {
                storage.replaceItemsForImage(this.data.container._id, image.imageId, items);
              }
              return null;
            }).then(() => {
              wx.showToast({ title: '已添加照片', icon: 'success' });
              this.load();
              this.syncCurrentImage(index);
            });
          }
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
            title: '小懒暂时没看清',
            content: error && error.message ? error.message : '请检查识别服务配置、合法域名和网络后重试。',
            showCancel: false,
            confirmColor: '#1f6048'
          });
        })
        .finally(() => {
          this.setData({ recognizing: false });
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

  showRecognizingLayer(descText) {
    this.setData({
      recognizing: true,
      recognizingDescText: descText || '小懒正在认真扒拉照片，稍等一下下。',
      recognizingHintText: '这会儿适合眨眨眼，别和小懒一起紧张。',
      recognizingProgressCount: 0,
      recognizingProgressText: '正在找线索',
      recognizingProgressStateText: '快啦'
    });
  },

  updateRecognizingProgress(progress) {
    const count = Number(progress && progress.recognizedItemCount) || 0;
    if (count <= 0) return;
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
  },

  deleteContainer() {
    if (!this.data.container || !this.data.container._id) return;

    wx.showModal({
      title: '删除容器',
      content: `确定删除「${this.data.container.name || '这个容器'}」吗？删除后，本地搜索不会再显示这个容器里的物品。`,
      confirmText: '删除',
      confirmColor: '#a33b2f',
      success: (result) => {
        if (!result.confirm) return;
        const runDelete = typeof storage.deleteContainerAsync === 'function'
          ? storage.deleteContainerAsync(this.data.container._id)
          : Promise.resolve(storage.deleteContainer(this.data.container._id));
        runDelete
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            navigateHome();
          })
          .catch((error) => {
            wx.showToast({
              title: error && error.message ? error.message : '数据同步失败',
              icon: 'none'
            });
          });
      }
    });
  },

  goHome() {
    navigateHome();
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/index' });
  }
});
