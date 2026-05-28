function hasWx() {
  return typeof wx !== 'undefined';
}

function extensionFromPath(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.webp')) return 'webp';
  if (lower.endsWith('.gif')) return 'gif';
  return 'jpg';
}

function isPersistentPath(filePath) {
  const value = String(filePath || '');
  return /^cloud:\/\//.test(value)
    || (/^https?:\/\//.test(value) && !/^https?:\/\/(tmp|usr|localhost|127\.0\.0\.1)(\/|:|$)/.test(value))
    || /^wxfile:\/\/usr/.test(value);
}

function cloudUpload(filePath, folder) {
  if (!hasWx() || !wx.cloud || !wx.cloud.uploadFile) {
    return Promise.reject(new Error('cloud upload unavailable'));
  }
  const cloudPath = `${folder || 'find-things/images'}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extensionFromPath(filePath)}`;
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (result) => {
        if (result && result.fileID) {
          resolve(result.fileID);
          return;
        }
        reject(new Error('upload returned empty fileID'));
      },
      fail: reject
    });
  });
}

function saveLocalFile(filePath) {
  if (!hasWx() || !wx.saveFile) {
    return Promise.resolve(filePath);
  }
  return new Promise((resolve) => {
    wx.saveFile({
      tempFilePath: filePath,
      success: (result) => resolve(result.savedFilePath || filePath),
      fail: () => resolve(filePath)
    });
  });
}

function downloadCloudFile(filePath) {
  if (!hasWx() || !wx.cloud || !wx.cloud.downloadFile) {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    wx.cloud.downloadFile({
      fileID: filePath,
      success: (result) => resolve(result.tempFilePath || ''),
      fail: () => resolve('')
    });
  });
}

function downloadRemoteFile(filePath) {
  if (!hasWx() || !wx.downloadFile) {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    wx.downloadFile({
      url: filePath,
      success: (result) => {
        const statusCode = Number(result && result.statusCode);
        const ok = !statusCode || (statusCode >= 200 && statusCode < 300);
        resolve(ok ? (result.tempFilePath || '') : '');
      },
      fail: () => resolve('')
    });
  });
}

function getProcessableImagePath(filePath) {
  const value = String(filePath || '');
  if (!value) return Promise.resolve('');
  if (/^cloud:\/\//.test(value)) return downloadCloudFile(value);
  if (/^https?:\/\//.test(value)) return downloadRemoteFile(value);
  return Promise.resolve(value);
}

function compressImage(filePath, quality) {
  if (!filePath || !hasWx() || !wx.compressImage) {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    wx.compressImage({
      src: filePath,
      quality,
      success: (result) => resolve(result.tempFilePath || ''),
      fail: () => resolve('')
    });
  });
}

function prepareImageForAnalyze(filePath, options) {
  if (!filePath || isPersistentPath(filePath) || !hasWx() || !wx.compressImage) {
    return Promise.resolve(filePath || '');
  }
  const quality = Number.isFinite(options && Number(options.quality))
    ? Math.max(20, Math.min(90, Number(options.quality)))
    : 72;
  return new Promise((resolve) => {
    wx.compressImage({
      src: filePath,
      quality,
      success: (result) => resolve(result.tempFilePath || filePath),
      fail: () => resolve(filePath)
    });
  });
}

function prepareThumbnail(filePath, options) {
  const quality = Number.isFinite(options && Number(options.quality))
    ? Math.max(10, Math.min(70, Number(options.quality)))
    : 28;
  return getProcessableImagePath(filePath)
    .then((processablePath) => compressImage(processablePath, quality));
}

function persistImage(filePath, folder) {
  if (!filePath || isPersistentPath(filePath)) {
    return Promise.resolve(filePath || '');
  }
  if (hasWx() && wx.cloud && wx.cloud.uploadFile) {
    return cloudUpload(filePath, folder).catch(() => saveLocalFile(filePath));
  }
  return saveLocalFile(filePath);
}

function persistThumbnail(filePath, folder, options) {
  if (!filePath) return Promise.resolve('');
  return prepareThumbnail(filePath, options)
    .then((thumbnailPath) => {
      if (!thumbnailPath || thumbnailPath === filePath) return '';
      return persistImage(thumbnailPath, folder || 'find-things/thumbs').catch(() => '');
    })
    .catch(() => '');
}

module.exports = {
  persistImage,
  persistThumbnail,
  prepareThumbnail,
  prepareImageForAnalyze,
  isPersistentPath
};
