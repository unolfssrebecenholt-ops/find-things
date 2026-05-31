# Expiry Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add item expiry dates with subscribe-message reminders and in-app fallback reminders.

**Architecture:** Item records own expiry and reminder state. `miniprogram/services/expiry-reminder.js` contains shared client normalization, formatting, authorization, and in-app derivation. A new `ftExpiryReminder` cloud function scans due items and sends subscribe messages, downgrading failed deliveries to in-app reminders.

**Tech Stack:** WeChat mini program JavaScript/WXML/WXSS, WeChat cloud functions, Node.js `node --test`.

---

## Shared Field Contract

All implementation tasks must use these field names exactly:

```js
{
  expiresAt: 0,
  reminderEnabled: false,
  remindOffsetDays: 1,
  remindAt: 0,
  reminderChannel: 'inApp',
  subscribeAccepted: false,
  remindedAt: 0,
  inAppReadAt: 0,
  lastReminderError: ''
}
```

`expiresAt`, `remindAt`, `remindedAt`, and `inAppReadAt` are millisecond timestamps. `0` means absent.

## File Structure

- Create `miniprogram/services/expiry-reminder.js`: shared client helper for normalization, labels, authorization, and in-app reminder derivation.
- Create `miniprogram/config/reminders.js`: reminder template configuration with an empty default template id.
- Modify `miniprogram/services/storage.js`: normalize reminder fields in persisted items and cloud-loaded legacy items.
- Modify `miniprogram/components/item-editor/*`: show expiry/reminder controls and emit field changes.
- Modify `miniprogram/pages/container/detail.js`: include expiry labels in item view models and preserve reminder fields through edits.
- Modify `miniprogram/pages/container/detail.wxml`: render compact expiry state on item cards.
- Modify `miniprogram/pages/container/detail.wxss`: style compact expiry state without disturbing existing card layout.
- Modify `miniprogram/pages/capture/review.js`: preserve expiry/reminder fields from recognition edit flow.
- Modify `miniprogram/pages/home/index.js` and `.wxml/.wxss`: show in-app reminder entry for due reminders.
- Create `cloudfunctions/ftExpiryReminder/index.js`: timer-capable subscribe-message sender and exported test helpers.
- Create `cloudfunctions/ftExpiryReminder/package.json`.
- Create tests in `tests/expiry-reminder.test.js`, `tests/expiry-reminder-cloud.test.js`, and update existing UI/storage tests as needed.

## Task 1: Client Reminder Service And Storage Normalization

**Ownership:** This task owns `miniprogram/services/expiry-reminder.js`, `miniprogram/config/reminders.js`, `miniprogram/services/storage.js`, `tests/expiry-reminder.test.js`, and relevant additions to `tests/storage.test.js`.

- [ ] **Step 1: Add failing tests for reminder helper behavior**

Create `tests/expiry-reminder.test.js` with tests for:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const reminder = require('../miniprogram/services/expiry-reminder');

test('normalizes empty reminder fields to inactive in-app defaults', () => {
  const item = reminder.normalizeReminderFields({ displayName: '电池' }, 1780243200000);
  assert.equal(item.expiresAt, 0);
  assert.equal(item.reminderEnabled, false);
  assert.equal(item.remindOffsetDays, 1);
  assert.equal(item.remindAt, 0);
  assert.equal(item.reminderChannel, 'inApp');
  assert.equal(item.subscribeAccepted, false);
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
  assert.equal(reminder.getExpiryState({ expiresAt: Date.UTC(2026, 5, 8), remindAt: Date.UTC(2026, 5, 7) }, now).state, 'expired');
  assert.equal(reminder.getExpiryState({ expiresAt: Date.UTC(2026, 5, 10), remindAt: Date.UTC(2026, 5, 8) }, now).state, 'expiring');
  assert.equal(reminder.getExpiryState({ expiresAt: Date.UTC(2026, 5, 20), remindAt: Date.UTC(2026, 5, 19) }, now).state, 'normal');
});

