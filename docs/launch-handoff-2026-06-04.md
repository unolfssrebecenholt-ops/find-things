# 上线交接文档

日期：2026-06-04

## 当前状态

- 上线前代码侧清理已完成，剩余工作集中在真机验证和微信后台提审。
- 隐私授权组件已接入拍照、选图、补拍、封面选择等入口。
- `ftExpiryReminder` 已切到发布版本号 `ftExpiryReminder-2026-06-04-release-v1`。
- `ftExpiryReminder` 定时触发器已改为每天 9 点：`0 0 9 * * * *`。
- `ftAnalyzeImage` 和 `ftExpiryReminder` 的 `wx-server-sdk` 已锁定为 `3.0.4`。
- 技术设置页已从小程序页面列表中移除。

## 已确认的后台配置

- 微信后台已配置《小程序用户隐私保护指引》，覆盖相机、相册、图片上传/存储、用户标识、订阅消息等用途。
- `ftExpiryReminder` 已有 `EXPIRY_REMINDER_TEMPLATE_ID` 环境变量。
- `ftAnalyzeImage` 已有 `OPENAI_COMPAT_RELAYS` 环境变量。
- 云数据库集合已创建，用户私有数据集合应保持仅创建者读写。

## 明天验证事项

### 1. 隐私授权真机验证

使用未同意过隐私协议的微信号打开体验版：

1. 进入拍照/选图入口。
2. 点击“拍照或选图”。
3. 确认先弹出隐私确认弹窗。
4. 点击“查看隐私协议”，确认能打开微信后台配置的隐私协议。
5. 点击“暂不使用”，确认不会继续打开相机或相册。
6. 再次点击“拍照或选图”，点击“同意并继续”，确认可以继续选择图片。

需要覆盖这些入口：

- `pages/capture/index`
- `pages/capture/review`
- `pages/container/edit`
- `pages/container/detail`

### 2. 图片识别链路验证

1. 使用体验版拍摄或选择一张箱内照片。
2. 确认识别进度层正常展示。
3. 确认识别结果进入确认页。
4. 保存容器。
5. 在首页、容器列表、搜索页确认照片和物品记录可见。
6. 云函数日志确认 `ftAnalyzeImage` 使用 `OPENAI_COMPAT_RELAYS`，且通道 `hasApiKey: true`。

### 3. 到期提醒链路验证

1. 在物品编辑器里给一个物品设置到期日期和提醒。
2. 接受一次订阅消息授权。
3. 云函数测试 `ftExpiryReminder`：

```json
{ "action": "config" }
```

期望：

```json
{
  "version": "ftExpiryReminder-2026-06-04-release-v1",
  "hasTemplateId": true
}
```

4. 使用测试时间触发到期扫描。
5. 确认 `ft_reminder_notices` 写入 `pending` 记录。
6. 确认首页能展示到期提醒入口。
7. 如果订阅消息发送失败，确认能降级为小程序内提醒。

### 4. 云端部署确认

- 重新部署 `ftAnalyzeImage`。
- 重新部署 `ftExpiryReminder`，确认触发器生效。
- 确认云函数环境变量没有明文出现在代码仓库中。
- 确认 `ft_containers`、`ft_items`、`ft_reminder_notices` 为仅创建者读写。
- 确认运营集合 `ft_ops_config`、`ft_user_quota_overrides`、`ft_abuse_flags`、`ft_user_usage` 不开放给普通用户直接读写。

### 5. 提审前最后检查

- 微信开发者工具预览体验版。
- 真机走通拍照、识别、编辑、保存、搜索、删除流程。
- 真机走通隐私拒绝和同意路径。
- 真机走通订阅消息接受和拒绝路径。
- 上传代码后，在提交审核的信息填写页再次检查隐私保护指引是否与当前版本接口调用一致。

## 本地验证命令

推送前应运行：

```powershell
npm test
$files = rg --files -g '*.js'; foreach ($f in $files) { node --check $f | Out-Null; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
node -e "for(const f of ['miniprogram/app.json','project.config.json','miniprogram/sitemap.json','cloudfunctions/ftExpiryReminder/config.json']){JSON.parse(require('fs').readFileSync(f,'utf8')); console.log('ok '+f)}"
```

## 备注

- 当前只剩真机和微信后台提审前验证，不再保留已知代码侧阻塞项。
- 若明天验证发现云端行为和本地测试不一致，优先检查云函数是否重新部署、环境变量是否在对应云函数上生效。
