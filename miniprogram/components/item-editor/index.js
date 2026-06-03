let expiryReminder = null;
try {
  expiryReminder = require('../../services/expiry-reminder');
} catch (error) {
  expiryReminder = null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function removeTagValue(values, tag) {
  const target = String(tag || '').trim();
  const source = Array.isArray(values) ? values : [];
  if (!target) return source.slice();
  return source.filter((value) => String(value || '').trim() !== target);
}

function uniqueTags(values) {
  return (values || [])
    .map((value) => String(value || '').trim())
    .filter((value, index, terms) => value && terms.indexOf(value) === index);
}

function toTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeOffsetDays(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 1;
}

function computeRemindAt(expiresAt, offsetDays) {
  if (expiryReminder && typeof expiryReminder.computeRemindAt === 'function') {
    return expiryReminder.computeRemindAt(expiresAt, offsetDays);
  }
  return expiresAt ? Math.max(0, expiresAt - normalizeOffsetDays(offsetDays) * DAY_MS) : 0;
}

function dateToEndOfDay(value) {
  if (!value) return 0;
  const date = new Date(`${value}T23:59:59.999`);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatDateInput(value) {
  const expiresAt = toTimestamp(value);
  if (!expiresAt) return '';
  const date = new Date(expiresAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeReminderFields(item) {
  if (expiryReminder && typeof expiryReminder.normalizeReminderFields === 'function') {
    return expiryReminder.normalizeReminderFields(item, Date.now());
  }
  const value = Object.assign({}, item);
  value.expiresAt = toTimestamp(value.expiresAt);
  value.remindOffsetDays = normalizeOffsetDays(value.remindOffsetDays);
  value.reminderEnabled = !!value.expiresAt && value.reminderEnabled === true;
  value.remindAt = value.reminderEnabled ? computeRemindAt(value.expiresAt, value.remindOffsetDays) : 0;
  value.subscribeAccepted = value.reminderEnabled && value.subscribeAccepted === true;
  value.reminderChannel = value.subscribeAccepted ? 'subscribe' : 'inApp';
  value.remindedAt = toTimestamp(value.remindedAt);
  value.inAppReadAt = toTimestamp(value.inAppReadAt);
  value.lastReminderError = String(value.lastReminderError || '');
  return value;
}

function createReminderPatch(item, patch) {
  const next = normalizeReminderFields(Object.assign({}, item, patch));
  const expiryDateValue = formatDateInput(next.expiresAt);
  return {
    expiresAt: next.expiresAt,
    expiryDateValue,
    expiryDateText: expiryDateValue || '选择日期',
    reminderEnabled: next.reminderEnabled,
    remindOffsetDays: next.remindOffsetDays,
    remindAt: next.remindAt,
    reminderChannel: next.reminderChannel,
    subscribeAccepted: next.subscribeAccepted,
    remindedAt: 0,
    inAppReadAt: 0,
    lastReminderError: ''
  };
}

function requestSubscribeAuthorization() {
  if (!expiryReminder || typeof expiryReminder.requestSubscribeAuthorization !== 'function') {
    return Promise.resolve({ accepted: false });
  }
  if (typeof wx === 'undefined') {
    return Promise.resolve({ accepted: false });
  }
  return expiryReminder.requestSubscribeAuthorization(wx).catch(() => ({ accepted: false }));
}

function primeReminderTemplateConfig() {
  if (!expiryReminder || typeof expiryReminder.resolveExpiryTemplateId !== 'function') return;
  if (typeof wx === 'undefined') return;
  expiryReminder.resolveExpiryTemplateId(wx).catch(() => {});
}

Component({
  properties: {
    items: {
      type: Array,
      value: []
    },
    hideHead: {
      type: Boolean,
      value: false,
      observer(value) {
        this.setData({
          showHead: !value,
          showToolbar: !value,
          showKeepAction: !value,
          editorClass: value ? 'embedded' : ''
        });
      }
    },
    contextKey: {
      type: String,
      value: ''
    }
  },

  data: {
    showHead: true,
    showToolbar: true,
    showKeepAction: true,
    editorClass: ''
  },

  lifetimes: {
    attached() {
      primeReminderTemplateConfig();
    }
  },

  methods: {
    emit(items) {
      this.triggerEvent('change', {
        items,
        contextKey: this.data.contextKey
      });
    },

    patchItem(index, patch) {
      const items = (this.data.items || []).map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return Object.assign({}, item, patch);
      });
      if (typeof this.setData === 'function') {
        this.setData({ items });
      } else {
        this.data.items = items;
      }
      this.emit(items);
    },

    toggleExpiry(event) {
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.items[index] || {};
      const enabled = !!(event.detail && event.detail.value);
      const expiresAt = enabled ? (toTimestamp(item.expiresAt) || dateToEndOfDay(formatDateInput(Date.now()))) : 0;
      const patch = createReminderPatch(item, {
        expiresAt,
        reminderEnabled: enabled,
        remindOffsetDays: normalizeOffsetDays(item.remindOffsetDays)
      });
      this.patchItem(index, patch);
      if (!enabled) return Promise.resolve();
      return requestSubscribeAuthorization().then((authorization) => {
        this.patchItem(index, Object.assign({}, patch, {
          subscribeAccepted: !!(authorization && authorization.accepted),
          reminderChannel: authorization && authorization.accepted ? 'subscribe' : 'inApp'
        }));
      });
    },

    changeExpiryDate(event) {
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.items[index] || {};
      const expiresAt = dateToEndOfDay(event.detail && event.detail.value);
      const patch = createReminderPatch(item, {
        expiresAt,
        reminderEnabled: !!expiresAt,
        remindOffsetDays: normalizeOffsetDays(item.remindOffsetDays)
      });
      this.patchItem(index, patch);
      if (!expiresAt || !patch.reminderEnabled) return Promise.resolve();
      return requestSubscribeAuthorization().then((authorization) => {
        this.patchItem(index, Object.assign({}, patch, {
          subscribeAccepted: !!(authorization && authorization.accepted),
          reminderChannel: authorization && authorization.accepted ? 'subscribe' : 'inApp'
        }));
      });
    },

    toggleReminder(event) {
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.items[index] || {};
      const enabled = !!(event.detail && event.detail.value) && !!toTimestamp(item.expiresAt);
      const applyAuthorization = (authorization) => {
        this.patchItem(index, createReminderPatch(item, {
          reminderEnabled: enabled,
          remindOffsetDays: normalizeOffsetDays(item.remindOffsetDays),
          subscribeAccepted: enabled && !!(authorization && authorization.accepted),
          reminderChannel: enabled && authorization && authorization.accepted ? 'subscribe' : 'inApp'
        }));
      };
      if (!enabled) {
        applyAuthorization({ accepted: false });
        return Promise.resolve();
      }
      return requestSubscribeAuthorization().then(applyAuthorization);
    },

    changeReminderOffset(event) {
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.items[index] || {};
      this.patchItem(index, createReminderPatch(item, {
        reminderEnabled: item.reminderEnabled === true,
        remindOffsetDays: normalizeOffsetDays(event.detail && event.detail.value)
      }));
    },

    toggleConfirmed(event) {
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.items[index];
      this.patchItem(index, { confirmed: !item.confirmed });
    },

    rename(event) {
      this.patchItem(Number(event.currentTarget.dataset.index), {
        displayName: event.detail.value
      });
    },

    editCategory(event) {
      this.patchItem(Number(event.currentTarget.dataset.index), {
        category: event.detail.value
      });
    },

    removeTag(event) {
      const index = Number(event.currentTarget.dataset.index);
      const tag = String(event.currentTarget.dataset.tag || '').trim();
      if (!Number.isFinite(index) || !tag) return;
      const item = this.data.items[index] || {};
      const colors = removeTagValue(item.colors, tag);
      const features = removeTagValue(item.features, tag);
      const aliases = removeTagValue(item.aliases, tag);
      const fullTagList = uniqueTags(colors.concat(features, aliases));
      this.patchItem(index, {
        colors,
        features,
        aliases,
        hasTags: fullTagList.length > 0,
        tagList: fullTagList.slice(0, 6),
        tagText: fullTagList.join(' ')
      });
    },

    editDescription(event) {
      this.patchItem(Number(event.currentTarget.dataset.index), {
        description: event.detail.value
      });
    },

    editNote(event) {
      this.patchItem(Number(event.currentTarget.dataset.index), {
        note: event.detail.value
      });
    },

    removeItem(event) {
      const index = Number(event.currentTarget.dataset.index);
      const items = (this.data.items || []).filter((_, itemIndex) => itemIndex !== index);
      this.emit(items);
    }
  }
});
