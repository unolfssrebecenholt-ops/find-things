const cloudConfig = require('../config/cloud');

const DEFAULT_MAX_AGE_SECONDS = 60 * 60;
const CACHE_MARGIN_MS = 5 * 60 * 1000;
const tempUrlCache = {};

function hasWx() {
  return typeof wx !== 'undefined';
}

function isCloudFileId(filePath) {
  return /^cloud:\/\//.test(String(filePath || ''));
}

function isTcbTempUrl(filePath) {
  const value = String(filePath || '');
  if (!/^https?:\/\//.test(value)) return false;
  try {
    const url = new URL(value);
    return /\.tcb\.qcloud\.la$/.test(url.hostname);
  } catch (error) {
    return false;
  }
}

function cloudFileIdFromTempUrl(filePath) {
  const value = String(filePath || '');
  if (isCloudFileId(value)) return value;
  if (!isTcbTempUrl(value)) return '';
  try {
    const url = new URL(value);
    const bucket = url.hostname.replace(/\.tcb\.qcloud\.la$/, '');
    const objectPath = decodeURIComponent(url.pathname || '').replace(/^\/+/, '');
    if (!bucket || !objectPath || !cloudConfig.envId) return '';
    return `cloud://${cloudConfig.envId}.${bucket}/${objectPath}`;
  } catch (error) {
    return '';
  }
}

function shouldResolveDisplayPath(filePath) {
  return isCloudFileId(filePath) || isTcbTempUrl(filePath);
}

function pickDisplayPath(paths, resolvedPaths) {
  const resolved = resolvedPaths || {};
  const list = Array.isArray(paths) ? paths : [paths];
  for (let index = 0; index < list.length; index += 1) {
    const path = list[index];
    if (!path) continue;
    const resolvedPath = resolved[path];
    if (resolvedPath && !shouldResolveDisplayPath(resolvedPath)) return resolvedPath;
    if (!shouldResolveDisplayPath(path)) return path;
  }
  return '';
}

function getCache(fileId) {
  const cached = tempUrlCache[fileId];
  if (!cached || !cached.tempFileURL) return '';
  if (cached.expiresAt && cached.expiresAt - Date.now() <= CACHE_MARGIN_MS) return '';
  return cached.tempFileURL;
}

function setCache(fileId, tempFileURL, maxAgeSeconds) {
  if (!fileId || !tempFileURL) return;
  tempUrlCache[fileId] = {
    tempFileURL,
    expiresAt: Date.now() + (Number(maxAgeSeconds) || DEFAULT_MAX_AGE_SECONDS) * 1000
  };
}

function unique(values) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function hasResolvablePath(paths) {
  return (paths || []).some(shouldResolveDisplayPath);
}

function getTempFileURLs(fileIds, options) {
  const maxAge = Number(options && options.maxAge) || DEFAULT_MAX_AGE_SECONDS;
  const ids = unique(fileIds || []);
  if (!ids.length || !hasWx() || !wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') {
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    wx.cloud.getTempFileURL({
      fileList: ids.map((fileID) => ({ fileID, maxAge })),
      success: (result) => {
        const resolved = {};
        ((result && result.fileList) || []).forEach((file) => {
          const fileID = file && (file.fileID || file.fileId);
          const tempFileURL = file && (file.tempFileURL || file.tempFileUrl);
          if (!fileID || !tempFileURL) return;
          resolved[fileID] = tempFileURL;
          setCache(fileID, tempFileURL, maxAge);
        });
        resolve(resolved);
      },
      fail: () => resolve({})
    });
  });
}

function resolveImagePaths(paths, options) {
  const force = !!(options && options.force);
  const originals = unique(paths || []);
  const fileIdsByOriginal = {};
  const pendingFileIds = [];
  const resolved = {};

  originals.forEach((path) => {
    const fileId = cloudFileIdFromTempUrl(path);
    if (!fileId) {
      resolved[path] = path;
      return;
    }
    fileIdsByOriginal[path] = fileId;
    const cached = force ? '' : getCache(fileId);
    if (cached) {
      resolved[path] = cached;
      return;
    }
    pendingFileIds.push(fileId);
  });

  return getTempFileURLs(pendingFileIds, options).then((tempUrlsByFileId) => {
    originals.forEach((path) => {
      if (resolved[path]) return;
      const fileId = fileIdsByOriginal[path];
      resolved[path] = tempUrlsByFileId[fileId] || path;
    });
    return resolved;
  });
}

function resolveImagePath(path, options) {
  if (!path) return Promise.resolve('');
  return resolveImagePaths([path], options).then((resolved) => resolved[path] || path);
}

module.exports = {
  cloudFileIdFromTempUrl,
  isCloudFileId,
  isTcbTempUrl,
  hasResolvablePath,
  pickDisplayPath,
  resolveImagePath,
  resolveImagePaths,
  shouldResolveDisplayPath
};
