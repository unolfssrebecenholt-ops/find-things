const remindersConfig = require('../config/reminders');

const DAY_MS = 24 * 60 * 60 * 1000;

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

function readAcceptedSubscriptionSetting(wxAdapter, templateId) {
  const tmplId = templateId || remindersConfig.expiryTemplateId;
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

function requestSubscribeAuthorization(wxAdapter, templateId) {
  const tmplId = templateId || remindersConfig.expiryTemplateId;
  if (!tmplId || !wxAdapter || typeof wxAdapter.requestSubscribeMessage !== 'function') {
    return Promise.resolve({ accepted: false, reason: 'unavailable' });
  }
  return new Promise((resolve) => {
    // One-time subscribe messages need a fresh request call for each send quota.
    wxAdapter.requestSubscribeMessage({
      tmplIds: [tmplId],
      success(result) {
        resolve({ accepted: result && result[tmplId] === 'accept', result });
      },
      fail(error) {
        resolve({
          accepted: false,
          reason: error && error.errMsg ? error.errMsg : 'failed'
        });
      }
    });
  });
}

module.exports = {
  DAY_MS,
  computeRemindAt,
  normalizeReminderFields,
  getExpiryState,
  decorateItem,
  deriveInAppReminders,
  upgradeFutureInAppReminders,
  readAcceptedSubscriptionSetting,
  requestSubscribeAuthorization
};
