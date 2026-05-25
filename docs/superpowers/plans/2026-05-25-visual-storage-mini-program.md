# 拍箱找物小程序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 开发一个微信小程序 MVP，让用户拍一张抽屉/箱内照片，AI 预填物品清单，用户确认后绑定容器，并能用文字搜索找回对应容器照片；语音入口在第一版预留，真实语音识别放到后续阶段。

**Architecture:** 第一阶段用微信小程序原生前端 + 本地/云端 mock 数据跑通完整交互；第二阶段接入云开发和视觉模型。物品标框不使用图生图重绘，而是由模型返回结构化坐标，前端在原图上叠加虚线框和序号，确保原始照片不被篡改。

**Tech Stack:** 微信小程序原生 WXML/WXSS/JS，微信云开发 CloudBase，云函数 Node.js，云数据库，云存储，AI 服务通过后端云函数代理调用，前端不保存 API key。

---

## 1. 产品定位

产品名：拍箱找物。

一句话：拍一下箱子/抽屉，之后一句话找到东西在哪。

首发场景：搬家、换季、租房、小户型储物、囤货、母婴、露营/摄影/手作装备。第一版不要做“全家资产管理”，只验证用户是否愿意在收纳时多拍一张图，换取以后少翻箱倒柜。

## 2. MVP 范围

必须做：

- 拍摄或上传一张箱内/抽屉内照片。
- AI 或 mock AI 识别多个物品，生成物品名称、类别、颜色、可见文字、描述、置信度、位置框。
- 原图叠加虚线框和序号。
- 下方展示可编辑清单，用户可以确认、改名、删除、补充备注。
- 拍摄或上传容器外观照片，填写容器名称和位置。
- 保存容器和物品。
- 搜索物品，返回候选物品、匹配原因和对应容器照片。
- 结果支持“找一本书”这类宽泛查询，返回多个候选，而不是强行只给一个答案。
- 基础隐私提示：上传图片用于识别，用户确认后保存；支持删除容器及其物品。

第一版暂不做：

- 支付。
- 家庭多人协作。
- 完整语音识别链路。
- 复杂资产估值。
- 社区内容。
- 图像生成重绘标注图。
- 保质期管理。
- 专业收纳师项目管理。

## 3. 用户流程

### 3.1 首次打开

页面显示三个入口：

- 拍一箱
- 找东西
- 我的容器

底部用一句话解释当前价值：拍下箱内物品，之后一句话找到它在哪。

### 3.2 拍一箱流程

1. 用户点击“拍一箱”。
2. 小程序调用相机或相册选择箱内照片。
3. 前端上传图片到临时存储或云存储。
4. 调用 `analyzeImage` 云函数。
5. 云函数第一阶段返回 mock 识别结果；第二阶段调用真实视觉模型。
6. 前端展示原图，并根据 `bbox` 叠加虚线框和序号。
7. 前端展示识别清单，默认勾选全部物品。
8. 用户可以编辑名称、删除误识别、补充备注。
9. 用户点击“下一步：拍容器”。
10. 用户拍容器外观照片，填写容器名称，例如“书桌左侧抽屉”“卧室 3 号箱”。
11. 用户点击保存。
12. 小程序保存容器、箱内照片、容器照片、确认后的物品清单。
13. 保存成功后进入容器详情页。

### 3.3 找东西流程

1. 用户进入“找东西”。
2. 输入“蓝色发卡”“三体”“一本书”“黑色笔”“蓝色封面的书”等描述。
3. 前端调用 `searchItems` 云函数或本地搜索服务。
4. 搜索返回候选物品，按容器聚合。
5. 页面展示：
   - 物品名称
   - 匹配原因
   - 对应容器名称
   - 容器照片
   - 箱内照片局部或标框位置
6. 用户点击结果进入容器详情。

## 4. 信息架构

推荐页面：

- `pages/home`：首页，展示快捷入口、最近容器、最近搜索。
- `pages/capture/index`：拍一箱流程入口。
- `pages/capture/review`：AI 识别结果确认页。
- `pages/container/edit`：容器照片和位置编辑页。
- `pages/container/detail`：容器详情页，展示容器照片、箱内照片、物品列表。
- `pages/search/index`：搜索页。
- `pages/settings/index`：隐私、导出、清空数据、AI 服务状态。

