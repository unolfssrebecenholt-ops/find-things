const remindersConfig = require('../config/reminders');

const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIG_FUNCTION_NAME = 'ftExpiryReminder';
let cachedExpiryTemplateId = '';
let expiryTemplateConfigPromise = null;

function toTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeOffsetDays(value) {
  if (value === undefined || value === null || value === '') return 1;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 1;
}

function computeRemindAt(expiresAt, offsetDays) {
  const expiry = toTimestamp(expiresAt);
  if (!expiry) return 0;
  return Math.max(0, expiry - normalizeOffsetDays(offsetDays) * DAY_MS);
}

function reminderChanged(next, previous) {
  if (!previous) return false;
  return toTimestamp(next.expiresAt) !== toTimestamp(previous.expiresAt)
    || !!next.reminderEnabled !== !!previous.reminderEnabled
    || normalizeOffsetDays(next.remindOffsetDays) !== normalizeOffsetDays(previous.remindOffsetDays);
}

function normalizeReminderFields(item, now, previous) {
  const value = Object.assign({}, item || {});
  const expiresAt = toTimestamp(value.expiresAt);
  const reminderEnabled = !!expiresAt && value.reminderEnabled !== false;
  const remindOffsetDays = normalizeOffsetDays(value.remindOffsetDays);
  const changed = reminderChanged({
    expiresAt,
    reminderEnabled,
    remindOffsetDays
  }, previous);

  value.expiresAt = expiresAt;
  value.reminderEnabled = reminderEnabled;
  value.remindOffsetDays = remindOffsetDays;
  value.remindAt = reminderEnabled ? computeRemindAt(expiresAt, remindOffsetDays) : 0;
  value.subscribeAccepted = reminderEnabled && value.subscribeAccepted === true;
  value.reminderChannel = value.subscribeAccepted ? 'subscribe' : 'inApp';
  value.remindedAt = changed ? 0 : toTimestamp(value.remindedAt);
  value.inAppReadAt = changed ? 0 : toTimestamp(value.inAppReadAt);
  value.lastReminderError = changed ? '' : String(value.lastReminderError || '');
  return value;
}

function getNowTimestamp(now) {
  const timestamp = Number(now);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function getExpiryState(item, now) {
  const timestamp = getNowTimestamp(now);
  const expiresAt = toTimestamp(item && item.expiresAt);
  if (!expiresAt) return { state: 'none', label: '', expiresAt: 0 };
  const remindAt = toTimestamp(item && item.remindAt);
  if (expiresAt < timestamp) return { state: 'expired', label: '已过期', expiresAt };
  if (remindAt && remindAt <= timestamp) return { state: 'expiring', label: '即将到期', expiresAt };
  const date = new Date(expiresAt);
  return {
    state: 'normal',
    label: `${date.getMonth() + 1}月${date.getDate()}日到期`,
    expiresAt
  };
}

function decorateItem(item, now) {
  const normalized = normalizeReminderFields(item, now);
  const expiry = getExpiryState(normalized, now);
  return Object.assign({}, normalized, {
    expiryState: expiry.state,
    expiryLabel: expiry.label,
    hasExpiry: expiry.state !== 'none',
    isExpired: expiry.state === 'expired',
    isExpiring: expiry.state === 'expiring'
  });
}

function deriveInAppReminders(items, now) {
  const timestamp = getNowTimestamp(now);
  return (items || [])
    .map((item) => decorateItem(item, timestamp))
    .filter((item) => (
      item.reminderEnabled
      && !item.inAppReadAt
      && !item.remindedAt
      && item.remindAt
      && item.remindAt <= timestamp
      && (item.reminderChannel !== 'subscribe' || item.subscribeAccepted !== true)
    ));
}

function upgradeFutureInAppReminders(items) {
  // A settings-level accept does not grant send quota for historical items.
  // Keep this compatibility helper as a no-op so old call sites cannot infer it.
  return {
    items: (items || []).slice(),
    updatedIds: []
  };
}

function normalizeTemplateId(templateId) {
  return String(templateId || '').trim();
}

function readLocalExpiryTemplateId() {
  return normalizeTemplateId(remindersConfig && remindersConfig.expiryTemplateId);
}

function extractExpiryTemplateId(response) {
  const result = response && response.result ? response.result : response;
  return normalizeTemplateId(result && (result.expiryTemplateId || result.templateId));
}

function callExpiryTemplateConfig(wxAdapter) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (templateId) => {
      if (settled) return;
      settled = true;
      resolve(normalizeTemplateId(templateId));
    };

    try {
      const request = wxAdapter.cloud.callFunction({
        name: CONFIG_FUNCTION_NAME,
        data: { action: 'config' },
        success(response) {
          settle(extractExpiryTemplateId(response));
        },
        fail() {
          settle('');
        }
      });
      if (request && typeof request.then === 'function') {
        request.then((response) => {
          settle(extractExpiryTemplateId(response));
        }).catch(() => {
          settle('');
        });
      }
    } catch (error) {
      settle('');
    }
  });
}

