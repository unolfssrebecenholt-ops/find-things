# Expiry Reminders Design

## Goal

Add item-level expiry dates with reminder support. When the user authorizes WeChat subscribe messages, reminders should be sent through subscribe messages. If authorization is rejected, unavailable, or delivery fails, the same reminder remains visible inside the mini program.

## Product Behavior

Expiry is optional per item. Existing recognized items and manually added items keep working without an expiry date.

The item editor shows:

- Expiry date: disabled by default, with a date picker when enabled.
- Reminder: enabled only when an expiry date exists.
- Reminder offset: default one day before expiry.

When the user enables reminders or changes an expiry date, the mini program requests subscribe-message permission for the expiry reminder template. Rejection does not block saving. The item is saved and becomes eligible for in-app reminders.

The container detail page and search-facing item view models show a compact expiry state:

- No expiry: no badge.
- Future expiry: date text such as `6月10日到期`.
- Within reminder window: `即将到期`.
- Past expiry: `已过期`.

The home page should expose a lightweight in-app reminder entry when there are unread due reminders. A dedicated reminder center can be a follow-up; for the first implementation, the reminder list can be derived and shown on the home page or a simple page.

## Data Model

The item record owns reminder state:

```js
{
  expiresAt: 1780243200000,
  reminderEnabled: true,
  remindOffsetDays: 1,
  remindAt: 1780156800000,
  reminderChannel: 'subscribe',
  subscribeAccepted: true,
  remindedAt: 0,
  inAppReadAt: 0,
  lastReminderError: ''
}
```

Field rules:

- `expiresAt` is a millisecond timestamp at local end-of-day for the selected date. Empty or `0` means no expiry.
- `reminderEnabled` is false when `expiresAt` is empty.
- `remindOffsetDays` defaults to `1`.
- `remindAt` is recomputed from `expiresAt` and `remindOffsetDays`.
- `reminderChannel` is internal. Use `subscribe` when the latest authorization was accepted, otherwise `inApp`.
- `subscribeAccepted` records the latest subscribe-message authorization result for this item reminder.
- `remindedAt` is set only after a subscribe message is successfully sent.
- `inAppReadAt` is set when the user dismisses or marks the in-app reminder handled.
- When `expiresAt`, `reminderEnabled`, or `remindOffsetDays` changes, clear `remindedAt`, `inAppReadAt`, and `lastReminderError`.

## Client Architecture

Create `miniprogram/services/expiry-reminder.js` for shared client logic:

- Normalize item reminder fields.
- Compute `remindAt`.
- Format expiry status and labels.
- Request subscribe-message authorization.
- Derive unread in-app reminders from item lists.

The storage service calls normalization before persisting items and after reading legacy items. UI code should consume normalized fields and display labels from the shared service rather than reimplementing date math.

## Subscribe Message Flow

Create `miniprogram/config/reminders.js` with a placeholder template id:

```js
module.exports = {
  expiryTemplateId: ''
};
```

If the template id is empty, authorization is skipped and the item falls back to in-app reminders. This keeps development and tests stable before the real WeChat template is configured.

When template id exists, call `wx.requestSubscribeMessage({ tmplIds: [expiryTemplateId] })` in response to a user action. Treat `accept` as subscribe enabled; treat `reject`, `ban`, `filter`, errors, and unsupported runtime as in-app fallback.

## Cloud Architecture

Add cloud function `cloudfunctions/ftExpiryReminder`.

The function supports:

- Timer invocation for daily scans.
- Testable exported helpers for selecting due items and applying send results.

Scan criteria:

- Item is not deleted.
- `reminderEnabled === true`.
- `subscribeAccepted === true`.
- `remindAt <= now`.
- `remindedAt` is empty.
- Parent container is not deleted.

For each due item, send one subscribe message to the item's `_openid` when available. If the current data does not expose item owner ids reliably, the function records a `NO_OPENID` error and leaves the item eligible for in-app reminder.

On send success:

- Set `remindedAt`.
- Clear `lastReminderError`.

On send failure:

- Set `subscribeAccepted` to false.
- Set `reminderChannel` to `inApp`.
- Set `lastReminderError`.
- Do not set `inAppReadAt`.

## Testing

Use `node --test`.

Required coverage:

- Storage preserves expiry fields for recognized and manual items.
- Storage recomputes `remindAt` and clears reminder delivery state when expiry changes.
- Client helper formats normal, expiring, and expired labels.
- Subscribe authorization helper falls back to in-app when template id is empty, rejected, or unsupported.
- Cloud helper selects only due subscribe-authorized reminders.
- Cloud helper converts send failures to in-app fallback.
- UI structure exposes expiry controls in `item-editor`.

## Out Of Scope

- Recurring reminders after dismissal.
- Multiple reminder offsets per item.
- Batch-edit expiry dates.
- Permanent subscribe-message alternatives.
- Full notification history analytics.
