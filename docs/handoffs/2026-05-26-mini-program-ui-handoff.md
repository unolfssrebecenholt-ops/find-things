# 2026-05-26 小程序 UI 开发交接

## 当前目标

把 `find-things` 小程序做成接近 `docs/prototypes/visual-storage-ui.html` 的首版高保真原型。项目名使用 `find-things`，`v1` 只作为当前首版版本名称。

## 已完成

- 小程序项目配置已指向根目录导入：
  - `project.config.json` 的 `projectname` 是 `find-things`
  - `miniprogramRoot` 是 `miniprogram/`
  - `appid` 是 `wxebb5b2dc618082a5`
- 已配置 CloudBase 环境信息：
  - `miniprogram/config/cloud.js`
  - `envId` 是 `cloud1-d2g79srh64b6eb263`
  - 集合统一加 `ft_` 前缀，降低和同云环境其他项目混用的风险。
- 已实现本地 mock 小程序骨架：
  - 首页
  - 拍照/选图入口
  - 识别确认
  - 容器编辑
  - 容器详情
  - 找东西
  - 设置页
- 已实现多张箱内照片的数据模型：
  - 默认免费 2 张
  - 超出时给升级提示
  - 兼容旧的单图 `contentImageFileId`
  - 支持按指定照片重新识别并替换该照片下的物品
- 已实现语义搜索雏形：
  - 名称、别名、类别、颜色、描述、容器信息混合打分
  - 支持“书 / 黑色签字笔 / 蓝色封面的书 / 蓝色发卡”等查询
  - 修复了颜色词误召回，比如“红色钥匙”不再错误命中红柄螺丝刀。
- 已按 HTML 原型继续修 UI：
  - 首页暖白背景、绿色主按钮、2x2 相册网格、底部三栏导航
  - 识别确认页改成“标注图 + 输入预览 + 精简列表”，保留底部“拍下一张”
  - 搜索页结果改成照片优先卡片，匹配原因使用暖黄 pill，“查看容器”使用绿色 pill
  - 容器详情保留轮播图指示器，不再用“照片 1 / 照片 2”按钮切换
  - 容器详情支持“重新识别这张”和“添加照片”
  - 去掉了明显 demo 痕迹，如“本地 / mock”统计项。

## 重要文件

- UI 参考原型：`docs/prototypes/visual-storage-ui.html`
- 小程序入口：`miniprogram/app.json`
- 全局样式：`miniprogram/app.wxss`
- 首页：`miniprogram/pages/home/`
- 识别确认页：`miniprogram/pages/capture/review.*`
- 搜索页：`miniprogram/pages/search/`
- 容器详情：`miniprogram/pages/container/detail.*`
- 搜索结果卡片：`miniprogram/components/search-result-card/`
- 标注图组件：`miniprogram/components/annotated-image/`
- 本地数据：`miniprogram/services/storage.js`
- 搜索服务：`miniprogram/services/search.js`
- 语义匹配：`miniprogram/utils/semantic.js`
- 测试：`tests/`

## 验证状态

已通过：

```powershell
npm test
Get-ChildItem -Path miniprogram,tests -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
node -e "JSON.parse(require('fs').readFileSync('project.config.json','utf8')); JSON.parse(require('fs').readFileSync('miniprogram/app.json','utf8')); console.log('json ok')"
rg -n "wx:else|wx:elif|\{\{!|\|\|" miniprogram -g "*.wxml"
```

结果：

- `npm test`：32/32 pass
- JS 语法检查：通过
- JSON 配置检查：通过
- WXML 条件表达式扫描：通过，无 `wx:else`、`wx:elif`、`{{! ...}}`、`||`

## 当前问题

1. 微信开发者工具模拟器曾经能显示首页主体，但在后续自动重编译后出现白屏，只剩导航栏标题“拍箱找物”。
2. 控制台可见错误：
   - `cloud init error: Failed to fetch`
   - `SystemError (appServiceSDKScriptError) errmsg: "webapi_getwxasyncsecinfo:fail Failed to fetch"`
   - `Error: timeout`
3. 已把 `miniprogram/app.js` 改为 mockMode 下跳过 `wx.cloud.init`，避免本地 UI 评审被云初始化卡住。但白屏仍可能和微信开发者工具运行时、网络、缓存或登录态有关。
4. DevTools CLI 自动化命令尝试过：

```powershell
& 'F:\weixindevtool\微信web开发者工具\cli.bat' auto --project 'F:\projects\find-things' --port 9420 --trust-project
```

该命令超时，没有得到可用的自动化调试通道。

## 明天建议继续顺序

1. 在另一台电脑拉取仓库后，先运行：

```powershell
npm test
```

2. 用微信开发者工具导入项目时选择仓库根目录，不要选 `miniprogram`：

```text
F:\projects\find-things
```

3. 如果模拟器仍白屏，优先处理开发者工具运行环境：
   - 清缓存并重新编译
   - 确认微信开发者工具已登录
   - 确认网络能访问微信开发者工具所需服务
   - 暂时关闭真机调试/云相关调试
   - 看控制台第一条实际业务错误，不要只看后续 timeout
4. 白屏解决后，人工复核四个核心页面：
   - 首页：相册网格和底部三栏导航是否可见
   - 识别确认：是否像原型一样简洁，且有“拍下一张”
   - 找东西：结果卡是否照片优先，原因 pill 是否清楚
   - 容器详情：轮播指示器、多图、重新识别/添加照片入口是否自然
5. 如果 UI 方向确认，再接真实云数据库、云函数和真实视觉识别服务。

## 注意

- `output/` 目录只是本机验证截图和临时图片，不需要提交。
- `project.private.config.json` 是微信开发者工具本机私有配置，不需要提交。
- 当前实现仍是本地 mock 数据，不要误认为已经接入真实后端云存储或真实 AI 识别。