推荐组件：

- `components/annotated-image`：在原图上叠加 bbox、虚线框、序号。
- `components/item-editor`：可编辑物品清单。
- `components/container-card`：容器卡片。
- `components/search-result-card`：搜索结果卡片。
- `components/privacy-notice`：图片识别和保存提示。

## 5. 推荐代码结构

```text
miniprogram/
  app.js
  app.json
  app.wxss
  pages/
    home/
      index.js
      index.json
      index.wxml
      index.wxss
    capture/
      index.js
      index.json
      index.wxml
      index.wxss
      review.js
      review.json
      review.wxml
      review.wxss
    container/
      edit.js
      edit.json
      edit.wxml
      edit.wxss
      detail.js
      detail.json
      detail.wxml
      detail.wxss
    search/
      index.js
      index.json
      index.wxml
      index.wxss
    settings/
      index.js
      index.json
      index.wxml
      index.wxss
  components/
    annotated-image/
      index.js
      index.json
      index.wxml
      index.wxss
    item-editor/
      index.js
      index.json
      index.wxml
      index.wxss
    container-card/
      index.js
      index.json
      index.wxml
      index.wxss
    search-result-card/
      index.js
      index.json
      index.wxml
      index.wxss
    privacy-notice/
      index.js
      index.json
      index.wxml
      index.wxss
  services/
    ai.js
    storage.js
    search.js
    mock-ai.js
  utils/
    geometry.js
    scoring.js
    normalize.js
cloudfunctions/
  analyzeImage/
    index.js
    package.json
  createQrCode/
    index.js
    package.json
  saveCapture/
    index.js
    package.json
  searchItems/
    index.js
    package.json
  deleteContainer/
    index.js
    package.json
docs/
  privacy-notes.md
  test-cases.md
```

## 6. 数据模型

### 6.1 Container

```json
{
  "_id": "container_xxx",
  "userId": "openid_xxx",
  "name": "书桌左侧抽屉",
  "locationPath": "卧室 / 书桌 / 左侧抽屉",
  "coverImageFileId": "cloud://container-photo.jpg",
  "contentImageFileId": "cloud://drawer-content.jpg",
  "itemCount": 5,
  "createdAt": 1779630000000,
  "updatedAt": 1779630000000,
  "deletedAt": null
}
```

### 6.2 Item

```json
{
  "_id": "item_xxx",
  "userId": "openid_xxx",
  "containerId": "container_xxx",
  "displayName": "蓝色发卡",
  "aiName": "蓝色发卡",
  "category": "accessory",
  "colors": ["蓝色"],
  "visibleText": "",
  "description": "一个蓝色弧形发卡，位于抽屉右下角",
  "aliases": ["蓝色发箍", "发夹", "头饰"],
  "bbox": {
    "x": 0.68,
    "y": 0.62,
    "width": 0.18,
    "height": 0.16
  },
  "confidence": 0.82,
  "sourceImageFileId": "cloud://drawer-content.jpg",
  "confirmed": true,
  "createdAt": 1779630000000,
  "updatedAt": 1779630000000,
  "deletedAt": null
}
```

### 6.3 QueryLog

```json
{
  "_id": "query_xxx",
  "userId": "openid_xxx",
  "query": "帮我找一本书",
  "matchedItemIds": ["item_1", "item_2"],
  "createdAt": 1779630000000
}
```

## 7. AI 识别接口设计

### 7.1 analyzeImage 入参

```json
{
  "imageFileId": "cloud://drawer-content.jpg",
  "mode": "container_content",
  "locale": "zh-CN"
}
```

### 7.2 analyzeImage 出参