test('deriveInAppReminders returns unread due reminders', () => {
  const now = Date.UTC(2026, 5, 9);
  const reminders = reminder.deriveInAppReminders([
    { _id: 'a', displayName: '牛奶', expiresAt: Date.UTC(2026, 5, 10), remindAt: Date.UTC(2026, 5, 8), reminderEnabled: true },
    { _id: 'b', displayName: '已读', expiresAt: Date.UTC(2026, 5, 10), remindAt: Date.UTC(2026, 5, 8), reminderEnabled: true, inAppReadAt: now },
    { _id: 'c', displayName: '不用提醒', expiresAt: Date.UTC(2026, 5, 10), remindAt: Date.UTC(2026, 5, 8), reminderEnabled: false }
  ], now);
  assert.deepEqual(reminders.map((item) => item._id), ['a']);
});
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run: `node --test tests/expiry-reminder.test.js`

Expected: failure because `miniprogram/services/expiry-reminder.js` does not exist.

- [ ] **Step 3: Implement `miniprogram/services/expiry-reminder.js` and config**

Implement:

```js
const remindersConfig = require('../config/reminders');

const DAY_MS = 24 * 60 * 60 * 1000;

function toTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeOffsetDays(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 1;
}

function computeRemindAt(expiresAt, offsetDays) {
  if (!expiresAt) return 0;
  return Math.max(0, expiresAt - normalizeOffsetDays(offsetDays) * DAY_MS);
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
  const subscribeAccepted = value.subscribeAccepted === true;
  const changed = reminderChanged({
    expiresAt,
    reminderEnabled,
    remindOffsetDays
  }, previous);

  value.expiresAt = expiresAt;
  value.reminderEnabled = reminderEnabled;
  value.remindOffsetDays = remindOffsetDays;
  value.remindAt = reminderEnabled ? computeRemindAt(expiresAt, remindOffsetDays) : 0;
  value.subscribeAccepted = reminderEnabled && subscribeAccepted;
  value.reminderChannel = value.subscribeAccepted ? 'subscribe' : 'inApp';
  value.remindedAt = changed ? 0 : toTimestamp(value.remindedAt);
  value.inAppReadAt = changed ? 0 : toTimestamp(value.inAppReadAt);
  value.lastReminderError = changed ? '' : String(value.lastReminderError || '');
  return value;
}

function getExpiryState(item, now) {
  const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const expiresAt = toTimestamp(item && item.expiresAt);
  if (!expiresAt) return { state: 'none', label: '', expiresAt: 0 };
  const remindAt = toTimestamp(item && item.remindAt);
  if (expiresAt < timestamp) return { state: 'expired', label: '已过期', expiresAt };
  if (remindAt && remindAt <= timestamp) return { state: 'expiring', label: '即将到期', expiresAt };
  const date = new Date(expiresAt);
  return { state: 'normal', label: `${date.getMonth() + 1}月${date.getDate()}日到期`, expiresAt };
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
  const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  return (items || [])
    .map((item) => decorateItem(item, timestamp))
    .filter((item) => item.reminderEnabled && !item.inAppReadAt && item.remindAt && item.remindAt <= timestamp);
}

function requestSubscribeAuthorization(wxAdapter, templateId) {
  const tmplId = templateId || remindersConfig.expiryTemplateId;
  if (!tmplId || !wxAdapter || typeof wxAdapter.requestSubscribeMessage !== 'function') {
    return Promise.resolve({ accepted: false, reason: 'unavailable' });
  }
  return new Promise((resolve) => {
    wxAdapter.requestSubscribeMessage({
      tmplIds: [tmplId],
      success(result) {
        resolve({ accepted: result && result[tmplId] === 'accept', result });
      },
      fail(error) {
        resolve({ accepted: false, reason: error && error.errMsg ? error.errMsg : 'failed' });
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
  requestSubscribeAuthorization
};
```

Create `miniprogram/config/reminders.js`:

```js
module.exports = {
  expiryTemplateId: ''
};
```

- [ ] **Step 4: Run helper tests and verify they pass**

