const CONTAINERS_KEY = 'findThings.containers';
const ITEMS_KEY = 'findThings.items';
const REMINDER_NOTICES_KEY = 'findThings.reminderNotices';
const cloudConfig = require('../config/cloud');
const expiryReminder = require('./expiry-reminder');
const imageDisplay = require('./image-display');

const CONTAINER_LIMIT = 3;
const CONTENT_IMAGE_LIMIT = 5;
const REMINDER_NOTICE_STATUSES = ['pending', 'read', 'dismissed', 'resolved'];

function now() {
  return Date.now();
}

function createId(prefix) {
  return `${prefix}_${now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function firstText(values) {
  const list = Array.isArray(values) ? values : [values];
  for (let index = 0; index < list.length; index += 1) {
    const value = list[index];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function finiteNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stableHashId(prefix, value) {
  const text = String(value || 'empty');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) >>> 0;
  }
  return `${prefix}_${hash.toString(36)}`;
}

function stableImageId(fileId) {
  return stableHashId('legacy_image', fileId);
}

function getItemDisplayName(rawItem) {
  if (typeof rawItem === 'string') return rawItem.trim();
  return firstText([
    rawItem && rawItem.displayName,
    rawItem && rawItem.display_name,
    rawItem && rawItem.name,
    rawItem && rawItem.itemName,
    rawItem && rawItem.item_name,
    rawItem && rawItem.objectName,
    rawItem && rawItem.object_name,
    rawItem && rawItem.title,
    rawItem && rawItem.label,
    rawItem && rawItem.text,
    rawItem && rawItem.value,
    rawItem && rawItem.productName,
    rawItem && rawItem.product_name,
    rawItem && rawItem.nameZh,
    rawItem && rawItem.cnName
  ]);
}

function getItemContainerId(item) {
  return firstText([
    item && item.containerId,
    item && item.containerID,
    item && item.container_id,
    item && item.boxId,
    item && item.boxID,
    item && item.box_id,
    item && item.parentId,
    item && item.parent_id,
    item && item.ownerContainerId,
    item && item.owner_container_id,
    item && item.targetContainerId,
    item && item.container && item.container._id,
    item && item.container && item.container.id,
    item && item.box && item.box._id,
    item && item.box && item.box.id
  ]);
}

function itemBelongsToContainer(item, containerId) {
  return getItemContainerId(item) === String(containerId || '');
}

function getItemSourceImageId(item) {
  return firstText([
    item && item.sourceImageId,
    item && item.source_image_id,
    item && item.imageId,
    item && item.imageID,
    item && item.image_id,
    item && item.photoId,
    item && item.photo_id
  ]);
}

function getItemSourceImageFileId(item) {
  return firstText([
    item && item.sourceImageFileId,
    item && item.source_image_file_id,
    item && item.imageFileId,
    item && item.imageFileID,
    item && item.fileID,
    item && item.fileId,
    item && item.imageUrl,
    item && item.imagePath,
    item && item.path
  ]);
}

function stableEmbeddedItemId(containerId, rawItem, index) {
  return stableHashId('legacy_item', [
    containerId,
    rawItem && (rawItem._id || rawItem.tempId || rawItem.itemKey || ''),
    getItemDisplayName(rawItem),
    getItemSourceImageId(rawItem),
    getItemSourceImageFileId(rawItem),
    index + 1
  ].join('|'));
}

function getWxAdapter() {
  if (typeof wx !== 'undefined') {
    return wx;
  }
  const memory = {};
  return {
    getStorageSync(key) {
      return memory[key];
    },
    setStorageSync(key, value) {
      memory[key] = value;
    },
    removeStorageSync(key) {
      delete memory[key];
    }
  };
}

function readArray(adapter, key) {
  const value = adapter.getStorageSync(key);
  return Array.isArray(value) ? value : [];
}

function writeArray(adapter, key, value) {
  adapter.setStorageSync(key, Array.isArray(value) ? value : []);
}

function hasCloudDatabase() {
  return typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.database === 'function';
}

function stripDatabaseSystemFields(record) {
  const value = Object.assign({}, record);
  delete value._id;
  delete value._openid;
  return value;
}

function collectionName(name) {
  return cloudConfig.collections[name];
}

function getDatabase() {
  if (!hasCloudDatabase()) return null;
  return wx.cloud.database();
}

function getCollection(name) {
  const db = getDatabase();
  return db ? db.collection(collectionName(name)) : null;
}

function callMaybePromise(request, fallback) {
  if (request && typeof request.then === 'function') return request;
  if (request && typeof request === 'object') {
    return Promise.resolve(request);
  }
  return Promise.resolve(fallback);
}

function getCollectionPage(collection, skip, limit) {
  if (!collection) return Promise.resolve([]);
  const query = typeof collection.skip === 'function' ? collection.skip(skip) : collection;
  const limited = query && typeof query.limit === 'function' ? query.limit(limit) : query;
  if (!limited || typeof limited.get !== 'function') return Promise.resolve([]);
  return callMaybePromise(limited.get(), { data: [] }).then((result) => result.data || []);
}

function getAllFromCollection(collection) {
  const limit = 100;
  const read = (skip, rows) => getCollectionPage(collection, skip, limit).then((page) => {
    const nextRows = rows.concat(page);
    if (page.length < limit) return nextRows;
    return read(skip + limit, nextRows);
  });
  return read(0, []);
}

function upsertDocument(collection, record) {
  if (!collection || !record || !record._id || typeof collection.doc !== 'function') {
    return Promise.resolve();
  }
  const doc = collection.doc(record._id);
  if (doc && typeof doc.set === 'function') {
    return callMaybePromise(doc.set({ data: stripDatabaseSystemFields(record) }));
  }
  return Promise.resolve();
}

function getContentImageFileId(input) {
  if (typeof input === 'string') return input;
  const fileId = firstText([
    input && input.fileId,
    input && input.fileID,
    input && input.imageFileId,
    input && input.imageFileID,
    input && input.cloudFileId,
    input && input.cloud_file_id,
    input && input.url,
    input && input.imageUrl,
    input && input.imagePath,
    input && input.path,
    input && input.tempFilePath
  ]);
  return imageDisplay.cloudFileIdFromTempUrl(fileId) || fileId;
}

function getContentImageId(input, index) {
  if (typeof input === 'string') return stableImageId(input);
  return firstText([
    input && input.imageId,
    input && input.imageID,
    input && input.image_id,
    input && input.photoId,
    input && input.photo_id,
    input && input.id,
    input && input._id
  ]) || stableImageId(`${getContentImageFileId(input)}|${index + 1}`);
}

function getContentImageThumbFileId(input) {
  if (typeof input === 'string') return '';
  const fileId = firstText([
    input && input.thumbFileId,
    input && input.thumbnailFileId,
    input && input.previewFileId,
    input && input.thumb_file_id,
    input && input.thumbnail_file_id,
    input && input.preview_file_id
  ]);
  return imageDisplay.cloudFileIdFromTempUrl(fileId) || fileId;
}

function createContentImage(input, index, timestamp) {
  const fileId = getContentImageFileId(input);
  return {
    imageId: getContentImageId(input, index),
    fileId,
    thumbFileId: getContentImageThumbFileId(input),
    label: firstText([input && input.label, input && input.name, input && input.title]) || `箱内照片 ${index + 1}`,
    sortOrder: finiteNumber(input && input.sortOrder, index),
    createdAt: finiteNumber(input && input.createdAt, timestamp),
    itemCount: finiteNumber(input && input.itemCount, finiteNumber(input && input.count, 0)),
    orientation: firstText(input && input.orientation),
    width: finiteNumber(input && input.width, 0),
    height: finiteNumber(input && input.height, 0),
    analyzeStatus: firstText([input && input.analyzeStatus, input && input.analysisStatus]),
    analyzedAt: finiteNumber(input && input.analyzedAt, 0)
  };
}

function normalizeContentImages(input, timestamp) {
  const candidates = [];
  if (Array.isArray(input.contentImages) && input.contentImages.length) {
    candidates.push(...input.contentImages);
  } else if (Array.isArray(input.contentImageFileIds) && input.contentImageFileIds.length) {
    candidates.push(...input.contentImageFileIds);
  } else if (Array.isArray(input.imageFileIds) && input.imageFileIds.length) {
    candidates.push(...input.imageFileIds);
  } else if (Array.isArray(input.images) && input.images.length) {
    candidates.push(...input.images);
  } else if (Array.isArray(input.photos) && input.photos.length) {
    candidates.push(...input.photos);
  } else if (input.contentImageFileId || input.contentImageFileID || input.imageFileId) {
    candidates.push({
      fileId: input.contentImageFileId || input.contentImageFileID || input.imageFileId,
      thumbFileId: input.contentThumbFileId || ''
    });
  }
  return candidates
    .filter((image) => typeof image === 'string' ? image : image && getContentImageFileId(image))
    .map((image, index) => createContentImage(image, index, timestamp));
}

function findSourceImage(rawItem, container) {
  const images = container.contentImages || [];
  const sourceImageId = getItemSourceImageId(rawItem);
  const sourceImageFileId = getItemSourceImageFileId(rawItem);
  return images.find((image) => sourceImageId && image.imageId === sourceImageId)
    || images.find((image) => sourceImageFileId && image.fileId === sourceImageFileId)
    || images[0]
    || null;
}

function normalizeItem(rawItem, container, timestamp, previousItem) {
  const itemId = rawItem._id || createId('item');
  const sourceImage = findSourceImage(rawItem, container);
  const sourceImageIndex = sourceImage
    ? (container.contentImages || []).findIndex((image) => image.imageId === sourceImage.imageId)
    : -1;
  const sourceImageLabel = sourceImage
    ? (sourceImage.label || `照片 ${sourceImageIndex + 1}`)
    : '';
  const relativePosition = firstText([
    rawItem.relativePosition,
    rawItem.positionText,
    rawItem.position_text,
    rawItem.position
  ]);
  const locationText = (rawItem.locationText || [sourceImageLabel, relativePosition].filter(Boolean).join(' · ')).trim();
  return expiryReminder.normalizeReminderFields(Object.assign({}, rawItem, {
    _id: itemId,
    containerId: container._id,
    sourceImageId: sourceImage ? sourceImage.imageId : getItemSourceImageId(rawItem),
    sourceImageFileId: sourceImage ? sourceImage.fileId : (getItemSourceImageFileId(rawItem) || container.contentImageFileId || ''),
    sourceImageIndex: sourceImageIndex >= 0 ? sourceImageIndex : 0,
    sourceImageLabel,
    relativePosition,
    locationText,
    confirmed: rawItem.confirmed !== false,
    createdAt: rawItem.createdAt || timestamp,
    updatedAt: timestamp,
    deletedAt: null
  }), timestamp, previousItem);
}

function normalizeRawEmbeddedItem(rawItem) {
  if (typeof rawItem === 'string') return { displayName: rawItem };
  return rawItem || {};
}

function collectEmbeddedItemLists(source) {
  if (!source) return [];
  if (Array.isArray(source)) return [source];
  const directFields = [
    'items',
    'inventoryItems',
    'recognizedItems',
    'detectedItems',
    'itemList',
    'inventory',
    'objects',
    'detections',
    'labels',
    'results'
  ];
  const nestedFields = [
    'result',
    'analysis',
    'analyzed',
    'aiResult',
    'analyzeResult',
    'analysisResult',
    'recognitionResult',
    'payload',
    'data'
  ];
  const lists = [];
  directFields.forEach((field) => {
    if (Array.isArray(source[field]) && source[field].length) {
      lists.push(source[field]);
    }
  });
  nestedFields.forEach((field) => {
    const nested = source[field];
    if (nested && nested !== source) {
      collectEmbeddedItemLists(nested).forEach((list) => lists.push(list));
    }
  });
  return lists;
}

function getEmbeddedItems(container) {
  if (!container) return [];
  const containerItems = collectEmbeddedItemLists(container).reduce((items, list) => items.concat(list), []);
  const contentImageItems = (container.contentImages || []).reduce((items, image, imageIndex) => {
    const imageId = getContentImageId(image, imageIndex);
    const fileId = getContentImageFileId(image);
    const label = firstText([image && image.label, image && image.name]) || `照片 ${imageIndex + 1}`;
    const imageItems = collectEmbeddedItemLists(image).reduce((result, list) => result.concat(list), []);
    return items.concat(imageItems.map((rawItem) => {
      const item = normalizeRawEmbeddedItem(rawItem);
      return Object.assign({}, item, {
        sourceImageId: getItemSourceImageId(item) || imageId,
        sourceImageFileId: getItemSourceImageFileId(item) || fileId,
        sourceImageIndex: Number.isFinite(item.sourceImageIndex) ? item.sourceImageIndex : imageIndex,
        sourceImageLabel: item.sourceImageLabel || label
      });
    }));
  }, []);
  return containerItems.concat(contentImageItems);
}

function normalizeEmbeddedItems(container, timestamp) {
  const readContainer = Object.assign({}, container, {
    contentImages: normalizeContentImages(container, timestamp)
  });
  return getEmbeddedItems(container)
    .map(normalizeRawEmbeddedItem)
    .map((item) => Object.assign({}, item, {
      displayName: getItemDisplayName(item),
      category: item.category || item.type || ''
    }))
    .filter((item) => item && item.displayName && item.confirmed !== false && !item.deletedAt)
    .map((item, index) => normalizeItem(Object.assign({}, item, {
      _id: item._id || stableEmbeddedItemId(container._id, item, index)
    }), readContainer, timestamp));
}

function refreshContentImageCounts(container, items) {
  const countByImageId = (items || []).reduce((counts, item) => {
    if (item.sourceImageId) {
      counts[item.sourceImageId] = (counts[item.sourceImageId] || 0) + 1;
    }
    return counts;
  }, {});
  const contentImages = (container.contentImages || []).map((image, index) => Object.assign({}, image, {
    sortOrder: Number.isFinite(image.sortOrder) ? image.sortOrder : index,
    itemCount: countByImageId[image.imageId] || 0
  }));
  return Object.assign({}, container, {
    contentImages,
    contentImageFileId: contentImages[0] ? contentImages[0].fileId : '',
    contentThumbFileId: contentImages[0] ? (contentImages[0].thumbFileId || '') : '',
    itemCount: (items || []).length
  });
}

function isMockAssetPath(filePath) {
  return typeof filePath === 'string' && filePath.indexOf('/assets/mock-') === 0;
}

function isDemoImage(image) {
  if (!image) return false;
  return String(image.imageId || '').indexOf('demo_') === 0
    || isMockAssetPath(image.fileId);
}

function isDemoContainer(container) {
  if (!container) return false;
  if (container.demo === true || container.source === 'demo') return true;
  if (isMockAssetPath(container.coverImageFileId) || isMockAssetPath(container.contentImageFileId)) return true;
  return (container.contentImages || []).some(isDemoImage);
}

function isDemoItem(item) {
  if (!item) return false;
  return item.demo === true
    || item.source === 'demo'
    || String(item.sourceImageId || '').indexOf('demo_') === 0
    || isMockAssetPath(item.sourceImageFileId);
}

function isItemFromImage(item, image) {
  return (image.imageId && item.sourceImageId === image.imageId)
    || (image.fileId && item.sourceImageFileId === image.fileId);
}

function mergeMissingRecords(primary, fallback) {
  const seen = (primary || []).reduce((ids, record) => {
    if (record && record._id) ids[record._id] = true;
    return ids;
  }, {});
  return (primary || []).concat((fallback || []).filter((record) => {
    return record && record._id && !seen[record._id];
  }));
}

function dedupeRecords(records) {
  const seen = {};
  return (records || []).filter((record) => {
    if (!record || !record._id) return false;
    if (seen[record._id]) return false;
    seen[record._id] = true;
    return true;
  });
}

function normalizeStoredItem(item) {
  const normalized = Object.assign({}, normalizeRawEmbeddedItem(item));
  const containerId = getItemContainerId(normalized);
  const displayName = getItemDisplayName(normalized);
  if (containerId) normalized.containerId = containerId;
  if (displayName && !normalized.displayName) normalized.displayName = displayName;
  if (!normalized.category && normalized.type) normalized.category = normalized.type;
  return expiryReminder.normalizeReminderFields(normalized);
}

function normalizeStoredItems(items) {
  return (items || []).filter(Boolean).map(normalizeStoredItem);
}

function normalizeReminderNotice(notice) {
  const value = Object.assign({}, notice || {});
  const rawStatus = firstText(value.status);
  const status = REMINDER_NOTICE_STATUSES.indexOf(rawStatus) >= 0 ? rawStatus : 'pending';
  const pushStatus = ['sent', 'failed', 'none'].indexOf(value.pushStatus) >= 0 ? value.pushStatus : 'none';
  return Object.assign({}, value, {
    _id: firstText([value._id, value.id]),
    type: firstText(value.type) || 'expiry',
    itemId: firstText([value.itemId, value.item_id]),
    containerId: firstText([value.containerId, value.container_id]),
    displayName: firstText([value.displayName, value.name, value.itemName]) || '物品',
    message: firstText(value.message) || `${firstText([value.displayName, value.name, value.itemName]) || '物品'} 已过期，请及时处理。`,
    status,
    pushStatus,
    channel: firstText(value.channel) || (pushStatus === 'sent' ? 'subscribe' : 'inApp'),
    expiresAt: finiteNumber(value.expiresAt, 0),
    remindAt: finiteNumber(value.remindAt, 0),
    containerName: firstText([value.containerName, value.boxName]),
    locationPath: firstText([value.locationPath, value.containerLocation]),
    locationText: firstText(value.locationText),
    thumbFileId: firstText([value.thumbFileId, value.sourceImageThumbFileId, value.contentThumbFileId]),
    sourceImageFileId: firstText(value.sourceImageFileId),
    contentImageFileId: firstText(value.contentImageFileId),
    contentThumbFileId: firstText(value.contentThumbFileId),
    sentAt: finiteNumber(value.sentAt, 0),
    readAt: finiteNumber(value.readAt, 0),
    dismissedAt: finiteNumber(value.dismissedAt, 0),
    dismissedReason: firstText(value.dismissedReason),
    resolvedAt: finiteNumber(value.resolvedAt, 0),
    resolvedReason: firstText(value.resolvedReason),
    createdAt: finiteNumber(value.createdAt, 0),
    updatedAt: finiteNumber(value.updatedAt, 0),
    lastError: firstText(value.lastError)
  });
}

function normalizeReminderNotices(notices) {
  return (notices || []).filter(Boolean).map(normalizeReminderNotice).filter((notice) => notice._id);
}

function createStorageService(adapter) {
  const storage = adapter || getWxAdapter();
  let databaseReady = false;

  function listContainers() {
    return readArray(storage, CONTAINERS_KEY)
      .filter((container) => !container.deletedAt)
      .map((container) => {
        const contentImages = normalizeContentImages(container, container.updatedAt || now());
        return Object.assign({}, container, {
          contentImages,
          contentImageFileId: contentImages[0] ? contentImages[0].fileId : (container.contentImageFileId || ''),
          contentThumbFileId: contentImages[0] ? (contentImages[0].thumbFileId || '') : (container.contentThumbFileId || '')
        });
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function listItems() {
    const storedItems = normalizeStoredItems(readArray(storage, ITEMS_KEY));
    const persistedItems = storedItems.filter((item) => !item.deletedAt);
    const containersWithPersistedItems = storedItems.reduce((ids, item) => {
      const containerId = getItemContainerId(item);
      if (containerId) ids[containerId] = true;
      return ids;
    }, {});
    const embeddedItems = readArray(storage, CONTAINERS_KEY)
      .filter((container) => !container.deletedAt && !containersWithPersistedItems[container._id])
      .reduce((items, container) => items.concat(normalizeEmbeddedItems(container, container.updatedAt || now())), []);
    return dedupeRecords(persistedItems.concat(embeddedItems));
  }

  function listDeletedStoredItems() {
    return normalizeStoredItems(readArray(storage, ITEMS_KEY)).filter((item) => item.deletedAt);
  }

  function listReminderNotices() {
    return normalizeReminderNotices(readArray(storage, REMINDER_NOTICES_KEY))
      .sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));
  }

  function listPendingReminderNotices() {
    return listReminderNotices().filter((notice) => notice.status === 'pending');
  }

  function listUserContainers() {
    return listContainers().filter((container) => !isDemoContainer(container));
  }

  function listUserItems() {
    const userContainerIds = listUserContainers().reduce((ids, container) => {
      ids[container._id] = true;
      return ids;
    }, {});
    return listItems().filter((item) => userContainerIds[getItemContainerId(item)] && !isDemoItem(item));
  }

  function createIdSet(ids) {
    return (ids || []).reduce((map, id) => {
      const value = firstText(id);
      if (value) map[value] = true;
      return map;
    }, {});
  }

  function hasSetValues(map) {
    return Object.keys(map || {}).length > 0;
  }

  function noticeMatchesDismissTarget(notice, itemIds, containerIds) {
    const itemId = firstText(notice && notice.itemId);
    const containerId = firstText(notice && notice.containerId);
    return !!((itemId && itemIds[itemId]) || (containerId && containerIds[containerId]));
  }

  function dismissReminderNotices(options, timestamp) {
    const itemIds = createIdSet(options && options.itemIds);
    const containerIds = createIdSet(options && options.containerIds);
    if (!hasSetValues(itemIds) && !hasSetValues(containerIds)) {
      return { dismissedCount: 0, notices: [] };
    }

    const dismissedAt = finiteNumber(timestamp, now());
    const dismissedReason = firstText(options && options.reason) || 'source_deleted';
    const dismissedNotices = [];
    const notices = normalizeReminderNotices(readArray(storage, REMINDER_NOTICES_KEY)).map((notice) => {
      if (!notice || notice.status !== 'pending' || !noticeMatchesDismissTarget(notice, itemIds, containerIds)) {
        return notice;
      }
      const dismissed = Object.assign({}, notice, {
        status: 'dismissed',
        dismissedAt,
        dismissedReason,
        updatedAt: dismissedAt
      });
      dismissedNotices.push(dismissed);
      return dismissed;
    });

    if (dismissedNotices.length) {
      writeArray(storage, REMINDER_NOTICES_KEY, notices);
    }

    return {
      dismissedCount: dismissedNotices.length,
      notices: dismissedNotices.map(normalizeReminderNotice)
    };
  }

  function canUseDatabase() {
    return !adapter && hasCloudDatabase();
  }

  function isDatabaseAvailable() {
    return canUseDatabase();
  }

  function cacheDatabaseRows(containers, items, reminderNotices) {
    writeArray(storage, CONTAINERS_KEY, containers || []);
    writeArray(storage, ITEMS_KEY, normalizeStoredItems(items || []));
    writeArray(storage, REMINDER_NOTICES_KEY, normalizeReminderNotices(reminderNotices || []));
  }

  function loadFromDatabase() {
    if (!canUseDatabase()) {
      databaseReady = true;
      return Promise.resolve({ containers: listContainers(), items: listItems(), reminderNotices: listReminderNotices() });
    }
    const containersCollection = getCollection('containers');
    const itemsCollection = getCollection('items');
    const reminderNoticesCollection = getCollection('reminderNotices');
    return Promise.all([
      getAllFromCollection(containersCollection),
      getAllFromCollection(itemsCollection),
      getAllFromCollection(reminderNoticesCollection)
    ]).then(([containers, items, reminderNotices]) => {
      const cloudContainers = (containers || []).filter((container) => !container.deletedAt && !isDemoContainer(container));
      const cloudItems = normalizeStoredItems(items || []);
      const cloudReminderNotices = normalizeReminderNotices(reminderNotices || []);
      const localContainers = readArray(storage, CONTAINERS_KEY)
        .filter((container) => !container.deletedAt && !isDemoContainer(container));
      const localContainerIds = localContainers.reduce((ids, container) => {
        ids[container._id] = true;
        return ids;
      }, {});
      const cloudContainerIds = cloudContainers.reduce((ids, container) => {
        ids[container._id] = true;
        return ids;
      }, {});
      const availableContainerIds = Object.assign({}, localContainerIds, cloudContainerIds);
      const localItems = readArray(storage, ITEMS_KEY)
        .map(normalizeStoredItem)
        .filter((item) => !item.deletedAt && availableContainerIds[getItemContainerId(item)] && !isDemoItem(item));
      const localReminderNotices = normalizeReminderNotices(readArray(storage, REMINDER_NOTICES_KEY));
      const mergedContainers = mergeMissingRecords(cloudContainers, localContainers);
      const mergedContainerIds = mergedContainers.reduce((ids, container) => {
        if (container && container._id && !container.deletedAt) ids[container._id] = true;
        return ids;
      }, {});
      const mergeableLocalItems = localItems.filter((item) => mergedContainerIds[getItemContainerId(item)]);
      const mergedItems = mergeMissingRecords(cloudItems, mergeableLocalItems);
      const mergedReminderNotices = mergeMissingRecords(cloudReminderNotices, localReminderNotices);
      const hasLocalFallbackRows = mergedContainers.length > cloudContainers.length
        || mergedItems.length > cloudItems.length
        || mergedReminderNotices.length > cloudReminderNotices.length;
      if (hasLocalFallbackRows) {
        return persistRecords(mergedContainers, mergedItems, mergedReminderNotices).then(() => {
          cacheDatabaseRows(mergedContainers, mergedItems, mergedReminderNotices);
          databaseReady = true;
          return { containers: listContainers(), items: listItems(), reminderNotices: listReminderNotices() };
        });
      }
      cacheDatabaseRows(mergedContainers, mergedItems, mergedReminderNotices);
      databaseReady = true;
      return { containers: listContainers(), items: listItems(), reminderNotices: listReminderNotices() };
    });
  }

  function ensureDatabaseLoaded() {
    if (databaseReady || !canUseDatabase()) return Promise.resolve();
    return loadFromDatabase().then(() => {});
  }

  function getContainer(id) {
    return listContainers().find((container) => container._id === id) || null;
  }

  function getItemsByContainer(id) {
    return listItems().filter((item) => itemBelongsToContainer(item, id));
  }

  function saveContainer(input) {
    const timestamp = now();
    const existingContainer = input._id ? getContainer(input._id) : null;
    if (!existingContainer && listUserContainers().length >= CONTAINER_LIMIT) {
      const error = new Error(`最多可保存 ${CONTAINER_LIMIT} 个箱子。`);
      error.code = 'CONTAINER_LIMIT_REACHED';
      error.limit = CONTAINER_LIMIT;
      throw error;
    }
    let container = {
      _id: input._id || createId('container'),
      name: (input.name || '未命名容器').trim() || '未命名容器',
      locationPath: (input.locationPath || '').trim(),
      coverImageFileId: imageDisplay.cloudFileIdFromTempUrl(input.coverImageFileId) || input.coverImageFileId || '',
      coverThumbFileId: imageDisplay.cloudFileIdFromTempUrl(input.coverThumbFileId) || input.coverThumbFileId || '',
      contentImages: normalizeContentImages(input, timestamp),
      contentImageFileId: '',
      contentThumbFileId: '',
      itemCount: 0,
      createdAt: input.createdAt || timestamp,
      updatedAt: timestamp,
      deletedAt: null
    };
    container.contentImageFileId = container.contentImages[0] ? container.contentImages[0].fileId : '';
    container.contentThumbFileId = container.contentImages[0] ? (container.contentImages[0].thumbFileId || '') : '';
    if (container.contentImages.length > CONTENT_IMAGE_LIMIT) {
      const error = new Error(`最多可保存 ${CONTENT_IMAGE_LIMIT} 张箱内照片。`);
      error.code = 'CONTENT_IMAGE_LIMIT_REACHED';
      error.limit = CONTENT_IMAGE_LIMIT;
      throw error;
    }

    const previousItems = listItems().filter((item) => itemBelongsToContainer(item, container._id));
    const previousItemsById = previousItems
      .reduce((itemsById, item) => {
        itemsById[item._id] = item;
        return itemsById;
      }, {});
    const items = (input.items || [])
      .filter((item) => item.confirmed !== false)
      .map((item) => normalizeItem(item, container, timestamp, item._id ? previousItemsById[item._id] : null));
    container = refreshContentImageCounts(container, items);
    const activeIds = items.reduce((ids, item) => {
      ids[item._id] = true;
      return ids;
    }, {});
    const removedItems = previousItems
      .filter((item) => !activeIds[item._id])
      .map((item) => Object.assign({}, item, { deletedAt: timestamp, updatedAt: timestamp }));

    const otherContainers = listContainers().filter((item) => item._id !== container._id);
    const otherItems = listItems().filter((item) => !itemBelongsToContainer(item, container._id));
    writeArray(storage, CONTAINERS_KEY, [container].concat(otherContainers));
    writeArray(storage, ITEMS_KEY, dedupeRecords(items.concat(otherItems, removedItems, listDeletedStoredItems())));
    const reminderDismissal = dismissReminderNotices({
      itemIds: removedItems.map((item) => item._id),
      reason: 'item_deleted'
    }, timestamp);
    return {
      container,
      items,
      removedItems,
      reminderNotices: reminderDismissal.notices,
      dismissedReminderCount: reminderDismissal.dismissedCount
    };
  }

  function getContentImages(containerId) {
    const container = getContainer(containerId);
    return container ? (container.contentImages || []).slice() : [];
  }

  function addContentImage(containerId, imageInput) {
    const timestamp = now();
    const containers = readArray(storage, CONTAINERS_KEY);
    const target = containers.find((container) => container._id === containerId && !container.deletedAt);
    if (!target) throw new Error('容器不存在');

    const existing = normalizeContentImages(target, timestamp);
    if (existing.length >= CONTENT_IMAGE_LIMIT) {
      const error = new Error(`最多可保存 ${CONTENT_IMAGE_LIMIT} 张箱内照片。`);
      error.code = 'CONTENT_IMAGE_LIMIT_REACHED';
      error.limit = CONTENT_IMAGE_LIMIT;
      throw error;
    }

    const updatedContainer = Object.assign({}, target, {
      contentImages: existing.concat(createContentImage(imageInput || {}, existing.length, timestamp)),
      updatedAt: timestamp
    });
    updatedContainer.contentImageFileId = updatedContainer.contentImages[0] ? updatedContainer.contentImages[0].fileId : '';
    updatedContainer.contentThumbFileId = updatedContainer.contentImages[0] ? (updatedContainer.contentImages[0].thumbFileId || '') : '';

    writeArray(storage, CONTAINERS_KEY, containers.map((container) => (
      container._id === containerId ? updatedContainer : container
    )));
    return updatedContainer;
  }

  function updateContainerImageThumbs(containerId, thumbPatch) {
    const containers = readArray(storage, CONTAINERS_KEY);
    const target = containers.find((container) => container._id === containerId && !container.deletedAt);
    if (!target) throw new Error('容器不存在');

    const requestedImages = (thumbPatch && thumbPatch.contentImages) || [];
    const contentImages = normalizeContentImages(target, target.updatedAt || now()).map((image) => {
      const match = requestedImages.find((candidate) => {
        return (candidate.imageId && image.imageId === candidate.imageId)
          || (candidate.fileId && image.fileId === candidate.fileId);
      });
      if (!match || !match.thumbFileId) return image;
      return Object.assign({}, image, { thumbFileId: match.thumbFileId });
    });
    const updatedContainer = Object.assign({}, target, {
      coverThumbFileId: (thumbPatch && thumbPatch.coverThumbFileId) || target.coverThumbFileId || '',
      contentImages,
      contentImageFileId: contentImages[0] ? contentImages[0].fileId : (target.contentImageFileId || ''),
      contentThumbFileId: contentImages[0] ? (contentImages[0].thumbFileId || '') : (target.contentThumbFileId || '')
    });

    writeArray(storage, CONTAINERS_KEY, containers.map((container) => (
      container._id === containerId ? updatedContainer : container
    )));
    return updatedContainer;
  }

  function replaceItemsForImage(containerId, imageId, items) {
    const timestamp = now();
    const containers = readArray(storage, CONTAINERS_KEY);
    const target = containers.find((container) => container._id === containerId && !container.deletedAt);
    if (!target) throw new Error('容器不存在');

    const container = Object.assign({}, target, {
      contentImages: normalizeContentImages(target, timestamp),
      contentImageFileId: target.contentImageFileId || '',
      contentThumbFileId: target.contentThumbFileId || ''
    });
    const image = container.contentImages.find((contentImage) => contentImage.imageId === imageId);
    if (!image) throw new Error('箱内照片不存在');

    const activeItems = listItems();
    const keptContainerItems = activeItems.filter((item) => itemBelongsToContainer(item, containerId) && !isItemFromImage(item, image));
    const otherItems = activeItems.filter((item) => !itemBelongsToContainer(item, containerId));
    const previousItemsById = activeItems
      .filter((item) => itemBelongsToContainer(item, containerId))
      .reduce((itemsById, item) => {
        itemsById[item._id] = item;
        return itemsById;
      }, {});
    const replacementItems = (items || [])
      .filter((item) => item.confirmed !== false)
      .map((item) => normalizeItem(Object.assign({}, item, {
        sourceImageId: image.imageId,
        sourceImageFileId: image.fileId
      }), container, timestamp, item._id ? previousItemsById[item._id] : null));
    const nextContainerItems = replacementItems.concat(keptContainerItems);
    const updatedContainer = refreshContentImageCounts(Object.assign({}, container, { updatedAt: timestamp }), nextContainerItems);
    const activeIds = nextContainerItems.reduce((ids, item) => {
      ids[item._id] = true;
      return ids;
    }, {});
    const removedItems = activeItems
      .filter((item) => itemBelongsToContainer(item, containerId) && !activeIds[item._id])
      .map((item) => Object.assign({}, item, { deletedAt: timestamp, updatedAt: timestamp }));

    writeArray(storage, CONTAINERS_KEY, [updatedContainer].concat(containers.filter((item) => item._id !== containerId)));
    writeArray(storage, ITEMS_KEY, dedupeRecords(nextContainerItems.concat(otherItems, removedItems, listDeletedStoredItems())));
    const reminderDismissal = dismissReminderNotices({
      itemIds: removedItems.map((item) => item._id),
      reason: 'item_deleted'
    }, timestamp);
    return {
      container: updatedContainer,
      items: nextContainerItems,
      removedItems,
      reminderNotices: reminderDismissal.notices,
      dismissedReminderCount: reminderDismissal.dismissedCount
    };
  }

  function deleteContainer(id) {
    const timestamp = now();
    const containerItems = listItems().filter((item) => itemBelongsToContainer(item, id));
    const containers = readArray(storage, CONTAINERS_KEY).map((container) => {
      if (container._id !== id) return container;
      return Object.assign({}, container, { deletedAt: timestamp, updatedAt: timestamp });
    });
    const items = readArray(storage, ITEMS_KEY).map((item) => {
      if (!itemBelongsToContainer(item, id)) return item;
      return Object.assign({}, item, { deletedAt: timestamp, updatedAt: timestamp });
    });
    writeArray(storage, CONTAINERS_KEY, containers);
    writeArray(storage, ITEMS_KEY, items);
    const reminderDismissal = dismissReminderNotices({
      containerIds: [id],
      itemIds: containerItems.map((item) => item._id),
      reason: 'container_deleted'
    }, timestamp);
    return {
      container: containers.find((container) => container._id === id) || null,
      items: items.filter((item) => itemBelongsToContainer(item, id)),
      reminderNotices: reminderDismissal.notices,
      dismissedReminderCount: reminderDismissal.dismissedCount
    };
  }

  function deleteContainers(ids) {
    const selected = (ids || []).reduce((map, id) => {
      if (id) map[id] = true;
      return map;
    }, {});
    const timestamp = now();
    const selectedItems = listItems().filter((item) => selected[getItemContainerId(item)]);
    let deletedCount = 0;
    const containers = readArray(storage, CONTAINERS_KEY).map((container) => {
      if (!selected[container._id] || container.deletedAt) return container;
      deletedCount += 1;
      return Object.assign({}, container, { deletedAt: timestamp, updatedAt: timestamp });
    });
    const items = readArray(storage, ITEMS_KEY).map((item) => {
      if (!selected[getItemContainerId(item)]) return item;
      return Object.assign({}, item, { deletedAt: timestamp, updatedAt: timestamp });
    });
    writeArray(storage, CONTAINERS_KEY, containers);
    writeArray(storage, ITEMS_KEY, items);
    const reminderDismissal = dismissReminderNotices({
      containerIds: Object.keys(selected),
      itemIds: selectedItems.map((item) => item._id),
      reason: 'container_deleted'
    }, timestamp);
    return {
      deletedCount,
      containers: containers.filter((container) => selected[container._id]),
      items: items.filter((item) => selected[getItemContainerId(item)]),
      reminderNotices: reminderDismissal.notices,
      dismissedReminderCount: reminderDismissal.dismissedCount
    };
  }

  function deleteItem(itemId) {
    const id = firstText(itemId);
    if (!id) throw new Error('物品不存在');

    const timestamp = now();
    const activeItems = listItems();
    const targetItem = activeItems.find((item) => item && item._id === id && !item.deletedAt);
    if (!targetItem) throw new Error('物品不存在');

    const containerId = getItemContainerId(targetItem);
    const deletedItem = Object.assign({}, targetItem, {
      deletedAt: timestamp,
      updatedAt: timestamp
    });
    let updatedContainer = null;

    if (containerId) {
      const containers = readArray(storage, CONTAINERS_KEY);
      const targetContainer = containers.find((container) => container._id === containerId && !container.deletedAt);
      const nextContainerItems = activeItems.filter((item) => (
        item._id !== id && itemBelongsToContainer(item, containerId)
      ));
      const otherItems = activeItems.filter((item) => !itemBelongsToContainer(item, containerId));

      if (targetContainer) {
        updatedContainer = refreshContentImageCounts(
          Object.assign({}, targetContainer, { updatedAt: timestamp }),
          nextContainerItems
        );
        writeArray(storage, CONTAINERS_KEY, [updatedContainer].concat(containers.filter((container) => container._id !== containerId)));
      }
      writeArray(storage, ITEMS_KEY, dedupeRecords(nextContainerItems.concat(otherItems, [deletedItem], listDeletedStoredItems())));
    } else {
      const items = readArray(storage, ITEMS_KEY).map((item) => (
        item && item._id === id ? deletedItem : item
      ));
      writeArray(storage, ITEMS_KEY, items);
    }

    const reminderDismissal = dismissReminderNotices({
      itemIds: [id],
      reason: 'item_deleted'
    }, timestamp);

    return {
      container: updatedContainer,
      item: normalizeStoredItem(deletedItem),
      reminderNotices: reminderDismissal.notices,
      dismissedReminderCount: reminderDismissal.dismissedCount
    };
  }

  function markItemReminderRead(itemId, timestamp) {
    const readAt = finiteNumber(timestamp, now());
    let updatedItem = null;
    const items = readArray(storage, ITEMS_KEY).map((item) => {
      if (!item || item._id !== itemId || item.deletedAt) return item;
      updatedItem = Object.assign({}, item, {
        inAppReadAt: readAt,
        updatedAt: readAt
      });
      return updatedItem;
    });
    if (!updatedItem) {
      throw new Error('Item not found');
    }
    writeArray(storage, ITEMS_KEY, items);
    return { item: normalizeStoredItem(updatedItem) };
  }

  function markReminderNoticeRead(noticeId, timestamp) {
    const readAt = finiteNumber(timestamp, now());
    let updatedNotice = null;
    const notices = normalizeReminderNotices(readArray(storage, REMINDER_NOTICES_KEY)).map((notice) => {
      if (!notice || notice._id !== noticeId) return notice;
      updatedNotice = Object.assign({}, notice, {
        status: 'read',
        readAt,
        updatedAt: readAt
      });
      return updatedNotice;
    });
    if (!updatedNotice) {
      throw new Error('Reminder notice not found');
    }
    writeArray(storage, REMINDER_NOTICES_KEY, notices);

    let updatedItem = null;
    if (updatedNotice.itemId) {
      const items = readArray(storage, ITEMS_KEY).map((item) => {
        if (!item || item._id !== updatedNotice.itemId || item.deletedAt) return item;
        updatedItem = Object.assign({}, item, {
          inAppReadAt: readAt,
          updatedAt: readAt
        });
        return updatedItem;
      });
      if (updatedItem) writeArray(storage, ITEMS_KEY, items);
    }

    return {
      notice: normalizeReminderNotice(updatedNotice),
      item: updatedItem ? normalizeStoredItem(updatedItem) : null
    };
  }

  function upgradeFutureReminderSubscriptions(timestamp) {
    const result = expiryReminder.upgradeFutureInAppReminders(readArray(storage, ITEMS_KEY), timestamp || now());
    if (result.updatedIds.length) {
      writeArray(storage, ITEMS_KEY, result.items);
    }
    return {
      updatedIds: result.updatedIds,
      items: result.items.filter((item) => result.updatedIds.indexOf(item._id) >= 0).map(normalizeStoredItem)
    };
  }

  function persistRecords(containers, items, reminderNotices) {
    if (!canUseDatabase()) return Promise.resolve();
    const containerCollection = getCollection('containers');
    const itemCollection = getCollection('items');
    const reminderNoticeCollection = getCollection('reminderNotices');
    return Promise.all(
      (containers || []).map((container) => upsertDocument(containerCollection, container))
        .concat((items || []).map((item) => upsertDocument(itemCollection, item)))
        .concat((reminderNotices || []).map((notice) => upsertDocument(reminderNoticeCollection, notice)))
    ).then(() => {});
  }

  function saveContainerAsync(input) {
    return ensureDatabaseLoaded().then(() => {
      const saved = saveContainer(input);
      return persistRecords(
        [saved.container],
        saved.items.concat(saved.removedItems || []),
        saved.reminderNotices || []
      ).then(() => saved);
    });
  }

  function addContentImageAsync(containerId, imageInput) {
    return ensureDatabaseLoaded().then(() => {
      const updated = addContentImage(containerId, imageInput);
      return persistRecords([updated], []).then(() => updated);
    });
  }

  function updateContainerImageThumbsAsync(containerId, thumbPatch) {
    return ensureDatabaseLoaded().then(() => {
      const updated = updateContainerImageThumbs(containerId, thumbPatch);
      return persistRecords([updated], []).then(() => updated);
    });
  }

  function replaceItemsForImageAsync(containerId, imageId, items) {
    return ensureDatabaseLoaded().then(() => {
      const updated = replaceItemsForImage(containerId, imageId, items);
      return persistRecords(
        [updated.container],
        updated.items.concat(updated.removedItems || []),
        updated.reminderNotices || []
      ).then(() => updated);
    });
  }

  function deleteContainerAsync(id) {
    return ensureDatabaseLoaded().then(() => {
      const deleted = deleteContainer(id);
      const records = [];
      if (deleted.container) records.push(deleted.container);
      return persistRecords(records, deleted.items, deleted.reminderNotices || []).then(() => deleted);
    });
  }

  function deleteContainersAsync(ids) {
    return ensureDatabaseLoaded().then(() => {
      const deleted = deleteContainers(ids);
      return persistRecords(deleted.containers, deleted.items, deleted.reminderNotices || []).then(() => deleted);
    });
  }

  function deleteItemAsync(itemId) {
    return ensureDatabaseLoaded().then(() => {
      const deleted = deleteItem(itemId);
      const containers = deleted.container ? [deleted.container] : [];
      return persistRecords(containers, [deleted.item], deleted.reminderNotices || []).then(() => deleted);
    });
  }

  function markItemReminderReadAsync(itemId, timestamp) {
    return ensureDatabaseLoaded().then(() => {
      const updated = markItemReminderRead(itemId, timestamp);
      return persistRecords([], [updated.item]).then(() => updated);
    });
  }

  function markReminderNoticeReadAsync(noticeId, timestamp) {
    return ensureDatabaseLoaded().then(() => {
      const updated = markReminderNoticeRead(noticeId, timestamp);
      const items = updated.item ? [updated.item] : [];
      return persistRecords([], items, [updated.notice]).then(() => updated);
    });
  }

  function upgradeFutureReminderSubscriptionsAsync(timestamp) {
    return ensureDatabaseLoaded().then(() => {
      const upgraded = upgradeFutureReminderSubscriptions(timestamp);
      return persistRecords([], upgraded.items).then(() => upgraded);
    });
  }

  function removeDemoDataAsync() {
    return ensureDatabaseLoaded().then(() => removeDemoData());
  }

  function listContainersAsync() {
    return ensureDatabaseLoaded().then(() => listContainers());
  }

  function listUserContainersAsync() {
    return ensureDatabaseLoaded().then(() => listUserContainers());
  }

  function listItemsAsync() {
    return ensureDatabaseLoaded().then(() => listItems());
  }

  function listUserItemsAsync() {
    return ensureDatabaseLoaded().then(() => listUserItems());
  }

  function listPendingReminderNoticesAsync() {
    return ensureDatabaseLoaded().then(() => listPendingReminderNotices());
  }

  function getContainerAsync(id) {
    return ensureDatabaseLoaded().then(() => getContainer(id));
  }

  function getItemsByContainerAsync(id) {
    return ensureDatabaseLoaded().then(() => getItemsByContainer(id));
  }

  function getContentImagesAsync(containerId) {
    return ensureDatabaseLoaded().then(() => getContentImages(containerId));
  }

  function removeDemoData() {
    const demoContainerIds = listContainers().reduce((ids, container) => {
      if (isDemoContainer(container)) {
        ids[container._id] = true;
      }
      return ids;
    }, {});
    const containers = readArray(storage, CONTAINERS_KEY).filter((container) => (
      !demoContainerIds[container._id] && !isDemoContainer(container)
    ));
    const items = readArray(storage, ITEMS_KEY).filter((item) => (
      !demoContainerIds[getItemContainerId(item)] && !isDemoItem(item)
    ));
    writeArray(storage, CONTAINERS_KEY, containers);
    writeArray(storage, ITEMS_KEY, items);
    return { containers: listContainers(), items: listItems() };
  }

  function seedDemoData() {
    const existingContainers = listContainers();
    const existingItems = listItems();
    const hasExistingData = existingContainers.length || existingItems.length;
    const hasPreviousDemoData = existingItems.some((item) => String(item.sourceImageId || '').indexOf('demo_') === 0);
    if (hasExistingData && !hasPreviousDemoData) {
      return { containers: existingContainers, items: existingItems };
    }

    const demoContainers = [
      {
        demo: true,
        source: 'demo',
        name: '露营装备袋',
        locationPath: '阳台 / 置物架',
        contentImages: [
          { imageId: 'demo_camp_left', fileId: '/assets/mock-camp-content-left.jpg', label: '左侧' }
        ],
        items: [
          {
            demo: true,
            source: 'demo',
            displayName: '头灯',
            category: 'tool',
            colors: ['黑色'],
            aliases: ['露营灯', '灯'],
            description: '黑色小头灯，靠近收纳袋边缘。',
            sourceImageId: 'demo_camp_left',
            bbox: { x: 0.18, y: 0.26, width: 0.22, height: 0.18 },
            confidence: 0.78,
            confirmed: true
          },
          {
            demo: true,
            source: 'demo',
            displayName: '防水袋',
            category: 'bag',
            colors: ['黄色'],
            aliases: ['收纳袋', '露营袋'],
            description: '一只黄色防水袋。',
            sourceImageId: 'demo_camp_left',
            bbox: { x: 0.46, y: 0.44, width: 0.28, height: 0.24 },
            confidence: 0.74,
            confirmed: true
          }
        ]
      },
      {
        demo: true,
        source: 'demo',
        name: '客厅工具盒',
        locationPath: '客厅 / 电视柜',
        contentImages: [
          { imageId: 'demo_toolbox_left', fileId: '/assets/mock-toolbox-content-left.jpg', label: '工具' }
        ],
        items: [
          {
            demo: true,
            source: 'demo',
            displayName: '卷尺',
            category: 'tool',
            colors: ['黄色'],
            aliases: ['尺子', '工具'],
            description: '黄色卷尺，放在工具盒中部。',
            sourceImageId: 'demo_toolbox_left',
            bbox: { x: 0.2, y: 0.36, width: 0.22, height: 0.2 },
            confidence: 0.84,
            confirmed: true
          },
          {
            demo: true,
            source: 'demo',
            displayName: '螺丝刀',
            category: 'tool',
            colors: ['红色'],
            aliases: ['改锥', '工具'],
            description: '红柄螺丝刀，横放在右侧。',
            sourceImageId: 'demo_toolbox_left',
            bbox: { x: 0.48, y: 0.48, width: 0.34, height: 0.08 },
            confidence: 0.81,
            confirmed: true
          }
        ]
      },
      {
        demo: true,
        source: 'demo',
        name: '卧室 3 号箱',
        locationPath: '卧室 / 衣柜',
        contentImages: [
          { imageId: 'demo_bedroom_box', fileId: '/assets/mock-bedroom-box-content.jpg', label: '箱内' }
        ],
        items: [
          {
            demo: true,
            source: 'demo',
            displayName: '换季围巾',
            category: 'clothing',
            colors: ['米色'],
            aliases: ['围巾', '换季衣物'],
            description: '米色围巾，叠在箱子上层。',
            sourceImageId: 'demo_bedroom_box',
            bbox: { x: 0.12, y: 0.28, width: 0.44, height: 0.22 },
            confidence: 0.82,
            confirmed: true
          },
          {
            demo: true,
            source: 'demo',
            displayName: '旅行手册',
            category: 'book',
            colors: ['蓝色'],
            aliases: ['手册', '书', '旅行书'],
            description: '蓝色旅行手册，靠近收纳袋旁。',
            sourceImageId: 'demo_bedroom_box',
            bbox: { x: 0.6, y: 0.2, width: 0.24, height: 0.22 },
            confidence: 0.76,
            confirmed: true
          }
        ]
      },
      {
        demo: true,
        source: 'demo',
        name: '书桌左侧抽屉',
        locationPath: '卧室 / 书桌',
        contentImages: [
          { imageId: 'demo_inside_left', fileId: '/assets/mock-container-content-left.jpg', label: '左侧' },
          { imageId: 'demo_inside_right', fileId: '/assets/mock-container-content-right.jpg', label: '右侧' }
        ],
        items: [
          {
            demo: true,
            source: 'demo',
            displayName: '蓝色发卡',
            aiName: '蓝色发卡',
            category: 'accessory',
            colors: ['蓝色'],
            aliases: ['发夹', '头饰', '蓝色发夹'],
            description: '一个蓝色弧形发卡，位于画面右下角。',
            sourceImageId: 'demo_inside_left',
            bbox: { x: 0.68, y: 0.62, width: 0.18, height: 0.16 },
            confidence: 0.82,
            confirmed: true
          },
          {
            demo: true,
            source: 'demo',
            displayName: '黑色笔',
            category: 'pen',
            colors: ['黑色'],
            aliases: ['黑笔', '签字笔', '水笔'],
            description: '一支黑色签字笔。',
            sourceImageId: 'demo_inside_left',
            bbox: { x: 0.36, y: 0.44, width: 0.22, height: 0.06 },
            confidence: 0.8,
            confirmed: true
          },
          {
            demo: true,
            source: 'demo',
            displayName: '《三体》',
            category: 'book',
            colors: [],
            visibleText: '三体',
            aliases: ['三体', '科幻书', '书'],
            description: '一本封面写着三体的书。',
            sourceImageId: 'demo_inside_right',
            bbox: { x: 0.44, y: 0.08, width: 0.3, height: 0.24 },
            confidence: 0.9,
            confirmed: true
          },
          {
            demo: true,
            source: 'demo',
            displayName: '蓝色封面的书',
            category: 'book',
            colors: ['蓝色'],
            aliases: ['蓝色书', '书', '蓝色封面'],
            description: '一本蓝色封面的书，书名不清晰。',
            sourceImageId: 'demo_inside_right',
            bbox: { x: 0.58, y: 0.34, width: 0.28, height: 0.25 },
            confidence: 0.62,
            confirmed: true
          }
        ]
      }
    ];

    demoContainers
      .filter((containerInput) => !existingContainers.some((container) => container.name === containerInput.name))
      .forEach((containerInput) => {
      saveContainer(Object.assign({ coverImageFileId: '' }, containerInput));
    });

    const orderedDemoNames = demoContainers.map((container) => container.name).reverse();
    const timestamp = now();
    writeArray(storage, CONTAINERS_KEY, readArray(storage, CONTAINERS_KEY).map((container) => {
      const orderIndex = orderedDemoNames.indexOf(container.name);
      if (orderIndex < 0) return container;
      return Object.assign({}, container, { updatedAt: timestamp - orderIndex });
    }));

    return { containers: listContainers(), items: listItems() };
  }

  return {
    listContainers,
    listContainersAsync,
    listUserContainers,
    listUserContainersAsync,
    listItems,
    listItemsAsync,
    listUserItems,
    listUserItemsAsync,
    listPendingReminderNotices,
    listPendingReminderNoticesAsync,
    getContainer,
    getContainerAsync,
    getItemsByContainer,
    getItemsByContainerAsync,
    saveContainer,
    saveContainerAsync,
    addContentImage,
    addContentImageAsync,
    updateContainerImageThumbs,
    updateContainerImageThumbsAsync,
    replaceItemsForImage,
    replaceItemsForImageAsync,
    getContentImages,
    getContentImagesAsync,
    deleteContainer,
    deleteContainerAsync,
    deleteContainers,
    deleteContainersAsync,
    deleteItem,
    deleteItemAsync,
    dismissReminderNotices,
    markItemReminderRead,
    markItemReminderReadAsync,
    markReminderNoticeRead,
    markReminderNoticeReadAsync,
    upgradeFutureReminderSubscriptions,
    upgradeFutureReminderSubscriptionsAsync,
    removeDemoData,
    removeDemoDataAsync,
    loadFromDatabase,
    isDatabaseAvailable,
    seedDemoData
  };
}

const defaultService = createStorageService();

module.exports = Object.assign({
  createStorageService,
  CONTAINER_LIMIT,
  CONTENT_IMAGE_LIMIT
}, defaultService);
