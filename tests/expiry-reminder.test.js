const test = require('node:test');
const assert = require('node:assert/strict');

const reminder = require('../miniprogram/services/expiry-reminder');
const TEMPLATE_ID = 'YQ16_zieaD46dXPv_mMrSGIkR6WLLpc9fxMFF1q5jEI';

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

test('upgrades unread in-app reminders when subscription is accepted later', () => {
  const now = Date.UTC(2026, 5, 9);
  const items = reminder.upgradeFutureInAppReminders([
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
  ], now);

  assert.deepEqual(items.updatedIds, ['future_in_app', 'due_in_app', 'expired_in_app']);
  assert.equal(items.items[0].subscribeAccepted, true);
  assert.equal(items.items[0].reminderChannel, 'subscribe');
  assert.equal(items.items[0].lastReminderError, '');
  assert.equal(items.items[1].subscribeAccepted, true);
  assert.equal(items.items[1].reminderChannel, 'subscribe');
  assert.equal(items.items[2].subscribeAccepted, true);
  assert.equal(items.items[2].reminderChannel, 'subscribe');
  assert.equal(items.items[3].subscribeAccepted, false);
  assert.equal(items.items[4].subscribeAccepted, false);
});

test('requestSubscribeAuthorization uses the configured expiry template id', async () => {
  const requests = [];
  const result = await reminder.requestSubscribeAuthorization({
    requestSubscribeMessage(options) {
      requests.push(options);
      options.success({ [TEMPLATE_ID]: 'accept' });
    }
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(requests[0].tmplIds, [TEMPLATE_ID]);
});

test('requestSubscribeAuthorization reads accepted subscription settings before prompting', async () => {
  let promptCalled = false;
  const result = await reminder.requestSubscribeAuthorization({
    getSetting(options) {
      assert.equal(options.withSubscriptions, true);
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
      options.fail({ errMsg: 'should not prompt' });
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(result.fromSetting, true);
  assert.equal(promptCalled, false);
});