function fetchExpiryTemplateId(wxAdapter) {
  if (cachedExpiryTemplateId) return Promise.resolve(cachedExpiryTemplateId);
  if (expiryTemplateConfigPromise) return expiryTemplateConfigPromise;

  const localTemplateId = readLocalExpiryTemplateId();
  if (!wxAdapter || !wxAdapter.cloud || typeof wxAdapter.cloud.callFunction !== 'function') {
    return Promise.resolve(localTemplateId);
  }

  expiryTemplateConfigPromise = callExpiryTemplateConfig(wxAdapter).then((templateId) => {
    const resolved = normalizeTemplateId(templateId) || localTemplateId;
    if (resolved) cachedExpiryTemplateId = resolved;
    expiryTemplateConfigPromise = null;
    return resolved;
  });

  return expiryTemplateConfigPromise;
}

function resolveExpiryTemplateId(wxAdapter, templateId) {
  const directTemplateId = normalizeTemplateId(templateId);
  if (directTemplateId) return Promise.resolve(directTemplateId);
  return fetchExpiryTemplateId(wxAdapter);
}

function readAcceptedSubscriptionSetting(wxAdapter, templateId) {
  const tmplId = normalizeTemplateId(templateId);
  if (!tmplId) {
    return Promise.resolve({ accepted: false, reason: 'template_id_missing' });
  }
  if (!wxAdapter || typeof wxAdapter.getSetting !== 'function') {
    return Promise.resolve({ accepted: false });
  }
  return new Promise((resolve) => {
    wxAdapter.getSetting({
      withSubscriptions: true,
      success(result) {
        const itemSettings = result
          && result.subscriptionsSetting
          && result.subscriptionsSetting.itemSettings;
        resolve({
          accepted: itemSettings && itemSettings[tmplId] === 'accept',
          result
        });
      },
      fail(error) {
        resolve({
          accepted: false,
          reason: error && error.errMsg ? error.errMsg : 'setting_unavailable'
        });
      }
    });
  });
}

function requestOneSubscribeAuthorization(wxAdapter, templateId, setting) {
  const tmplId = normalizeTemplateId(templateId);
  if (!tmplId) {
    return Promise.resolve({ accepted: false, reason: 'template_id_missing', setting });
  }
  if (!wxAdapter || typeof wxAdapter.requestSubscribeMessage !== 'function') {
    return Promise.resolve({ accepted: false, reason: 'unavailable', setting });
  }
  return new Promise((resolve) => {
    wxAdapter.requestSubscribeMessage({
      tmplIds: [tmplId],
      success(result) {
        const accepted = result && result[tmplId] === 'accept';
        resolve({ accepted, result, setting });
      },
      fail(error) {
        resolve({
          accepted: false,
          reason: error && error.errMsg ? error.errMsg : 'failed',
          setting
        });
      }
    });
  });
}

function requestSubscribeAuthorizations(wxAdapter, count, templateId) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (!total) return Promise.resolve([]);
  return resolveExpiryTemplateId(wxAdapter, templateId).then((tmplId) => {
    if (!tmplId || !wxAdapter) {
      return Array(total).fill({ accepted: false, reason: tmplId ? 'unavailable' : 'template_id_missing' });
    }

    const requestSeries = (requestCount, setting) => {
      return Array(requestCount).fill(null).reduce((promise) => (
        promise.then((results) => requestOneSubscribeAuthorization(wxAdapter, tmplId, setting)
          .then((result) => results.concat(result)))
      ), Promise.resolve([]));
    };

    return readAcceptedSubscriptionSetting(wxAdapter, tmplId).then((setting) => {
      if (setting && setting.accepted) {
        return requestSeries(total, setting);
      }
      return requestOneSubscribeAuthorization(wxAdapter, tmplId, setting).then((first) => {
        if (!first.accepted) return [first].concat(Array(Math.max(0, total - 1)).fill({ accepted: false, reason: 'quota_not_requested' }));
        return readAcceptedSubscriptionSetting(wxAdapter, tmplId).then((nextSetting) => {
          if (!(nextSetting && nextSetting.accepted)) {
            return [first].concat(Array(Math.max(0, total - 1)).fill({ accepted: false, reason: 'quota_not_requested' }));
          }
          if (total === 1) return [first];
          return requestSeries(total - 1, nextSetting).then((rest) => [first].concat(rest));
        });
      });
    });
  });
}

function requestSubscribeAuthorization(wxAdapter, templateId) {
  return requestSubscribeAuthorizations(wxAdapter, 1, templateId).then((results) => results[0] || { accepted: false, reason: 'unavailable' });
}

module.exports = {
  DAY_MS,
  computeRemindAt,
  normalizeReminderFields,
  getExpiryState,
  decorateItem,
  deriveInAppReminders,
  upgradeFutureInAppReminders,
  resolveExpiryTemplateId,
  readAcceptedSubscriptionSetting,
  requestSubscribeAuthorization,
  requestSubscribeAuthorizations
};