Run: `node --test tests/expiry-reminder.test.js`

Expected: all tests pass.

- [ ] **Step 5: Add failing storage tests**

Add tests to `tests/storage.test.js` that save a container with an item containing `expiresAt`, `reminderEnabled`, and `subscribeAccepted`, then assert `listItems()` preserves normalized fields and computes `remindAt`.

- [ ] **Step 6: Run storage tests and verify failure**

Run: `node --test tests/storage.test.js`

Expected: failure because storage does not yet normalize reminder fields.

- [ ] **Step 7: Integrate reminder normalization into storage**

Modify `miniprogram/services/storage.js`:

- Require `./expiry-reminder`.
- In `normalizeStoredItem`, call `expiryReminder.normalizeReminderFields`.
- In `normalizeItem`, merge reminder normalization after item ids/source fields are assigned.
- When matching previous persisted item in `saveContainer`, pass the previous item to normalization so state resets only when reminder settings change.

- [ ] **Step 8: Run focused tests**

Run:

```bash
node --test tests/expiry-reminder.test.js tests/storage.test.js
```

Expected: all focused tests pass.

## Task 2: Item Editor And Detail UI

**Ownership:** This task owns `miniprogram/components/item-editor/*`, `miniprogram/pages/container/detail.js`, `miniprogram/pages/container/detail.wxml`, `miniprogram/pages/container/detail.wxss`, `miniprogram/pages/capture/review.js`, and UI-related tests. It must not change storage normalization logic.

- [ ] **Step 1: Add failing UI structure test**

Extend `tests/ui-prototype-structure.test.js` or create `tests/expiry-reminder-ui.test.js` to assert:

- `item-editor/index.wxml` contains a date picker for expiry.
- `item-editor/index.wxml` contains a reminder switch.
- `container/detail.wxml` renders `expiryLabel`.

- [ ] **Step 2: Run UI structure test and verify failure**

Run: `node --test tests/expiry-reminder-ui.test.js`

Expected: failure because expiry UI does not exist.

- [ ] **Step 3: Add item editor event handlers**

Modify `miniprogram/components/item-editor/index.js`:

- Require `../../services/expiry-reminder`.
- Add `toggleExpiry`, `changeExpiryDate`, `toggleReminder`, and `changeReminderOffset`.
- When enabling reminder, call `expiryReminder.requestSubscribeAuthorization(wx)` if `wx` exists.
- Patch item fields using the shared field contract.

- [ ] **Step 4: Add WXML controls**

Modify `miniprogram/components/item-editor/index.wxml` inside each item card:

- Add expiry date row with a switch and date picker.
- Add reminder row when expiry is enabled.
- Keep labels compact and avoid nested cards.

- [ ] **Step 5: Add WXSS styles**

Modify `miniprogram/components/item-editor/index.wxss` with stable row dimensions and compact controls.

- [ ] **Step 6: Decorate detail view models**

Modify `miniprogram/pages/container/detail.js`:

- Require `../../services/expiry-reminder`.
- In `createItemViewModel`, decorate item and expose `expiryLabel`, `expiryState`, `hasExpiry`, `isExpired`, and `isExpiring`.
- Ensure `stripItemViewFields` removes those view-only fields before saving.

- [ ] **Step 7: Render detail badges**

Modify `miniprogram/pages/container/detail.wxml` to render a compact expiry badge when `item.hasExpiry`.

Modify `miniprogram/pages/container/detail.wxss` for normal, expiring, and expired states.

- [ ] **Step 8: Preserve fields in review flow**

Check `miniprogram/pages/capture/review.js` and ensure `stripDraftViewFields`, `createDraftItem`, and editor change handling do not drop reminder fields.

- [ ] **Step 9: Run focused UI tests**

Run:

```bash
node --test tests/expiry-reminder-ui.test.js tests/container-detail-page.test.js tests/recognition-progress-flow.test.js
```

Expected: all focused tests pass.

## Task 3: In-App Reminder Entry On Home

