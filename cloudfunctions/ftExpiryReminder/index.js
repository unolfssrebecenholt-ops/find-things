const cloud = require('wx-server-sdk');
let cloudConfig = null;
try {
  cloudConfig = require('../../miniprogram/config/cloud');
} catch (error) {
  cloudConfig = {
    collections: {
      containers: 'ft_containers',
      items: 'ft_items',
      reminderNotices: 'ft_reminder_notices'
    }
  };
}

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const FUNCTION_VERSION = 'ftExpiryReminder-2026-06-01-debug-v5';
const LOG_PREFIX = '[ftExpiryReminder]';
const DEFAULT_PAGE = 'pages/home/index';
const ITEM_COLLECTION = (cloudConfig.collections && cloudConfig.collections.items) || 'ft_items';
const CONTAINER_COLLECTION = (cloudConfig.collections && cloudConfig.collections.containers) || 'ft_containers';
const NOTICE_COLLECTION = (cloudConfig.collections && cloudConfig.collections.reminderNotices) || 'ft_reminder_notices';
const READ_PAGE_SIZE = 100;
const DIAGNOSTIC_ITEM_LIMIT = 10;

function diagnosticLog(stage, data) {
  const record = Object.assign({
    version: FUNCTION_VERSION,
    stage
  }, data || {});
  try {
    console.log(LOG_PREFIX, JSON.stringify(record));
  } catch (error) {
    console.log(LOG_PREFIX, stage, record);
  }
}

function configuredTemplateId() {
  return String(process.env.EXPIRY_REMINDER_TEMPLATE_ID || '').trim();
}

function toTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function isDeleted(record) {
  return record && (
    record.deleted === true
    || record.isDeleted === true
    || record.deletedAt
  );
}

function containerKey(record) {
  if (!record) return '';
  return String(record._id || record.id || record.containerId || '');
}

function itemContainerKey(item) {
  if (!item) return '';
  return String(item.containerId || item.parentId || item.container_id || '');
}

function hasEmptyReminderTimestamp(item) {
  return !toTimestamp(item && item.remindedAt);
}

function noticeIdForItem(item) {
  const itemId = item && item._id ? String(item._id) : '';
  const remindAt = toTimestamp(item && item.remindAt);
  return itemId && remindAt ? `expiry_${itemId}_${remindAt}` : '';
}

function isReadNoticeForItem(notice, item) {
  if (!notice || notice.status !== 'read') return false;
  const itemId = item && item._id ? String(item._id) : '';
  if (!itemId || String(notice.itemId || '') !== itemId) return false;
  return toTimestamp(notice.remindAt) === toTimestamp(item && item.remindAt);
}

function hasReadNoticeForItem(notices, item) {
  return (notices || []).some((notice) => isReadNoticeForItem(notice, item));
}

function createActiveContainerSet(containers) {
  return new Set(
    (containers || [])
      .filter((container) => !isDeleted(container))
      .map(containerKey)
      .filter(Boolean)
  );
}

function diagnoseReminderItem(item, activeContainers, timestamp, notices) {
  const remindAt = toTimestamp(item && item.remindAt);
  const expiresAt = toTimestamp(item && item.expiresAt);
  const remindedAt = toTimestamp(item && item.remindedAt);
  const inAppReadAt = toTimestamp(item && item.inAppReadAt);
  const containerId = itemContainerKey(item);
  const readNotice = hasReadNoticeForItem(notices, item);
  const exclusionReasons = [];

  if (!item) {
    exclusionReasons.push('missing_item');
  } else {
    if (isDeleted(item)) exclusionReasons.push('item_deleted');
    if (item.reminderEnabled !== true) exclusionReasons.push('reminder_disabled');
    if (!remindAt) {
      exclusionReasons.push('missing_remindAt');
    } else if (remindAt > timestamp) {
      exclusionReasons.push('future_remindAt');
    }
    if (inAppReadAt) exclusionReasons.push('in_app_read');
    if (readNotice) exclusionReasons.push('read_notice');
    if (containerId && !activeContainers.has(containerId)) {
      exclusionReasons.push('parent_container_inactive');
    }
  }

  return {
    itemId: item && item._id ? String(item._id) : '',
    hasOpenid: !!(item && item._openid),
    containerId,
    containerActive: containerId ? activeContainers.has(containerId) : true,
    reminderEnabled: item && item.reminderEnabled === true,
    subscribeAccepted: item && item.subscribeAccepted === true,
    reminderChannel: String((item && item.reminderChannel) || ''),
    remindAt,
    expiresAt,
    remindedAt,
    inAppReadAt,
    deletedAt: toTimestamp(item && item.deletedAt),
    isDeleted: !!(item && isDeleted(item)),
    hasReadNotice: readNotice,
    due: exclusionReasons.length === 0,
    exclusionReasons
  };
}

