# 过期提醒交接文档

日期：2026-06-01

## 已完成

- 物品支持过期时间字段：`expiresAt`、`reminderEnabled`、`remindOffsetDays`、`remindAt`、`reminderChannel`、`subscribeAccepted`、`remindedAt`、`inAppReadAt`、`lastReminderError`。
- 物品编辑器支持设置到期日期、是否提醒、提前几天提醒。
- 首页支持读取 `ft_reminder_notices` 并展示到期公示入口。
- 用户点击首页公示入口并确认后，会把提醒记录标记为 `read`，并更新对应物品的 `inAppReadAt`。
- 新增云函数 `ftExpiryReminder`：
  - 每分钟定时扫描，便于测试。
  - 到期物品会写入 `ft_reminder_notices`。
  - 订阅授权可用时尝试发送微信订阅消息。
  - 推送失败时降级为小程序内公示。
- 已修复云数据库写入失败：
  - 线上曾出现 `document.set:fail -501007 invalid parameters. 不能更新 _id 的值`。
  - 原因是 `doc(id).set({ data })` 的 `data` 中带了 `_id`。
  - 当前版本 `ftExpiryReminder-2026-06-01-debug-v3` 已在写库前剥离 `_id`。
- 已增加诊断日志：
  - `start`
  - `scan`
  - `process-item`
  - `set-notice-success`
  - `set-notice-failure`
  - `send-subscribe-start`
  - `send-subscribe-success`
  - `send-subscribe-failure`
  - `complete`

## 部署验证方式

1. 上传云函数 `ftExpiryReminder`。
2. 上传或预览最新版小程序。
3. 在云函数测试中传入：

```json
{ "now": 1780243920000 }
```

4. 日志必须出现：

```text
ftExpiryReminder-2026-06-01-debug-v3
```

5. 如果有新的到期物品，应看到：

```text
"dueItems":1
"stage":"set-notice-success"
```

6. 数据库 `ft_reminder_notices` 应出现 `status: "pending"` 的记录。
7. 首页重新进入后，应展示到期公示入口。

## 当前线上证据

最近一次日志显示：

```json
{
  "version": "ftExpiryReminder-2026-06-01-debug-v3",
  "scanned": 1,
  "notices": 0,
  "sent": 0,
  "failed": 0
}
```

对应诊断为：

```json
{
  "dueItems": 1,
  "hasExistingNotice": true,
  "existingNoticeStatus": "pending",
  "existingNoticePushStatus": "failed",
  "needsSubscribeSend": false,
  "subscribeAccepted": false,
  "reminderChannel": "inApp"
}
```

解释：

- 后端已识别到 1 个到期物品。
- 该物品已有 `pending` 公示记录，所以本次没有重复新增。
- 首页已能展示该公示记录。
- 微信订阅消息没有发送，是因为云端物品仍是 `subscribeAccepted: false`，且已有记录的 `pushStatus` 是 `failed`。

## 剩余问题

### 1. 首页文案需要优化成小懒语气

当前首页展示类似：

```text
到期公示 · 1条
```

建议改成：

```text
小懒提醒 · 1 件到期啦
```

按钮文案建议从：

```text
知道了
```

改成：

```text
小懒记下啦
```

或者：

```text
我处理好啦
```

### 2. 已在系统设置中开启订阅，不等于当前物品可推送

微信订阅消息是模板级、一次性授权语义。用户在系统设置里允许订阅消息，并不一定代表当前这条历史物品已经被写成：

```json
{
  "subscribeAccepted": true,
  "reminderChannel": "subscribe"
}
```

当前日志证明这条物品仍是：

```json
{
  "subscribeAccepted": false,
  "reminderChannel": "inApp"
}
```

所以云函数不会再次推送。

建议新增一个明确入口：

- 在首页到期公示弹窗中，如果存在 `subscribeAccepted: false` 或 `pushStatus: failed` 的记录，展示“开启微信提醒”。
- 用户点击后调用 `wx.requestSubscribeMessage`。
- 授权成功后更新对应 `ft_items`：

```json
{
  "subscribeAccepted": true,
  "reminderChannel": "subscribe",
  "lastReminderError": ""
}
```

- 同时将对应 `ft_reminder_notices.pushStatus` 从 `failed` 或 `none` 调整为可重试状态。
- 再主动调用一次 `ftExpiryReminder`。

### 3. 已有 pending 记录不会重复写入，也不会重复推送

当前逻辑避免每分钟重复刷屏：

- 已存在 `status: "pending"` 的提醒记录时，不重复新增。
- 已读 `status: "read"` 的提醒记录不会再推送。

但这也带来一个后续设计点：如果用户后来才开启订阅，需要定义“是否允许对已有 pending 记录补发订阅消息”。

建议规则：

- `status: "pending"` 且 `pushStatus !== "sent"` 且用户新授权成功，可以补发一次。
- 补发成功后写：

```json
{
  "pushStatus": "sent",
  "sentAt": 1780249501265
}
```

### 4. 测试期定时器是每分钟

当前 `cloudfunctions/ftExpiryReminder/config.json` 是每分钟运行，方便测试。上线前建议改为更低频率，例如每天早上一次，或者每天固定几个时间点。

### 5. 诊断日志偏详细

`debug-v3` 日志会输出最多 10 条候选物品诊断。测试期很有用，但正式版可以保留版本号和汇总日志，减少逐条样本输出。

## 建议下一步

1. 优化首页公示文案为小懒语气。
2. 在公示弹窗中增加“开启微信提醒/重新授权”入口。
3. 实现授权成功后的历史 pending 记录补发逻辑。
4. 测完订阅补发后，把云函数版本号升级为正式版，例如 `ftExpiryReminder-2026-06-01-v1`。
5. 上线前把定时器从每分钟改为正式频率。