**Ownership:** This task owns `miniprogram/pages/home/index.js`, `miniprogram/pages/home/index.wxml`, `miniprogram/pages/home/index.wxss`, and a focused home/reminder test. It must only consume `expiry-reminder` and storage APIs.

- [ ] **Step 1: Add failing home test**

Add a test that confirms home derives due reminders from storage items and exposes a visible reminder entry state.

- [ ] **Step 2: Run home test and verify failure**

Run the focused home test.

- [ ] **Step 3: Load reminders on home**

Modify `miniprogram/pages/home/index.js`:

- Require `../../services/expiry-reminder`.
- Load user items through storage.
- Set `expiryReminderCount`, `expiryReminderItems`, and `showExpiryReminderEntry`.

- [ ] **Step 4: Render home entry**

Modify `miniprogram/pages/home/index.wxml`:

- Add a compact reminder entry when `showExpiryReminderEntry`.
- Text should be concise, for example `有 {{expiryReminderCount}} 件物品即将到期`.

Modify WXSS to keep layout consistent with existing home design.

- [ ] **Step 5: Run focused home tests**

Run the home/reminder focused test and `node --test tests/ui-prototype-structure.test.js`.

Expected: tests pass.

## Task 4: Cloud Subscribe Reminder Function

**Ownership:** This task owns `cloudfunctions/ftExpiryReminder/*` and `tests/expiry-reminder-cloud.test.js`. It must not change `ftAnalyzeImage`.

- [ ] **Step 1: Add failing cloud helper tests**

Create `tests/expiry-reminder-cloud.test.js` with tests for:

- Selecting due reminders only.
- Ignoring deleted items and deleted containers.
- Marking successful sends with `remindedAt`.
- Downgrading failed sends to in-app fallback.

- [ ] **Step 2: Run cloud tests and verify failure**

Run: `node --test tests/expiry-reminder-cloud.test.js`

Expected: failure because cloud function does not exist.

- [ ] **Step 3: Create cloud function package**

Create `cloudfunctions/ftExpiryReminder/package.json`:

```json
{
  "name": "ft-expiry-reminder",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "latest"
  }
}
```

- [ ] **Step 4: Implement testable cloud helpers**

Create `cloudfunctions/ftExpiryReminder/index.js` with exported helpers:

- `selectDueReminderItems(items, containers, now)`
- `applySendSuccess(item, timestamp)`
- `applySendFailure(item, errorMessage)`
- `main(event, context)`

The `main` function should initialize cloud SDK, query containers and items collections from `cloudConfig.collections`, send subscribe messages with `cloud.openapi.subscribeMessage.send`, and update item records.

- [ ] **Step 5: Add timer config**

Create `cloudfunctions/ftExpiryReminder/config.json`:

```json
{
  "triggers": [
    {
      "name": "dailyExpiryReminder",
      "type": "timer",
      "config": "0 0 9 * * * *"
    }
  ]
}
```

- [ ] **Step 6: Run cloud tests**

Run: `node --test tests/expiry-reminder-cloud.test.js`

Expected: all cloud tests pass.

## Task 5: Integration Verification

**Ownership:** Controller task. Review all worker changes before running this.

- [ ] **Step 1: Inspect modified files**

Run:

```bash
git diff --name-only
git diff --check
```

Expected: no whitespace errors. Confirm changes stay within planned files plus tests/docs.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Manual mini program consistency check**

Review WXML/WXSS for:

- No overlapping controls.
- No card-inside-card structure.
- Text fits compact rows.
- Reminder entry is visible but not dominant.

- [ ] **Step 4: Final status**

Report:

- Files changed.
- Tests run.
- Any remaining setup needed, especially real subscribe-message template id in `miniprogram/config/reminders.js`.

## Self-Review

- Spec coverage: data fields, subscribe authorization, cloud timer sending, send failure fallback, and in-app reminders all map to tasks.
- Placeholder scan: no task contains unresolved placeholder language for implementation behavior; the template id is intentionally empty by default and documented as configuration.
- Type consistency: field names match the shared field contract across client, UI, storage, and cloud tasks.