```json
{
  "items": [
    {
      "tempId": "1",
      "displayName": "蓝色绘画本",
      "category": "notebook",
      "colors": ["蓝色"],
      "visibleText": "",
      "description": "蓝色壳子的绘画本，位于抽屉左侧",
      "aliases": ["蓝色笔记本", "绘画本", "本子"],
      "bbox": { "x": 0.08, "y": 0.18, "width": 0.32, "height": 0.28 },
      "confidence": 0.86,
      "uncertaintyReason": ""
    },
    {
      "tempId": "2",
      "displayName": "黑色笔",
      "category": "pen",
      "colors": ["黑色"],
      "visibleText": "",
      "description": "一支黑色笔，位于抽屉中部偏左",
      "aliases": ["黑笔", "签字笔"],
      "bbox": { "x": 0.36, "y": 0.44, "width": 0.22, "height": 0.06 },
      "confidence": 0.8,
      "uncertaintyReason": ""
    },
    {
      "tempId": "3",
      "displayName": "《三体》",
      "category": "book",
      "colors": [],
      "visibleText": "三体",
      "description": "一本书，封面可见三体字样",
      "aliases": ["三体", "科幻书", "书"],
      "bbox": { "x": 0.44, "y": 0.08, "width": 0.3, "height": 0.24 },
      "confidence": 0.9,
      "uncertaintyReason": ""
    },
    {
      "tempId": "4",
      "displayName": "蓝色封面的书",
      "category": "book",
      "colors": ["蓝色"],
      "visibleText": "",
      "description": "一本蓝色封面的书，书名不清晰",
      "aliases": ["蓝色书", "书", "疑似西游记"],
      "bbox": { "x": 0.58, "y": 0.34, "width": 0.28, "height": 0.25 },
      "confidence": 0.62,
      "uncertaintyReason": "书名不清晰，不能确定是否为《西游记》"
    }
  ],
  "warnings": [
    "部分物品有遮挡，建议用户确认名称"
  ]
}
```

## 8. 搜索设计

第一版不直接上复杂向量数据库，先做可解释的混合打分：

- `displayName` 命中：+50
- `aliases` 命中：+35
- `category` 命中：+30
- `visibleText` 命中：+30
- `description` 命中：+15
- `colors` 命中：+10
- 容器名称/位置命中：+10

查询“帮我找一本书”时：

- 归一化成关键词：`书`、`book`
- 匹配 `category=book` 和 aliases 中含“书”的物品
- 返回所有候选书籍，并按置信度、最近创建时间和匹配分排序

第二版再接 embedding：

- 用户确认后为每个 item 生成 `searchText`：名称 + 别名 + 类别 + 颜色 + 描述 + 容器路径。
- 为 `searchText` 生成 embedding。
- 小数据量阶段可在云函数中拉取用户全部物品并做余弦相似度。
- 单用户超过 1000 个物品后再评估向量数据库或专门检索服务。

## 9. 开发阶段

### Task 1: 小程序骨架和首页

**Files:**
- Create: `miniprogram/app.js`
- Create: `miniprogram/app.json`
- Create: `miniprogram/app.wxss`
- Create: `miniprogram/pages/home/index.js`
- Create: `miniprogram/pages/home/index.json`
- Create: `miniprogram/pages/home/index.wxml`
- Create: `miniprogram/pages/home/index.wxss`

- [ ] 创建微信小程序原生项目结构。
- [ ] 配置首页、拍一箱、搜索、容器详情、设置页路由。
- [ ] 首页提供“拍一箱”“找东西”“我的容器”三个入口。
- [ ] 使用 mock 数据展示最近容器。
- [ ] 在微信开发者工具中能打开首页。
- [ ] Commit: `feat: scaffold mini program shell`

### Task 2: mock AI 和识别结果确认页

**Files:**
- Create: `miniprogram/services/mock-ai.js`
- Create: `miniprogram/pages/capture/index.js`
- Create: `miniprogram/pages/capture/index.json`
- Create: `miniprogram/pages/capture/index.wxml`
- Create: `miniprogram/pages/capture/index.wxss`
- Create: `miniprogram/pages/capture/review.js`
- Create: `miniprogram/pages/capture/review.json`
- Create: `miniprogram/pages/capture/review.wxml`
- Create: `miniprogram/pages/capture/review.wxss`
- Create: `miniprogram/components/annotated-image/*`
- Create: `miniprogram/components/item-editor/*`
- Create: `miniprogram/utils/geometry.js`

