const { isMockAssetPath } = require('../../utils/mock-assets');
const imageDisplay = require('../../services/image-display');

function createMatchSummary(result) {
  if (result.matchSummary) return result.matchSummary;
  if (result.matchType) {
    const labels = { name: '名称', feature: '特征', semantic: '语义', hybrid: '综合' };
    return labels[result.matchType] || '匹配';
  }
  const firstReason = (result.reasons || [])[0];
  return firstReason || '匹配';
}

function toPercent(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0) return '';
  const percent = Math.round(score <= 1 ? score * 100 : score);
  return Math.max(0, Math.min(100, percent));
}

function createSemanticPercentText(result) {
  const value = result.semanticPercent !== undefined && result.semanticPercent !== null
    ? result.semanticPercent
    : result.semanticScore;
  const percent = toPercent(value);
  return percent === '' ? '' : `语义 ${percent}%`;
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
      const photo = safeResult.matchedImageThumbFileId
        || safeResult.contentThumb
        || safeResult.containerThumb
        || safeResult.matchedImageFileId
        || safeResult.contentImage
        || safeResult.containerPhoto
        || '';
      const hasPhoto = !!photo && !isMockAssetPath(photo);
      const displayPhoto = hasPhoto && !imageDisplay.shouldResolveDisplayPath(photo) ? photo : '';
      this.setData({
        viewModel: {
          photo: displayPhoto,
          hasPhoto: !!displayPhoto,
          showPlaceholder: !displayPhoto,
          photoLabel: createPhotoLabel(safeResult),
          semanticPercentText: createSemanticPercentText(safeResult),
          matchSummary: createMatchSummary(safeResult),
          locationText: safeResult.locationText || '点击查看所在容器',
          reasons: (safeResult.reasons || []).slice(0, 2)
        }
      });
      if (hasPhoto && imageDisplay.shouldResolveDisplayPath(photo)) {
        imageDisplay.resolveImagePath(photo).then((displayPhotoPath) => {
          if (this.data.result !== safeResult) return;
          const resolvedPhoto = displayPhotoPath && !imageDisplay.shouldResolveDisplayPath(displayPhotoPath)
            ? displayPhotoPath
            : '';
          this.setData({
            viewModel: Object.assign({}, this.data.viewModel, {
              photo: resolvedPhoto,
              hasPhoto: !!resolvedPhoto,
              showPlaceholder: !resolvedPhoto
            })
          });
        });
      }
    }
  },

  data: {
    viewModel: {
      photo: '',
      hasPhoto: false,
      showPlaceholder: true,
      photoLabel: '',
      semanticPercentText: '',
      matchSummary: '',
      locationText: '',
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
