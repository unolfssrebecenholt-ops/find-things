const test = require('node:test');
const assert = require('node:assert/strict');

const reminder = require('../miniprogram/services/expiry-reminder');
const TEMPLATE_ID = 'test-template-id';

test('normalizes empty reminder fields to inactive in-app defaults', () => {
  const item = reminder.normalizeReminderFields({ displayName: 'battery' }, 1780243200000);
  assert.equal(item.expiresAt, 0);
  assert.equal(item.reminderEnabled, false);
  assert.equal(item.remindOffsetDays, 1);
  assert.equal(item.remindAt, 0);
  assert.equal(item.reminderChannel, 'inApp');
  assert.equal(item.subscribeAccepted, false);
  assert.equal(item.remindedAt, 0);
  assert.equal(item.inAppReadAt, 0);
  assert.equal(item.lastReminderError, '');
});

test('computes remindAt from expiry date and offset days', () => {
  const expiresAt = Date.UTC(2026, 5, 10, 15, 59, 59, 999);
  const item = reminder.normalizeReminderFields({
    expiresAt,
    reminderEnabled: true,
    remindOffsetDays: 3,
    subscribeAccepted: true
  }, Date.UTC(2026, 5, 1));
  assert.equal(item.remindAt, expiresAt - 3 * 24 * 60 * 60 * 1000);
  assert.equal(item.reminderChannel, 'subscribe');
});

test('clears delivery state when expiry changes', () => {
  const previous = {
    expiresAt: 1000,
    reminderEnabled: true,
    remindOffsetDays: 1,
    remindedAt: 900,
    inAppReadAt: 800,
    lastReminderError: 'old'
  };
  const next = reminder.normalizeReminderFields({
    expiresAt: 2000,
    reminderEnabled: true,
    remindOffsetDays: 1,
    remindedAt: 900,
    inAppReadAt: 800,
    lastReminderError: 'old'
  }, Date.now(), previous);
  assert.equal(next.remindedAt, 0);
  assert.equal(next.inAppReadAt, 0);
  assert.equal(next.lastReminderError, '');
});

test('formats expired and expiring labels', () => {
  const now = Date.UTC(2026, 5, 9);
  assert.equal(reminder.getExpiryState({
    expiresAt: Date.UTC(2026, 5, 8),
    remindAt: Date.UTC(2026, 5, 7)
  }, now).state, 'expired');
  assert.equal(reminder.getExpiryState({
    expiresAt: Date.UTC(2026, 5, 10),
    remindAt: Date.UTC(2026, 5, 8)
  }, now).state, 'expiring');
  assert.equal(reminder.getExpiryState({
    expiresAt: Date.UTC(2026, 5, 20),
    remindAt: Date.UTC(2026, 5, 19)
  }, now).state, 'normal');
});

test('deriveInAppReminders returns unread due reminders', () => {
  const now = Date.UTC(2026, 5, 9);
  const reminders = reminder.deriveInAppReminders([
    { _id: 'a', displayName: 'milk', expiresAt: Date.UTC(2026, 5, 10), remindAt: Date.UTC(2026, 5, 8), reminderEnabled: true },
    { _id: 'b', displayName: 'read', expiresAt: Date.UTC(2026, 5, 10), remindAt: Date.UTC(2026, 5, 8), reminderEnabled: true, inAppReadAt: now },
    { _id: 'c', displayName: 'disabled', expiresAt: Date.UTC(2026, 5, 10), remindAt: Date.UTC(2026, 5, 8), reminderEnabled: false },
    { _id: 'd', displayName: 'subscribe pending', expiresAt: Date.UTC(2026, 5, 10), remindAt: Date.UTC(2026, 5, 8), reminderEnabled: true, reminderChannel: 'subscribe', subscribeAccepted: true },
    { _id: 'e', displayName: 'subscribe sent', expiresAt: Date.UTC(2026, 5, 10), remindAt: Date.UTC(2026, 5, 8), reminderEnabled: true, remindedAt: now - 1 },
    { _id: 'f', displayName: 'subscribe failed', expiresAt: Date.UTC(2026, 5, 10), remindAt: Date.UTC(2026, 5, 8), reminderEnabled: true, reminderChannel: 'inApp', subscribeAccepted: false, lastReminderError: 'NO_OPENID' }
  ], now);
  assert.deepEqual(reminders.map((item) => item._id), ['a', 'f']);
});

test('does not upgrade in-app reminders from settings-only subscription state', () => {
  const now = Date.UTC(2026, 5, 9);
  const sourceItems = [
    {
      _id: 'future_in_app',
      expiresAt: Date.UTC(2026, 5, 12),
      remindAt: Date.UTC(2026, 5, 11),
      reminderEnabled: true,
      subscribeAccepted: false,
      reminderChannel: 'inApp',
      lastReminderError: 'user refused'
    },
    {
      _id: 'due_in_app',
      expiresAt: Date.UTC(2026, 5, 10),
      remindAt: Date.UTC(2026, 5, 8),
      reminderEnabled: true,
      subscribeAccepted: false,
      reminderChannel: 'inApp'
    },
    {
      _id: 'expired_in_app',
      expiresAt: Date.UTC(2026, 5, 8),
      remindAt: Date.UTC(2026, 5, 8),
      reminderEnabled: true,
      subscribeAccepted: false,
      reminderChannel: 'inApp'
    },
    {
      _id: 'sent_in_app',
      expiresAt: Date.UTC(2026, 5, 12),
      remindAt: Date.UTC(2026, 5, 11),
      reminderEnabled: true,
      subscribeAccepted: false,
      reminderChannel: 'inApp',
      remindedAt: now - 1
    },
    {
      _id: 'disabled',
      expiresAt: Date.UTC(2026, 5, 12),
      remindAt: Date.UTC(2026, 5, 11),
      reminderEnabled: false,
      subscribeAccepted: false,
      reminderChannel: 'inApp'
    }
  ];
  const items = reminder.upgradeFutureInAppReminders(sourceItems, now);

  assert.deepEqual(items.updatedIds, []);
  assert.equal(items.items[0].subscribeAccepted, false);
  assert.equal(items.items[0].reminderChannel, 'inApp');
  assert.equal(items.items[0].lastReminderError, 'user refused');
  assert.equal(items.items[1].subscribeAccepted, false);
  assert.equal(items.items[1].reminderChannel, 'inApp');
  assert.equal(items.items[2].subscribeAccepted, false);
  assert.equal(items.items[2].reminderChannel, 'inApp');
  assert.equal(items.items[3].subscribeAccepted, false);
  assert.equal(items.items[4].subscribeAccepted, false);
});

