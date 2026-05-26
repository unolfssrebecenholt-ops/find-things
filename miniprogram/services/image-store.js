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

function persistImage(filePath, folder) {
  if (!filePath || isPersistentPath(filePath)) {
    return Promise.resolve(filePath || '');
  }
  if (hasWx() && wx.cloud && wx.cloud.uploadFile) {
    return cloudUpload(filePath, folder).catch(() => saveLocalFile(filePath));
  }
  return saveLocalFile(filePath);
}

module.exports = {
  persistImage,
  isPersistentPath
};