function buildScanDiagnostics(items, containers, notices, timestamp, dueItems) {
  const activeContainers = createActiveContainerSet(containers);
  const diagnostics = (items || []).map((item) => diagnoseReminderItem(item, activeContainers, timestamp, notices));
  const reasonCounts = diagnostics.reduce((counts, item) => {
    const key = item.due ? 'due' : item.exclusionReasons[0] || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const sampleItems = diagnostics
    .filter((item) => item.reminderEnabled || item.remindAt || item.expiresAt || item.due)
    .slice(0, DIAGNOSTIC_ITEM_LIMIT);

  return {
    containers: (containers || []).length,
    activeContainers: activeContainers.size,
    items: (items || []).length,
    notices: (notices || []).length,
    dueItems: (dueItems || []).length,
    reasonCounts,
    sampleItems
  };
}

function selectDueReminderItems(items, containers, now, notices) {
  const timestamp = toTimestamp(now) || Date.now();
  const activeContainers = createActiveContainerSet(containers);

  return (items || []).filter((item) => {
    return diagnoseReminderItem(item, activeContainers, timestamp, notices).due;
  });
}

function applySendSuccess(item, timestamp) {
  return {
    remindedAt: toTimestamp(timestamp) || Date.now(),
    lastReminderError: ''
  };
}

function applySendFailure(item, errorMessage) {
  return {
    subscribeAccepted: false,
    reminderChannel: 'inApp',
    lastReminderError: String(errorMessage || 'SEND_FAILED')
  };
}

function database() {
  return cloud.database();
}

async function readCollection(name) {
  const collection = database().collection(name);
  const readPage = async (skip, rows) => {
    const query = typeof collection.skip === 'function'
      ? collection.skip(skip).limit(READ_PAGE_SIZE)
      : collection;
    const result = await query.get();
    const page = result && Array.isArray(result.data) ? result.data : [];
    const nextRows = rows.concat(page);
    if (page.length < READ_PAGE_SIZE) return nextRows;
    return readPage(skip + READ_PAGE_SIZE, nextRows);
  };
  return readPage(0, []);
}

async function updateItem(itemId, data) {
  await database().collection(ITEM_COLLECTION).doc(itemId).update({ data });
}

function omitDocumentId(data) {
  const value = Object.assign({}, data || {});
  delete value._id;
  return value;
}

async function setNotice(noticeId, data) {
  const doc = database().collection(NOTICE_COLLECTION).doc(noticeId);
  const payload = omitDocumentId(data);
  if (doc && typeof doc.set === 'function') {
    await doc.set({ data: payload });
    return;
  }
  await doc.update({ data: payload });
}

function errorMessage(error) {
  if (!error) return 'SEND_FAILED';
  return error.message || error.errMsg || String(error);
}

function truncateTemplateText(value, limit) {
  const text = String(value || '').trim();
  const maxLength = Math.max(0, Number(limit) || 0);
  if (!maxLength || text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

function itemDisplayName(item) {
  return String((item && (item.displayName || item.name)) || '物品').trim() || '物品';
}

function buildBatchItemNames(items) {
  return truncateTemplateText((items || []).map(itemDisplayName).join(' '), 20);
}

function buildSubscribeMessage(items, templateId, openid) {
  const batchItems = (items || []).filter(Boolean);
  return {
    touser: openid,
    templateId,
    page: DEFAULT_PAGE,
    data: {
      thing5: { value: buildBatchItemNames(batchItems) || '过期物品' },
      number7: { value: String(batchItems.length) },
      thing3: { value: '有空记得要清理过期物品哦！' }
    }
  };
}

async function sendReminderBatch(items, templateId, openid) {
  if (!openid) {
    throw new Error('NO_OPENID');
  }
  if (!templateId) {
    throw new Error('TEMPLATE_ID_MISSING');
  }
  if (!cloud.openapi || !cloud.openapi.subscribeMessage || typeof cloud.openapi.subscribeMessage.send !== 'function') {
    throw new Error('SUBSCRIBE_MESSAGE_UNAVAILABLE');
  }
  return cloud.openapi.subscribeMessage.send(buildSubscribeMessage(items, templateId, openid));
}

function buildContainerMap(containers) {
  return (containers || []).reduce((map, container) => {
    const key = containerKey(container);
    if (key) map[key] = container;
    return map;
  }, {});
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

function imageFileId(image) {
  return firstText([
    image && image.fileId,
    image && image.fileID,
    image && image.imageFileId,
    image && image.imagePath,
    image && image.url
  ]);
}

function imageThumbFileId(image) {
  return firstText([
    image && image.thumbFileId,
    image && image.thumbnailFileId,
    image && image.previewFileId,
    image && image.thumb_file_id
  ]);
}

function findSourceImage(item, container) {
  const images = (container && container.contentImages) || [];
  const sourceImageId = firstText([
    item && item.sourceImageId,
    item && item.imageId,
    item && item.image_id
  ]);
  const sourceImageFileId = firstText([
    item && item.sourceImageFileId,
    item && item.imageFileId,
    item && item.imagePath
  ]);
  return images.find((image) => sourceImageId && image && image.imageId === sourceImageId)
    || images.find((image) => sourceImageFileId && imageFileId(image) === sourceImageFileId)
    || null;
}

function reminderLocationText(item) {
  return firstText([
    item && item.locationText,
    item && item.relativePosition,
    item && item.positionText
  ]);
}

function findExistingNotice(notices, item) {
  const noticeId = noticeIdForItem(item);
  return (notices || []).find((notice) => notice && notice._id === noticeId)
    || (notices || []).find((notice) => (
      notice
      && String(notice.itemId || '') === String(item && item._id || '')
      && toTimestamp(notice.remindAt) === toTimestamp(item && item.remindAt)
    ))
    || null;
}

function buildNoticeMessage(item) {
  const name = String((item && (item.displayName || item.name)) || '物品').trim() || '物品';
  return `${name} 已过期，请及时处理。`;
}

function buildReminderNotice(item, container, existingNotice, timestamp) {
  const existing = existingNotice || {};
  const sourceImage = findSourceImage(item, container);
  const remindedAt = toTimestamp(item && item.remindedAt);
  const subscribeAccepted = item && item.subscribeAccepted === true;
  const pushStatus = existing.pushStatus || (remindedAt ? 'sent' : 'none');
  const channel = existing.channel || (subscribeAccepted ? 'subscribe' : 'inApp');
  const noticeId = noticeIdForItem(item);

  return {
    _id: noticeId,
    type: 'expiry',
    itemId: item._id,
    containerId: itemContainerKey(item),
    _openid: item._openid || existing._openid || '',
    displayName: String(item.displayName || item.name || existing.displayName || '物品'),
    containerName: String(item.containerName || (container && (container.name || container.locationPath)) || existing.containerName || ''),
    locationPath: String((container && container.locationPath) || existing.locationPath || ''),
    locationText: reminderLocationText(item) || String(existing.locationText || ''),
    thumbFileId: firstText([
      existing.thumbFileId,
      item && item.thumbFileId,
      item && item.sourceImageThumbFileId,
      imageThumbFileId(sourceImage),
      container && container.contentThumbFileId
    ]),
    sourceImageFileId: firstText([
      existing.sourceImageFileId,
      item && item.sourceImageFileId,
      item && item.imagePath,
      imageFileId(sourceImage),
      container && container.contentImageFileId
    ]),
    contentImageFileId: firstText([
      existing.contentImageFileId,
      container && container.contentImageFileId
    ]),
    contentThumbFileId: firstText([
      existing.contentThumbFileId,
      container && container.contentThumbFileId
    ]),
    message: existing.message || buildNoticeMessage(item),
    expiresAt: toTimestamp(item.expiresAt || item.remindAt),
    remindAt: toTimestamp(item.remindAt),
    channel,
    status: existing.status === 'read' ? 'read' : 'pending',
    pushStatus,
    sentAt: toTimestamp(existing.sentAt) || remindedAt || 0,
    readAt: toTimestamp(existing.readAt),
    lastError: String(existing.lastError || ''),
    createdAt: toTimestamp(existing.createdAt) || timestamp,
    updatedAt: timestamp
  };
}

function shouldSendSubscribeReminder(item, notice) {
  return item
    && item.subscribeAccepted === true
    && notice
    && notice.status !== 'read'
    && notice.pushStatus !== 'sent'
    && hasEmptyReminderTimestamp(item);
}

function createSubscribeBatches(records) {
  const groups = (records || []).reduce((map, record) => {
    const openid = record && record.item && record.item._openid;
    if (!openid) return map;
    if (!map[openid]) map[openid] = [];
    map[openid].push(record);
    return map;
  }, {});

  return Object.keys(groups).map((openid) => {
    const groupRecords = groups[openid];
    const quotaRecords = groupRecords.filter((record) => shouldSendSubscribeReminder(record.item, record.notice));
    return {
      openid,
      quotaRecords,
      records: quotaRecords
    };
  }).filter((batch) => batch.records.length);
}

function createMissingOpenidSubscribeRecords(records) {
  return (records || []).filter((record) => (
    shouldSendSubscribeReminder(record.item, record.notice)
    && !(record.item && record.item._openid)
  ));
}

function recordItemIds(records) {
  return (records || [])
    .map((record) => record && record.item && record.item._id)
    .filter(Boolean);
}

async function main(event, context) {
  const templateId = configuredTemplateId();
  if (event && event.action === 'config') {
    diagnosticLog('config', {
      hasTemplateId: !!templateId
    });
    return {
      version: FUNCTION_VERSION,
      expiryTemplateId: templateId,
      hasTemplateId: !!templateId
    };
  }

  const timestamp = toTimestamp(event && event.now) || Date.now();
  diagnosticLog('start', {
    timestamp,
    eventNow: event && event.now,
    hasTemplateId: !!templateId,
    templateId,
    collections: {
      items: ITEM_COLLECTION,
      containers: CONTAINER_COLLECTION,
      notices: NOTICE_COLLECTION
    }
  });
  const containers = await readCollection(CONTAINER_COLLECTION);
  const items = await readCollection(ITEM_COLLECTION);
  const notices = await readCollection(NOTICE_COLLECTION);
  const dueItems = selectDueReminderItems(items, containers, timestamp, notices);
  diagnosticLog('scan', buildScanDiagnostics(items, containers, notices, timestamp, dueItems));
  const containersById = buildContainerMap(containers);
  const result = {
    version: FUNCTION_VERSION,
    scanned: dueItems.length,
    notices: 0,
    sent: 0,
    failed: 0,
    failures: []
  };
  const records = [];

  for (const item of dueItems) {
    const existingNotice = findExistingNotice(notices, item);
    let notice = buildReminderNotice(item, containersById[itemContainerKey(item)], existingNotice, timestamp);
    const needsSubscribeSend = shouldSendSubscribeReminder(item, notice);
    const shouldWriteNotice = !existingNotice || needsSubscribeSend;
    diagnosticLog('process-item', {
      itemId: item && item._id,
      noticeId: notice && notice._id,
      hasExistingNotice: !!existingNotice,
      existingNoticeStatus: existingNotice && existingNotice.status,
      existingNoticePushStatus: existingNotice && existingNotice.pushStatus,
      needsSubscribeSend,
      shouldWriteNotice,
      subscribeAccepted: item && item.subscribeAccepted === true,
      reminderChannel: item && item.reminderChannel,
      remindedAt: toTimestamp(item && item.remindedAt),
      inAppReadAt: toTimestamp(item && item.inAppReadAt)
    });
    if (shouldWriteNotice) {
      try {
        await setNotice(notice._id, notice);
        result.notices += 1;
        diagnosticLog('set-notice-success', {
          itemId: item && item._id,
          noticeId: notice && notice._id,
          status: notice && notice.status,
          channel: notice && notice.channel,
          pushStatus: notice && notice.pushStatus
        });
      } catch (error) {
        const message = errorMessage(error);
        diagnosticLog('set-notice-failure', {
          itemId: item && item._id,
          noticeId: notice && notice._id,
          error: message
        });
        throw error;
      }
    }
    records.push({ item, notice });
  }

  const missingOpenidRecords = createMissingOpenidSubscribeRecords(records);
  for (const record of missingOpenidRecords) {
    const item = record.item;
    const message = 'NO_OPENID';
    await updateItem(item._id, applySendFailure(item, message));
    record.notice = Object.assign({}, record.notice, {
      channel: 'inApp',
      pushStatus: 'failed',
      lastError: message,
      updatedAt: timestamp
    });
    await setNotice(record.notice._id, record.notice);
    result.failed += 1;
    result.failures.push({ itemId: item._id, error: message });
    diagnosticLog('send-subscribe-failure', {
      itemId: item && item._id,
      noticeId: record.notice && record.notice._id,
      error: message
    });
  }

  const subscribeBatches = createSubscribeBatches(records);
  for (const batch of subscribeBatches) {
    const itemIds = recordItemIds(batch.records);
    try {
      diagnosticLog('send-subscribe-start', {
        openid: batch.openid,
        itemIds,
        count: batch.records.length
      });
      await sendReminderBatch(batch.records.map((record) => record.item), templateId, batch.openid);
      await Promise.all(batch.records.map((record) => updateItem(record.item._id, applySendSuccess(record.item, timestamp))));
      await Promise.all(batch.records.map((record) => {
        record.notice = Object.assign({}, record.notice, {
          channel: 'subscribe',
          pushStatus: 'sent',
          sentAt: timestamp,
          lastError: '',
          updatedAt: timestamp
        });
        return setNotice(record.notice._id, record.notice);
      }));
      result.sent += 1;
      diagnosticLog('send-subscribe-success', {
        openid: batch.openid,
        itemIds,
        count: batch.records.length,
        sentAt: timestamp
      });
    } catch (error) {
      const message = errorMessage(error);
      await Promise.all(batch.records.map((record) => updateItem(record.item._id, applySendFailure(record.item, message))));
      await Promise.all(batch.records.map((record) => {
        record.notice = Object.assign({}, record.notice, {
          channel: 'inApp',
          pushStatus: 'failed',
          lastError: message,
          updatedAt: timestamp
        });
        return setNotice(record.notice._id, record.notice);
      }));
      result.failed += 1;
      result.failures.push({ itemId: itemIds[0] || '', itemIds, error: message });
      diagnosticLog('send-subscribe-failure', {
        openid: batch.openid,
        itemIds,
        count: batch.records.length,
        error: message
      });
    }
  }

  diagnosticLog('complete', result);
  return result;
}

module.exports = {
  noticeIdForItem,
  selectDueReminderItems,
  applySendSuccess,
  applySendFailure,
  main
};