- [ ] 实现图片选择，优先使用 `wx.chooseMedia`。
- [ ] mock AI 返回 4-6 个物品和归一化 bbox。
- [ ] `annotated-image` 根据原图尺寸和 bbox 画虚线框和序号。
- [ ] `item-editor` 支持改名、删除、勾选/取消。
- [ ] 保存 review 页面状态，刷新或返回时不丢失当前识别结果。
- [ ] Commit: `feat: add mocked image recognition review`

### Task 3: 容器创建和本地保存

**Files:**
- Create: `miniprogram/pages/container/edit.js`
- Create: `miniprogram/pages/container/edit.json`
- Create: `miniprogram/pages/container/edit.wxml`
- Create: `miniprogram/pages/container/edit.wxss`
- Create: `miniprogram/pages/container/detail.js`
- Create: `miniprogram/pages/container/detail.json`
- Create: `miniprogram/pages/container/detail.wxml`
- Create: `miniprogram/pages/container/detail.wxss`
- Create: `miniprogram/services/storage.js`

- [ ] 识别确认后进入容器编辑页。
- [ ] 用户上传容器外观照片。
- [ ] 用户填写容器名称和位置。
- [ ] 使用 `wx.setStorageSync` 保存容器和物品，作为第一阶段本地数据层。
- [ ] 容器详情页展示容器照片、箱内照片、物品列表、标注图。
- [ ] 支持删除容器，同时删除其物品。
- [ ] Commit: `feat: save containers locally`

### Task 4: 本地搜索

**Files:**
- Create: `miniprogram/pages/search/index.js`
- Create: `miniprogram/pages/search/index.json`
- Create: `miniprogram/pages/search/index.wxml`
- Create: `miniprogram/pages/search/index.wxss`
- Create: `miniprogram/components/search-result-card/*`
- Create: `miniprogram/services/search.js`
- Create: `miniprogram/utils/scoring.js`
- Create: `miniprogram/utils/normalize.js`

- [ ] 实现搜索框。
- [ ] 对查询做简单归一化：去掉“帮我找”“在哪”“一个”“一本”等弱词。
- [ ] 实现关键词和类别映射，例如“书”映射到 `book`。
- [ ] 按第 8 节打分规则返回结果。
- [ ] 搜索结果按容器聚合，显示容器照片和匹配原因。
- [ ] 查询“书”时返回多个候选书籍。
- [ ] Commit: `feat: add local item search`

### Task 5: 云开发数据层

**Files:**
- Create: `cloudfunctions/saveCapture/index.js`
- Create: `cloudfunctions/saveCapture/package.json`
- Create: `cloudfunctions/searchItems/index.js`
- Create: `cloudfunctions/searchItems/package.json`
- Modify: `miniprogram/services/storage.js`
- Modify: `miniprogram/services/search.js`

- [ ] 初始化云开发环境配置。
- [ ] 创建 `containers`、`items`、`queryLogs` 集合。
- [ ] `saveCapture` 写入容器和物品。
- [ ] `searchItems` 从云数据库读取当前用户物品并搜索。
- [ ] 前端保留本地 mock 模式开关，云开发未配置时仍能演示。
- [ ] Commit: `feat: add cloud persistence`

### Task 6: 真实 AI 识别代理

**Files:**
- Create: `cloudfunctions/analyzeImage/index.js`
- Create: `cloudfunctions/analyzeImage/package.json`
- Create: `miniprogram/services/ai.js`
- Modify: `miniprogram/pages/capture/index.js`

- [ ] `analyzeImage` 接收云存储图片 fileId。
- [ ] 云函数读取临时访问链接并调用视觉模型。
- [ ] 使用固定 JSON schema 要求模型输出物品清单和归一化 bbox。
- [ ] 云函数校验响应：缺 bbox 的物品不画框；缺名称的物品命名为“未命名物品”。
- [ ] 失败时返回可理解错误：“识别失败，请重试或手动添加物品”。
- [ ] 前端支持 mock/real 两种 AI 模式。
- [ ] Commit: `feat: proxy image analysis through cloud function`

### Task 7: QR 标签和扫码查看