test('requestSubscribeAuthorization uses the configured expiry template id', async () => {
  const configCalls = [];
  const requests = [];
  const result = await reminder.requestSubscribeAuthorization({
    cloud: {
      callFunction(options) {
        configCalls.push(options);
        return Promise.resolve({ result: { expiryTemplateId: TEMPLATE_ID } });
      }
    },
    requestSubscribeMessage(options) {
      requests.push(options);
      options.success({ [TEMPLATE_ID]: 'accept' });
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(configCalls[0].name, 'ftExpiryReminder');
  assert.deepEqual(configCalls[0].data, { action: 'config' });
  assert.deepEqual(requests[0].tmplIds, [TEMPLATE_ID]);
});

test('requestSubscribeAuthorization requests a send quota when subscription setting is already accepted', async () => {
  let promptCalled = false;
  const result = await reminder.requestSubscribeAuthorization({
    getSetting(options) {
      options.success({
        subscriptionsSetting: {
          itemSettings: {
            [TEMPLATE_ID]: 'accept'
          }
        }
      });
    },
    requestSubscribeMessage(options) {
      promptCalled = true;
      assert.deepEqual(options.tmplIds, [TEMPLATE_ID]);
      options.success({ [TEMPLATE_ID]: 'accept' });
    }
  }, TEMPLATE_ID);

  assert.equal(result.accepted, true);
  assert.equal(promptCalled, true);
});

test('requestSubscribeAuthorization prompts once per user action when setting is not accepted', async () => {
  let promptCalls = 0;
  const wxAdapter = {
    getSetting(options) {
      options.success({
        subscriptionsSetting: {
          itemSettings: {
            [TEMPLATE_ID]: 'reject'
          }
        }
      });
    },
    requestSubscribeMessage(options) {
      promptCalls += 1;
      assert.deepEqual(options.tmplIds, [TEMPLATE_ID]);
      options.success({ [TEMPLATE_ID]: 'reject' });
    }
  };

  const first = await reminder.requestSubscribeAuthorization(wxAdapter, TEMPLATE_ID);
  const second = await reminder.requestSubscribeAuthorization(wxAdapter, TEMPLATE_ID);

  assert.equal(first.accepted, false);
  assert.equal(second.accepted, false);
  assert.equal(promptCalls, 2);
});

test('requestSubscribeAuthorizations requests one quota per item when setting is accepted', async () => {
  let promptCalls = 0;
  const results = await reminder.requestSubscribeAuthorizations({
    getSetting(options) {
      options.success({
        subscriptionsSetting: {
          itemSettings: {
            [TEMPLATE_ID]: 'accept'
          }
        }
      });
    },
    requestSubscribeMessage(options) {
      promptCalls += 1;
      assert.deepEqual(options.tmplIds, [TEMPLATE_ID]);
      options.success({ [TEMPLATE_ID]: 'accept' });
    }
  }, 3, TEMPLATE_ID);

  assert.equal(promptCalls, 3);
  assert.deepEqual(results.map((item) => item.accepted), [true, true, true]);
});

test('requestSubscribeAuthorizations does not silently invent extra quotas after a one-time accept', async () => {
  let promptCalls = 0;
  const results = await reminder.requestSubscribeAuthorizations({
    getSetting(options) {
      options.success({
        subscriptionsSetting: {
          itemSettings: {
            [TEMPLATE_ID]: 'reject'
          }
        }
      });
    },
    requestSubscribeMessage(options) {
      promptCalls += 1;
      options.success({ [TEMPLATE_ID]: 'accept' });
    }
  }, 3, TEMPLATE_ID);

  assert.equal(promptCalls, 1);
  assert.deepEqual(results.map((item) => item.accepted), [true, false, false]);
});

test('requestSubscribeAuthorization can request another quota after a one-time accept', async () => {
  let promptCalls = 0;
  const wxAdapter = {
    getSetting(options) {
      options.success({
        subscriptionsSetting: {
          itemSettings: {
            [TEMPLATE_ID]: 'reject'
          }
        }
      });
    },
    requestSubscribeMessage(options) {
      promptCalls += 1;
      options.success({ [TEMPLATE_ID]: 'accept' });
    }
  };

  const first = await reminder.requestSubscribeAuthorization(wxAdapter, TEMPLATE_ID);
  const second = await reminder.requestSubscribeAuthorization(wxAdapter, TEMPLATE_ID);

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(promptCalls, 2);
});
