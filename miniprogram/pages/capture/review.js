const ai = require('../../services/ai');
const imageDisplay = require('../../services/image-display');
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

function getItemKey(item, imageId, index) {
  return String((item && (item.itemKey || item.tempId || item._id)) || `${imageId || 'image'}_item_${index + 1}`);
}

function toTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatExpiryDateValue(value) {
  const expiresAt = toTimestamp(value);
  if (!expiresAt) return '';
  const date = new Date(expiresAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createDraftItem(item, imageId, fileId, index) {
  return Object.assign({}, item, {
    itemKey: getItemKey(item, imageId, index),
    sourceImageId: imageId,
    sourceImageFileId: fileId
  });
}

function createItemViewModel(item, index, expandedItemKeys) {
  const confidence = Number(item.confidence);
  const featureSummary = (item.features || []).slice(0, 3).join(' / ') || '描述可搜索';
  const fullTagList = unique((item.colors || []).concat(item.features || [], item.aliases || []));
  const tagList = fullTagList.slice(0, 6);
  const bbox = item.bbox || {};
  const itemKey = getItemKey(item, item.sourceImageId, index);
  const isExpanded = (expandedItemKeys || []).indexOf(itemKey) >= 0;
  const hasAnnotation = Number.isFinite(bbox.x)
    && Number.isFinite(bbox.y)
    && Number.isFinite(bbox.width)
    && Number.isFinite(bbox.height);
  const expiryDateValue = formatExpiryDateValue(item.expiresAt);
  const viewModel = Object.assign({}, item, {
    itemKey,
    hasTags: tagList.length > 0,
    tagList,
    tagText: fullTagList.join(' '),
    featureSummary,
    displayDescription: item.description || featureSummary || '确认后会保存进这个容器',
    confidenceLabel: confidence ? `${Math.round(confidence * 100)}%` : '待确认',
    isExpanded,
    isCollapsed: !isExpanded,
    expandText: isExpanded ? '收起' : '展开',
    hasAnnotation,
    expiryDateValue,
    expiryDateText: expiryDateValue || '选择日期',
    annotationStyle: hasAnnotation
      ? `left:${Math.round(bbox.x * 100)}%;top:${Math.round(bbox.y * 100)}%;width:${Math.round(bbox.width * 100)}%;height:${Math.round(bbox.height * 100)}%;`
      : ''
  });
  viewModel.editorItems = [Object.assign({}, viewModel)];
  return viewModel;
}

function stripDraftViewFields(draft) {
  const value = Object.assign({}, draft);
  delete value.displayImagePath;
  return value;
}

Page({
  data: {
    imagePath: '',
    items: [],
    warnings: [],
    imageDrafts: [],
    currentIndex: 0,
    expandedItemKeys: [],
    showAddPhotoHint: true,
    currentLabel: '照片 1/1',
    showAiWarning: false,
    aiStatusText: '',
    ratioClass: 'ratio-landscape',
    recognizing: false,
    recognizingDescText: '下一张照片会加入同一个容器清单。',
    recognizingHintText: '这会儿适合眨眨眼，别和小懒一起紧张。',
    recognizingProgressCount: 0,
    recognizingProgressText: '正在找线索',
    recognizingProgressStateText: '快啦',
    photoLimit: CONTENT_IMAGE_LIMIT
  },

  onLoad() {
    const draft = wx.getStorageSync('captureDraft') || {
      imagePath: '',
      items: [],
      warnings: ['请先选择一张照片进行识别。']
    };
    const imageDrafts = (draft.imageDrafts || [
      this.createImageDraft(draft, 0)
    ]).map((imageDraft, index) => this.createImageDraft(imageDraft, index));
    this.setData({ imageDrafts });
    this.setCurrentImage(0);
  },

  createImageDraft(draft, index) {
    const imageId = draft.imageId || createImageId(index);
    const fileId = draft.fileId || draft.imagePath || draft.contentImageFileId || '';
    const thumbFileId = draft.thumbFileId || draft.thumbnailFileId || draft.previewFileId || '';
    const imageMetadata = draft.imageMetadata || {};
    const items = withDisplayIndexes(draft.items || [])
      .map((item, itemIndex) => createDraftItem(item, imageId, fileId, itemIndex));
    return {
      imageId,
      fileId,
      thumbFileId,
      imagePath: fileId,
      displayImagePath: draft.displayImagePath || '',
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

  setCurrentImage(index, expandedItemKeys) {
    const imageDrafts = this.data.imageDrafts || [];
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, imageDrafts.length - 1));
    const draft = imageDrafts[safeIndex] || {};
    const activeExpandedKeys = Array.isArray(expandedItemKeys)
      ? expandedItemKeys
      : (this.data.expandedItemKeys || []);
    const items = withDisplayIndexes(draft.items || [])
      .map((item, itemIndex) => createItemViewModel(item, itemIndex, activeExpandedKeys));
    const currentData = {
      currentIndex: safeIndex,
      expandedItemKeys: activeExpandedKeys,
      showAddPhotoHint: imageDrafts.length < CONTENT_IMAGE_LIMIT,
      currentLabel: `照片 ${safeIndex + 1}/${Math.max(imageDrafts.length, 1)}`,
      imagePath: draft.displayImagePath || draft.imagePath || draft.fileId || '',
      ratioClass: getRatioClass(draft),
      items,
      showAiWarning: !!draft.usedMock,
      aiStatusText: draft.usedMock
        ? `小懒这次没能完成识别：${draft.aiErrorMessage || '已使用本地示例结果'}`
        : '',
      warnings: draft.warnings || []
    };
    this.setData(currentData);
    imageDisplay.resolveImagePath(draft.thumbFileId || draft.fileId || draft.imagePath || '')
      .then((displayImagePath) => {
        if (safeIndex !== this.data.currentIndex) return;
        if (!displayImagePath || imageDisplay.shouldResolveDisplayPath(displayImagePath)) return;
        const nextDrafts = (this.data.imageDrafts || []).map((imageDraft, draftIndex) => {
          if (draftIndex !== safeIndex) return imageDraft;
          return Object.assign({}, imageDraft, { displayImagePath });
        });
        this.setData({
          imageDrafts: nextDrafts,
          imagePath: displayImagePath
        });
      });
  },

  switchImage(event) {
    this.setCurrentImage(event.currentTarget.dataset.index);
  },

  toggleItemExpanded(event) {
    const itemKey = String(event.currentTarget.dataset.key || '');
    this.toggleExpandedKey(itemKey);
  },

  removeExpandedItem(event) {
    const contextKey = String(event.currentTarget.dataset.key || '');
    if (!contextKey) return;
    wx.showModal({
      title: '移除这件物品？',
      content: '移除后保存容器时不会记录它。',
      cancelText: '取消',
      confirmText: '移除',
      confirmColor: '#c83a32',
      success: (result) => {
        if (result.confirm) {
          this.updateExpandedItem(contextKey, []);
        }
      }
    });
  },

  toggleExpandedKey(itemKey) {
    if (!itemKey) return;
    const expandedItemKeys = this.data.expandedItemKeys || [];
    const nextKeys = expandedItemKeys.indexOf(itemKey) >= 0
      ? expandedItemKeys.filter((key) => key !== itemKey)
      : expandedItemKeys.concat(itemKey);
    this.setCurrentImage(this.data.currentIndex, nextKeys);
  },

  handleExpandedItemChange(event) {
    const contextKey = String(event.detail.contextKey || '');
    this.updateExpandedItem(contextKey, event.detail.items || []);
  },

  updateExpandedItem(contextKey, editedItems) {
    if (!contextKey) return;
    const shouldRemove = editedItems.length === 0;
    const imageDrafts = (this.data.imageDrafts || []).map((draft, index) => {
      if (index !== this.data.currentIndex) return draft;
      const nextItems = (draft.items || []).reduce((items, item, itemIndex) => {
        const itemKey = getItemKey(item, draft.imageId, itemIndex);
        if (itemKey !== contextKey) return items.concat(item);
        if (shouldRemove) return items;
        return items.concat(Object.assign({}, item, editedItems[0], {
          itemKey: contextKey,
          sourceImageId: draft.imageId,
          sourceImageFileId: draft.fileId
        }));
      }, []);
      const items = withDisplayIndexes(nextItems)
        .map((item, itemIndex) => createDraftItem(item, draft.imageId, draft.fileId, itemIndex));
      return Object.assign({}, draft, {
        items,
        itemCount: items.filter((item) => item.confirmed !== false).length
      });
    });
    const expandedItemKeys = shouldRemove
      ? (this.data.expandedItemKeys || []).filter((key) => key !== contextKey)
      : (this.data.expandedItemKeys || []);
    this.setData({
      imageDrafts,
      expandedItemKeys,
      showAddPhotoHint: imageDrafts.length < CONTENT_IMAGE_LIMIT
    });
    this.setCurrentImage(this.data.currentIndex, expandedItemKeys);
    wx.setStorageSync('captureDraft', { imageDrafts: imageDrafts.map(stripDraftViewFields) });
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
      this.setData({
        recognizing: true,
        recognizingDescText: '下一张照片会加入同一个容器清单。',
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
        .then((analyzePath) => ai.analyzeImage({
          imagePath: analyzePath,
          allowMockFallback: false,
          onProgress: handleProgress
        }));

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
          wx.setStorageSync('captureDraft', { imageDrafts: imageDrafts.map(stripDraftViewFields) });
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

    const openPicker = () => {
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
    };

    Promise.resolve()
      .then(() => ai.getUsageStatus())
      .then((status) => {
        if (status && status.canAnalyze === false) {
          showUsageLimit(status);
          return;
        }
        openPicker();
      })
      .catch(() => openPicker());
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