**Files:**
- Create: `cloudfunctions/createQrCode/index.js`
- Create: `cloudfunctions/createQrCode/package.json`
- Modify: `miniprogram/pages/container/detail.js`
- Modify: `miniprogram/pages/container/detail.wxml`
- Modify: `miniprogram/app.js`

- [ ] 容器详情页显示“生成标签码”。
- [ ] 云函数生成带 containerId scene 的小程序码。
- [ ] 用户扫码后打开对应容器详情。
- [ ] 没有权限或容器不存在时显示友好错误。
- [ ] Commit: `feat: add container qr codes`

### Task 8: 隐私、删除和导出

**Files:**
- Create: `miniprogram/pages/settings/index.js`
- Create: `miniprogram/pages/settings/index.json`
- Create: `miniprogram/pages/settings/index.wxml`
- Create: `miniprogram/pages/settings/index.wxss`
- Create: `miniprogram/components/privacy-notice/*`
- Create: `cloudfunctions/deleteContainer/index.js`
- Create: `cloudfunctions/deleteContainer/package.json`
- Create: `docs/privacy-notes.md`

- [ ] 首次 AI 识别前展示隐私提示。
- [ ] 设置页说明：图片用途、保存位置、删除方式。
- [ ] 支持删除所有本地数据。
- [ ] 云端模式支持删除容器及关联物品。
- [ ] 导出 JSON，方便用户备份。
- [ ] Commit: `feat: add privacy controls and export`

### Task 9: 验收测试和开发者文档

**Files:**
- Create: `docs/test-cases.md`
- Create: `README.md`

- [ ] 写 10 条手动测试用例。
- [ ] 覆盖拍照、mock 识别、编辑清单、保存容器、搜索、删除。
- [ ] 写开发启动说明，包括微信开发者工具导入路径、云函数部署、mock 模式开关。
- [ ] 记录 AI key 只允许放在云函数环境变量里。
- [ ] Commit: `docs: add mini program test and setup guide`

## 10. 验收标准

MVP 开发完成时必须满足：

- 新用户 1 分钟内能完成一次“拍照 -> 确认 -> 保存容器”。
- 单张照片 mock 识别结果能显示标框和序号。
- 用户可以编辑 AI 默认名称。
- 用户输入“书”“黑色笔”“蓝色发卡”能找到对应物品。
- 搜索结果显示容器照片，而不只是文字。
- 删除容器后，搜索结果不再出现该容器内物品。
- 没有配置 AI key 时，小程序仍能用 mock 模式完整演示。
- API key 不出现在前端代码和提交历史中。

## 11. 两周开发节奏

第 1-2 天：小程序骨架、首页、mock 数据。

第 3-4 天：拍照、mock AI、标框组件、确认清单。

第 5-6 天：容器保存、详情页、本地搜索。

第 7 天：整理一次可演示版本，用真实用户照片做人工测试。

第 8-10 天：接入云开发、云数据库、云存储。

第 11-12 天：接入真实视觉模型云函数，保留 mock fallback。

第 13 天：QR 标签、隐私页、删除和导出。

第 14 天：手动测试、修复体验问题、准备 3 条短视频/图文验证脚本。

## 12. Codex 开发提示词

启动开发时可直接给 Codex：

```text
请按照 docs/superpowers/plans/2026-05-25-visual-storage-mini-program.md 开发“拍箱找物”微信小程序 MVP。

先实现 Task 1 到 Task 4，使用微信小程序原生 WXML/WXSS/JS，不接真实 AI，不接支付。必须保证没有 AI key 时也能用 mock 数据完整演示：拍照/选图、显示标框编号、编辑识别清单、保存容器、搜索物品并返回容器照片。

每完成一个 Task 运行可执行的检查命令，提交一次 git commit。不要把 API key 写进前端或仓库。
```

## 13. 后续验证指标

- 10 个测试用户中，至少 6 个愿意当场拍 3 个容器。
- 单张照片从上传到可确认清单的等待时间小于 20 秒。
- 用户确认一张图的平均时间小于 30 秒。
- 一周后至少 3 个用户回来搜索或补录。
- 至少 3 个用户愿意为更多容器、QR 标签或 AI 识别额度支付 9.9-29.9 元。
