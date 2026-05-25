const { isMockAssetPath } = require('../../utils/mock-assets');

function createMatchSummary(result) {
  if (result.matchSummary) return result.matchSummary;
  if (result.semanticScore) {
    const score = Number(result.semanticScore) || 0;
    return `语义 ${Math.round(score <= 1 ? score * 100 : score)}%`;
  }
  if (result.matchType) {
    const labels = { name: '名称', feature: '特征', semantic: '语义', hybrid: '综合' };
    return labels[result.matchType] || '匹配';
  }
  const firstReason = (result.reasons || [])[0];
  return firstReason || '匹配';
}

function createPhotoLabel(result) {
  const container = result.container || {};
  const images = Array.isArray(container.contentImages) ? container.contentImages : [];
  const matchedImageId = result.matchedImageId || result.item && result.item.sourceImageId;
  const matchedFileId = result.matchedImageFileId || result.item && result.item.sourceImageFileId;
  const index = images.findIndex((image) => {
    return (matchedImageId && image.imageId === matchedImageId) || (matchedFileId && image.fileId === matchedFileId);
  });
  if (images.length) {
    return `照片 ${index >= 0 ? index + 1 : 1}/${images.length}`;
  }
  return matchedFileId || result.contentImage ? '照片 1/1' : '';
}

Component({
  properties: {
    result: {
      type: Object,
      value: {}
    }
  },

  observers: {
    result(result) {
      const safeResult = result || {};
      const photo = safeResult.matchedImageFileId || safeResult.contentImage || safeResult.containerPhoto || '';
      const hasPhoto = !!photo && !isMockAssetPath(photo);
      this.setData({
        viewModel: {
          photo: hasPhoto ? photo : '',
          hasPhoto,
          showPlaceholder: !hasPhoto,
          photoLabel: createPhotoLabel(safeResult),
          matchSummary: createMatchSummary(safeResult),
          reasons: (safeResult.reasons || []).slice(0, 2)
        }
      });
    }
  },

  data: {
    viewModel: {
      photo: '',
      hasPhoto: false,
      showPlaceholder: true,
      photoLabel: '',
      matchSummary: '',
      reasons: []
    }
  },

  methods: {
    open() {
      const containerId = this.data.result && this.data.result.container && this.data.result.container._id;
      this.triggerEvent('open', { containerId });
    }
  }
});
