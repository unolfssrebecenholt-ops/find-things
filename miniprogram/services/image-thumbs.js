const imageStore = require('./image-store');
const storage = require('./storage');
const { safeImagePath } = require('../utils/image-preview');

function shouldCreateThumb(filePath, thumbPath) {
  return !!safeImagePath(filePath) && !safeImagePath(thumbPath);
}

function runSequential(tasks) {
  return tasks.reduce((chain, task) => {
    return chain.then((changed) => task().then((didChange) => changed || !!didChange));
  }, Promise.resolve(false));
}

function persistThumb(filePath) {
  return imageStore.persistThumbnail(filePath, 'find-things/thumbs').catch(() => '');
}

function updateContainer(containerId, patch) {
  if (!containerId) return Promise.resolve(false);
  if (typeof storage.updateContainerImageThumbsAsync === 'function') {
    return storage.updateContainerImageThumbsAsync(containerId, patch).then(() => true).catch(() => false);
  }
  if (typeof storage.updateContainerImageThumbs === 'function') {
    try {
      storage.updateContainerImageThumbs(containerId, patch);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.resolve(false);
    }
  }
  return Promise.resolve(false);
}

function ensureOneContainer(container) {
  if (!container || !container._id) return Promise.resolve(false);

  const patch = { contentImages: [] };
  const tasks = [];
  const coverFileId = container.coverImageFileId || '';
  if (shouldCreateThumb(coverFileId, container.coverThumbFileId)) {
    tasks.push(() => persistThumb(coverFileId).then((thumbFileId) => {
      if (!thumbFileId) return false;
      patch.coverThumbFileId = thumbFileId;
      return true;
    }));
  }

  (container.contentImages || []).forEach((image) => {
    if (!shouldCreateThumb(image && image.fileId, image && image.thumbFileId)) return;
    tasks.push(() => persistThumb(image.fileId).then((thumbFileId) => {
      if (!thumbFileId) return false;
      patch.contentImages.push({
        imageId: image.imageId || '',
        fileId: image.fileId || '',
        thumbFileId
      });
      return true;
    }));
  });

  if (!tasks.length) return Promise.resolve(false);

  return runSequential(tasks).then((changed) => {
    if (!changed) return false;
    return updateContainer(container._id, patch);
  });
}

function ensureContainerThumbnails(containers, options) {
  const limit = Number.isFinite(options && Number(options.limit))
    ? Math.max(1, Number(options.limit))
    : 6;
  const seen = {};
  const visibleContainers = (containers || []).filter((container) => {
    const id = container && container._id;
    if (!id || seen[id]) return false;
    seen[id] = true;
    return true;
  }).slice(0, limit);
  return runSequential(visibleContainers.map((container) => () => ensureOneContainer(container)))
    .catch(() => false);
}

module.exports = {
  ensureContainerThumbnails
};
