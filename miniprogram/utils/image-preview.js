const { isMockAssetPath } = require('./mock-assets');

function firstContentImage(container) {
  const images = (container && container.contentImages) || [];
  return images[0] || null;
}

function imageOriginal(image) {
  return image && image.fileId ? image.fileId : '';
}

function imageThumb(image) {
  return image && (image.thumbFileId || image.thumbnailFileId || image.previewFileId) ? (image.thumbFileId || image.thumbnailFileId || image.previewFileId) : '';
}

function safeImagePath(filePath) {
  return filePath && !isMockAssetPath(filePath) ? filePath : '';
}

function getImagePreview(image) {
  const original = safeImagePath(imageOriginal(image));
  const thumb = safeImagePath(imageThumb(image));
  return {
    original,
    thumb,
    display: thumb || original
  };
}

function getContainerPreview(container) {
  const contentImage = firstContentImage(container);
  const coverOriginal = safeImagePath(container && container.coverImageFileId);
  const coverThumb = safeImagePath(container && container.coverThumbFileId);
  const contentPreview = getImagePreview(contentImage);
  const legacyContentThumb = safeImagePath(container && container.contentThumbFileId);
  const legacyContentOriginal = safeImagePath(container && container.contentImageFileId);
  const contentThumb = contentPreview.thumb || legacyContentThumb;
  const contentOriginal = contentPreview.original || legacyContentOriginal;
  const original = coverOriginal || contentOriginal;
  const display = coverThumb || coverOriginal || contentThumb || contentOriginal;

  return {
    original,
    thumb: coverThumb || contentThumb,
    display,
    hasImage: !!(display || original)
  };
}

module.exports = {
  getContainerPreview,
  getImagePreview,
  safeImagePath
};
