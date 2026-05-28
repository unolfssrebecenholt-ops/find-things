const ai = require('../../services/ai');
const imageStore = require('../../services/image-store');
const storage = require('../../services/storage');
const { withDisplayIndexes } = require('../../utils/geometry');
const { createImageMetadata } = require('../../utils/image-metadata');

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
  return `draft_image_${Date.now()}_${index + 1}`;
}

function createDraftId() {
  return `review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getRatioClass(draft) {
  if (draft.orientation === 'portrait') return 'ratio-portrait';
  if (draft.orientation === 'square') return 'ratio-square';
  if (draft.width && draft.height && draft.width === draft.height) return 'ratio-square';
  if (draft.width && draft.height && draft.height > draft.width) return 'ratio-portrait';
  return 'ratio-landscape';
}

function unique(values) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function createItemViewModel(item) {
  const confidence = Number(item.confidence);
  const featureSummary = (item.features || []).slice(0, 3).join(' / ') || '描述可搜索';
  const fullTagList = unique((item.colors || []).concat(item.features || [], item.aliases || []));
  const tagList = fullTagList.slice(0, 6);
  const bbox = item.bbox || {};
  const hasAnnotation = Number.isFinite(bbox.x)
    && Number.isFinite(bbox.y)
    && Number.isFinite(bbox.width)
    && Number.isFinite(bbox.height);
  return Object.assign({}, item, {
    hasTags: tagList.length > 0,
    tagList,
    tagText: fullTagList.join(' '),
    featureSummary,
    displayDescription: item.description || featureSummary || '确认后会保存进这个容器',
    confidenceLabel: confidence ? `${Math.round(confidence * 100)}%` : '待确认',
    hasAnnotation,
    annotationStyle: hasAnnotation
      ? `left:${Math.round(bbox.x * 100)}%;top:${Math.round(bbox.y * 100)}%;width:${Math.round(bbox.width * 100)}%;height:${Math.round(bbox.height * 100)}%;`
      : ''
  });
}

Page({
  data: {
    imagePath: '',
    items: [],
    warnings: [],
    imageDrafts: [],
    currentIndex: 0,
    viewMode: 'annotated',
    isAnnotatedMode: true,
    isPhotoMode: true,
    isListMode: false,
    annotatedSegmentClass: 'active',
    summarySegmentClass: '',
    listModeClass: '',
    showAddPhotoHint: true,
    currentLabel: '照片 1/1',
    showAiWarning: false,
    aiStatusText: '',
    ratioClass: 'ratio-landscape',
    recognizing: false,
    photoLimit: CONTENT_IMAGE_LIMIT
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
    const thumbFileId = draft.thumbFileId || draft.thumbnailFileId || draft.previewFileId || '';
    const imageMetadata = draft.imageMetadata || {};
    const items = withDisplayIndexes(draft.items || []).map((item) => Object.assign({}, item, {
      sourceImageId: imageId,
      sourceImageFileId: fileId
    }));
    return {
      imageId,
      fileId,
      thumbFileId,
      imagePath: fileId,
      label: `照片 ${index + 1}`,
      sortOrder: index,
      itemCount: items.filter((item) => item.confirmed !== false).length,
      orientation: imageMetadata.orientation || '',
      width: imageMetadata.width || 0,
      height: imageMetadata.height || 0,
      analyzeStatus: imageMetadata.analyzeStatus || 'ready',
      analyzedAt: imageMetadata.analyzedAt || Date.now(),
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
      showAddPhotoHint: imageDrafts.length < CONTENT_IMAGE_LIMIT,
      currentLabel: `照片 ${safeIndex + 1}/${Math.max(imageDrafts.length, 1)}`,
      imagePath: draft.imagePath || draft.fileId || '',
      ratioClass: getRatioClass(draft),
      items,
      showAiWarning: !!draft.usedMock,
      aiStatusText: draft.usedMock
        ? `小懒这次没能完成识别：${draft.aiErrorMessage || '已使用本地示例结果'}`
        : '',
      warnings: draft.warnings || []
    });
  },

  switchImage(event) {
    this.setCurrentImage(event.currentTarget.dataset.index);
  },

  switchViewMode(event) {
    const viewMode = event.currentTarget.dataset.mode || 'annotated';
    const isListMode = viewMode === 'summary';
    this.setData({
      viewMode,
      isAnnotatedMode: viewMode === 'annotated',
      isPhotoMode: !isListMode,
      isListMode,
      annotatedSegmentClass: viewMode === 'annotated' ? 'active' : '',
      summarySegmentClass: isListMode ? 'active' : '',
      listModeClass: isListMode ? 'list-only' : ''
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
      showAddPhotoHint: imageDrafts.length < CONTENT_IMAGE_LIMIT
    });
    this.setCurrentImage(this.data.currentIndex);
    wx.setStorageSync('captureDraft', { imageDrafts });
  },

  addNextPhoto() {
    if ((this.data.imageDrafts || []).length >= CONTENT_IMAGE_LIMIT) {
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
      const imagePath = getChosenPath(result);
      if (!imagePath) return;
      this.setData({ recognizing: true });
      const persistOriginal = imageStore.persistImage(imagePath, 'find-things/content');
      const persistThumbnail = imageStore.persistThumbnail(imagePath, 'find-things/thumbs');
      const analyzePrepared = imageStore.prepareImageForAnalyze(imagePath)
        .then((analyzePath) => ai.analyzeImage({ imagePath: analyzePath, allowMockFallback: false }));

      Promise.all([persistOriginal, persistThumbnail, analyzePrepared])
        .then(([storedPath, thumbPath, analyzed]) => {
          return Object.assign({}, analyzed, {
            imagePath: storedPath,
            fileId: storedPath,
            thumbFileId: thumbPath || '',
            imageMetadata: createImageMetadata({
              chooseResult: result,
              imageMetadata: analyzed.imageMetadata
            })
          });
        })
        .then((analyzed) => {
          const nextDraft = this.createImageDraft(analyzed, this.data.imageDrafts.length);
          const imageDrafts = (this.data.imageDrafts || []).concat(nextDraft);
          this.setData({
            imageDrafts,
            showAddPhotoHint: imageDrafts.length < CONTENT_IMAGE_LIMIT
          });
          wx.setStorageSync('captureDraft', { imageDrafts });
          this.setCurrentImage(imageDrafts.length - 1);
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
      thumbFileId: draft.thumbFileId || '',
      label: draft.label || `照片 ${index + 1}`,
      sortOrder: index,
      itemCount: (draft.items || []).filter((item) => item.confirmed !== false).length,
      orientation: draft.orientation || '',
      width: draft.width || 0,
      height: draft.height || 0,
      analyzeStatus: draft.analyzeStatus || 'ready',
      analyzedAt: draft.analyzedAt || Date.now()
    }));

    const previousDraft = wx.getStorageSync('reviewDraft') || {};
    wx.setStorageSync('reviewDraft', {
      draftId: previousDraft.draftId || createDraftId(),
      contentImages,
      contentImageFileId: contentImages[0] ? contentImages[0].fileId : '',
      contentThumbFileId: contentImages[0] ? (contentImages[0].thumbFileId || '') : '',
      items: confirmedItems
    });
    wx.navigateTo({ url: '/pages/container/edit' });
  }
});
