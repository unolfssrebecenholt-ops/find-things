const CONTAINERS_KEY = 'findThings.containers';
const ITEMS_KEY = 'findThings.items';
const FREE_CONTENT_IMAGE_LIMIT = 2;

function now() {
  return Date.now();
}

function createId(prefix) {
  return `${prefix}_${now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function stableImageId(fileId) {
  const text = String(fileId || 'empty');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) >>> 0;
  }
  return `legacy_image_${hash.toString(36)}`;
}

function getWxAdapter() {
  if (typeof wx !== 'undefined') {
    return wx;
  }
  const memory = {};
  return {
    getStorageSync(key) {
      return memory[key];
    },
    setStorageSync(key, value) {
      memory[key] = value;
    },
    removeStorageSync(key) {
      delete memory[key];
    }
  };
}

function readArray(adapter, key) {
  const value = adapter.getStorageSync(key);
  return Array.isArray(value) ? value : [];
}

function writeArray(adapter, key, value) {
  adapter.setStorageSync(key, Array.isArray(value) ? value : []);
}

function createContentImage(input, index, timestamp) {
  const fileId = typeof input === 'string' ? input : (input && input.fileId) || '';
  return {
    imageId: (input && input.imageId) || stableImageId(fileId),
    fileId,
    label: (input && input.label) || `箱内照片 ${index + 1}`,
    sortOrder: Number.isFinite(input && input.sortOrder) ? input.sortOrder : index,
    createdAt: (input && input.createdAt) || timestamp,
    itemCount: Number.isFinite(input && input.itemCount) ? input.itemCount : 0,
    orientation: (input && input.orientation) || '',
    width: Number.isFinite(input && input.width) ? input.width : 0,
    height: Number.isFinite(input && input.height) ? input.height : 0,
    analyzeStatus: (input && input.analyzeStatus) || '',
    analyzedAt: (input && input.analyzedAt) || 0
  };
}

function normalizeContentImages(input, timestamp) {
  const candidates = [];
  if (Array.isArray(input.contentImages)) {
    candidates.push(...input.contentImages);
  } else if (Array.isArray(input.contentImageFileIds)) {
    candidates.push(...input.contentImageFileIds);
  } else if (input.contentImageFileId) {
    candidates.push(input.contentImageFileId);
  }
  return candidates
    .filter((image) => typeof image === 'string' ? image : image && image.fileId)
    .map((image, index) => createContentImage(image, index, timestamp));
}

function findSourceImage(rawItem, container) {
  const images = container.contentImages || [];
  return images.find((image) => rawItem.sourceImageId && image.imageId === rawItem.sourceImageId)
    || images.find((image) => rawItem.sourceImageFileId && image.fileId === rawItem.sourceImageFileId)
    || images[0]
    || null;
}

function normalizeItem(rawItem, container, timestamp) {
  const itemId = rawItem._id || createId('item');
  const sourceImage = findSourceImage(rawItem, container);
  const sourceImageIndex = sourceImage
    ? (container.contentImages || []).findIndex((image) => image.imageId === sourceImage.imageId)
    : -1;
  const sourceImageLabel = sourceImage
    ? (sourceImage.label || `照片 ${sourceImageIndex + 1}`)
    : '';
  const relativePosition = (rawItem.relativePosition || rawItem.positionText || '').trim();
  const locationText = (rawItem.locationText || [sourceImageLabel, relativePosition].filter(Boolean).join(' · ')).trim();
  return Object.assign({}, rawItem, {
    _id: itemId,
    containerId: container._id,
    sourceImageId: sourceImage ? sourceImage.imageId : (rawItem.sourceImageId || ''),
    sourceImageFileId: sourceImage ? sourceImage.fileId : (rawItem.sourceImageFileId || container.contentImageFileId || ''),
    sourceImageIndex: sourceImageIndex >= 0 ? sourceImageIndex : 0,
    sourceImageLabel,
    relativePosition,
    locationText,
    confirmed: rawItem.confirmed !== false,
    createdAt: rawItem.createdAt || timestamp,
    updatedAt: timestamp,
    deletedAt: null
  });
}

function refreshContentImageCounts(container, items) {
  const countByImageId = (items || []).reduce((counts, item) => {
    if (item.sourceImageId) {
      counts[item.sourceImageId] = (counts[item.sourceImageId] || 0) + 1;
    }
    return counts;
  }, {});
  const contentImages = (container.contentImages || []).map((image, index) => Object.assign({}, image, {
    sortOrder: Number.isFinite(image.sortOrder) ? image.sortOrder : index,
    itemCount: countByImageId[image.imageId] || 0
  }));
  return Object.assign({}, container, {
    contentImages,
    contentImageFileId: contentImages[0] ? contentImages[0].fileId : '',
    itemCount: (items || []).length
  });
}

function isMockAssetPath(filePath) {
  return typeof filePath === 'string' && filePath.indexOf('/assets/mock-') === 0;
}

function isDemoImage(image) {
  if (!image) return false;
  return String(image.imageId || '').indexOf('demo_') === 0
    || isMockAssetPath(image.fileId);
}

function isDemoContainer(container) {
  if (!container) return false;
  if (container.demo === true || container.source === 'demo') return true;
  if (isMockAssetPath(container.coverImageFileId) || isMockAssetPath(container.contentImageFileId)) return true;
  return (container.contentImages || []).some(isDemoImage);
}

function isDemoItem(item) {
  if (!item) return false;
  return item.demo === true
    || item.source === 'demo'
    || String(item.sourceImageId || '').indexOf('demo_') === 0
    || isMockAssetPath(item.sourceImageFileId);
}

function isItemFromImage(item, image) {
  return (image.imageId && item.sourceImageId === image.imageId)
    || (image.fileId && item.sourceImageFileId === image.fileId);
}

function createStorageService(adapter) {
  const storage = adapter || getWxAdapter();

  function listContainers() {
    return readArray(storage, CONTAINERS_KEY)
      .filter((container) => !container.deletedAt)
      .map((container) => {
        const contentImages = normalizeContentImages(container, container.updatedAt || now());
        return Object.assign({}, container, {
          contentImages,
          contentImageFileId: contentImages[0] ? contentImages[0].fileId : (container.contentImageFileId || '')
        });
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function listItems() {
    return readArray(storage, ITEMS_KEY).filter((item) => !item.deletedAt);
  }

  function listUserContainers() {
    return listContainers().filter((container) => !isDemoContainer(container));
  }

  function listUserItems() {
    const userContainerIds = listUserContainers().reduce((ids, container) => {
      ids[container._id] = true;
      return ids;
    }, {});
    return listItems().filter((item) => userContainerIds[item.containerId] && !isDemoItem(item));
  }

  function getContainer(id) {
    return listContainers().find((container) => container._id === id) || null;
  }

  function getItemsByContainer(id) {
    return listItems().filter((item) => item.containerId === id);
  }

  function saveContainer(input) {
    const timestamp = now();
    let container = {
      _id: input._id || createId('container'),
      name: (input.name || '未命名容器').trim() || '未命名容器',
      locationPath: (input.locationPath || '').trim(),
      coverImageFileId: input.coverImageFileId || '',
      contentImages: normalizeContentImages(input, timestamp),
      contentImageFileId: '',
      itemCount: 0,
      createdAt: input.createdAt || timestamp,
      updatedAt: timestamp,
      deletedAt: null
    };
    container.contentImageFileId = container.contentImages[0] ? container.contentImages[0].fileId : '';

    const items = (input.items || [])
      .filter((item) => item.confirmed !== false)
      .map((item) => normalizeItem(item, container, timestamp));
    container = refreshContentImageCounts(container, items);

    const otherContainers = listContainers().filter((item) => item._id !== container._id);
    const otherItems = listItems().filter((item) => item.containerId !== container._id);
    writeArray(storage, CONTAINERS_KEY, [container].concat(otherContainers));
    writeArray(storage, ITEMS_KEY, items.concat(otherItems));
    return { container, items };
  }

  function getContentImages(containerId) {
    const container = getContainer(containerId);
    return container ? (container.contentImages || []).slice() : [];
  }

  function addContentImage(containerId, imageInput) {
    const timestamp = now();
    const containers = readArray(storage, CONTAINERS_KEY);
    const target = containers.find((container) => container._id === containerId && !container.deletedAt);
    if (!target) throw new Error('容器不存在');

    const existing = normalizeContentImages(target, timestamp);
    if (existing.length >= FREE_CONTENT_IMAGE_LIMIT) {
      const error = new Error(`免费版最多支持 ${FREE_CONTENT_IMAGE_LIMIT} 张箱内照片，请升级后继续添加。`);
      error.code = 'CONTENT_IMAGE_LIMIT_REACHED';
      error.limit = FREE_CONTENT_IMAGE_LIMIT;
      throw error;
    }

    const updatedContainer = Object.assign({}, target, {
      contentImages: existing.concat(createContentImage(imageInput || {}, existing.length, timestamp)),
      updatedAt: timestamp
    });
    updatedContainer.contentImageFileId = updatedContainer.contentImages[0] ? updatedContainer.contentImages[0].fileId : '';

    writeArray(storage, CONTAINERS_KEY, containers.map((container) => (
      container._id === containerId ? updatedContainer : container
    )));
    return updatedContainer;
  }

  function replaceItemsForImage(containerId, imageId, items) {
    const timestamp = now();
    const containers = readArray(storage, CONTAINERS_KEY);
    const target = containers.find((container) => container._id === containerId && !container.deletedAt);
    if (!target) throw new Error('容器不存在');

    const container = Object.assign({}, target, {
      contentImages: normalizeContentImages(target, timestamp),
      contentImageFileId: target.contentImageFileId || ''
    });
    const image = container.contentImages.find((contentImage) => contentImage.imageId === imageId);
    if (!image) throw new Error('箱内照片不存在');

    const activeItems = listItems();
    const keptContainerItems = activeItems.filter((item) => item.containerId === containerId && !isItemFromImage(item, image));
    const otherItems = activeItems.filter((item) => item.containerId !== containerId);
    const replacementItems = (items || [])
      .filter((item) => item.confirmed !== false)
      .map((item) => normalizeItem(Object.assign({}, item, {
        sourceImageId: image.imageId,
        sourceImageFileId: image.fileId
      }), container, timestamp));
    const nextContainerItems = replacementItems.concat(keptContainerItems);
    const updatedContainer = refreshContentImageCounts(Object.assign({}, container, { updatedAt: timestamp }), nextContainerItems);

    writeArray(storage, CONTAINERS_KEY, [updatedContainer].concat(containers.filter((item) => item._id !== containerId)));
    writeArray(storage, ITEMS_KEY, nextContainerItems.concat(otherItems));
    return { container: updatedContainer, items: nextContainerItems };
  }

  function deleteContainer(id) {
    const timestamp = now();
    const containers = readArray(storage, CONTAINERS_KEY).map((container) => {
      if (container._id !== id) return container;
      return Object.assign({}, container, { deletedAt: timestamp, updatedAt: timestamp });
    });
    const items = readArray(storage, ITEMS_KEY).map((item) => {
      if (item.containerId !== id) return item;
      return Object.assign({}, item, { deletedAt: timestamp, updatedAt: timestamp });
    });
    writeArray(storage, CONTAINERS_KEY, containers);
    writeArray(storage, ITEMS_KEY, items);
  }

  function deleteContainers(ids) {
    const selected = (ids || []).reduce((map, id) => {
      if (id) map[id] = true;
      return map;
    }, {});
    const timestamp = now();
    let deletedCount = 0;
    const containers = readArray(storage, CONTAINERS_KEY).map((container) => {
      if (!selected[container._id] || container.deletedAt) return container;
      deletedCount += 1;
      return Object.assign({}, container, { deletedAt: timestamp, updatedAt: timestamp });
    });
    const items = readArray(storage, ITEMS_KEY).map((item) => {
      if (!selected[item.containerId]) return item;
      return Object.assign({}, item, { deletedAt: timestamp, updatedAt: timestamp });
    });
    writeArray(storage, CONTAINERS_KEY, containers);
    writeArray(storage, ITEMS_KEY, items);
    return { deletedCount };
  }

  function removeDemoData() {
    const demoContainerIds = listContainers().reduce((ids, container) => {
      if (isDemoContainer(container)) {
        ids[container._id] = true;
      }
      return ids;
    }, {});
    const containers = readArray(storage, CONTAINERS_KEY).filter((container) => (
      !demoContainerIds[container._id] && !isDemoContainer(container)
    ));
    const items = readArray(storage, ITEMS_KEY).filter((item) => (
      !demoContainerIds[item.containerId] && !isDemoItem(item)
    ));
    writeArray(storage, CONTAINERS_KEY, containers);
    writeArray(storage, ITEMS_KEY, items);
    return { containers: listContainers(), items: listItems() };
  }

  function seedDemoData() {
    const existingContainers = listContainers();
    const existingItems = listItems();
    const hasExistingData = existingContainers.length || existingItems.length;
    const hasPreviousDemoData = existingItems.some((item) => String(item.sourceImageId || '').indexOf('demo_') === 0);
    if (hasExistingData && !hasPreviousDemoData) {
      return { containers: existingContainers, items: existingItems };
    }

    const demoContainers = [
      {
        demo: true,
        source: 'demo',
        name: '露营装备袋',
        locationPath: '阳台 / 置物架',
        contentImages: [
          { imageId: 'demo_camp_left', fileId: '/assets/mock-camp-content-left.jpg', label: '左侧' }
        ],
        items: [
          {
            demo: true,
            source: 'demo',
            displayName: '头灯',
            category: 'tool',
            colors: ['黑色'],
            aliases: ['露营灯', '灯'],
            description: '黑色小头灯，靠近收纳袋边缘。',
            sourceImageId: 'demo_camp_left',
            bbox: { x: 0.18, y: 0.26, width: 0.22, height: 0.18 },
            confidence: 0.78,
            confirmed: true
          },
          {
            demo: true,
            source: 'demo',
            displayName: '防水袋',
            category: 'bag',
            colors: ['黄色'],
            aliases: ['收纳袋', '露营袋'],
            description: '一只黄色防水袋。',
            sourceImageId: 'demo_camp_left',
            bbox: { x: 0.46, y: 0.44, width: 0.28, height: 0.24 },
            confidence: 0.74,
            confirmed: true
          }
        ]
      },
      {
        demo: true,
        source: 'demo',
        name: '客厅工具盒',
        locationPath: '客厅 / 电视柜',
        contentImages: [
          { imageId: 'demo_toolbox_left', fileId: '/assets/mock-toolbox-content-left.jpg', label: '工具' }
        ],
        items: [
          {
            demo: true,
            source: 'demo',
            displayName: '卷尺',
            category: 'tool',
            colors: ['黄色'],
            aliases: ['尺子', '工具'],
            description: '黄色卷尺，放在工具盒中部。',
            sourceImageId: 'demo_toolbox_left',
            bbox: { x: 0.2, y: 0.36, width: 0.22, height: 0.2 },
            confidence: 0.84,
            confirmed: true
          },
          {
            demo: true,
            source: 'demo',
            displayName: '螺丝刀',
            category: 'tool',
            colors: ['红色'],
            aliases: ['改锥', '工具'],
            description: '红柄螺丝刀，横放在右侧。',
            sourceImageId: 'demo_toolbox_left',
            bbox: { x: 0.48, y: 0.48, width: 0.34, height: 0.08 },
            confidence: 0.81,
            confirmed: true
          }
        ]
      },
      {
        demo: true,
        source: 'demo',
        name: '卧室 3 号箱',
        locationPath: '卧室 / 衣柜',
        contentImages: [
          { imageId: 'demo_bedroom_box', fileId: '/assets/mock-bedroom-box-content.jpg', label: '箱内' }
        ],
        items: [
          {
            demo: true,
            source: 'demo',
            displayName: '换季围巾',
            category: 'clothing',
            colors: ['米色'],
            aliases: ['围巾', '换季衣物'],
            description: '米色围巾，叠在箱子上层。',
            sourceImageId: 'demo_bedroom_box',
            bbox: { x: 0.12, y: 0.28, width: 0.44, height: 0.22 },
            confidence: 0.82,
            confirmed: true
          },
          {
            demo: true,
            source: 'demo',
            displayName: '旅行手册',
            category: 'book',
            colors: ['蓝色'],
            aliases: ['手册', '书', '旅行书'],
            description: '蓝色旅行手册，靠近收纳袋旁。',
            sourceImageId: 'demo_bedroom_box',
            bbox: { x: 0.6, y: 0.2, width: 0.24, height: 0.22 },
            confidence: 0.76,
            confirmed: true
          }
        ]
      },
      {
        demo: true,
        source: 'demo',
        name: '书桌左侧抽屉',
        locationPath: '卧室 / 书桌',
        contentImages: [
          { imageId: 'demo_inside_left', fileId: '/assets/mock-container-content-left.jpg', label: '左侧' },
          { imageId: 'demo_inside_right', fileId: '/assets/mock-container-content-right.jpg', label: '右侧' }
        ],
        items: [
          {
            demo: true,
            source: 'demo',
            displayName: '蓝色发卡',
            aiName: '蓝色发卡',
            category: 'accessory',
            colors: ['蓝色'],
            aliases: ['发夹', '头饰', '蓝色发夹'],
            description: '一个蓝色弧形发卡，位于画面右下角。',
            sourceImageId: 'demo_inside_left',
            bbox: { x: 0.68, y: 0.62, width: 0.18, height: 0.16 },
            confidence: 0.82,
            confirmed: true
          },
          {
            demo: true,
            source: 'demo',
            displayName: '黑色笔',
            category: 'pen',
            colors: ['黑色'],
            aliases: ['黑笔', '签字笔', '水笔'],
            description: '一支黑色签字笔。',
            sourceImageId: 'demo_inside_left',
            bbox: { x: 0.36, y: 0.44, width: 0.22, height: 0.06 },
            confidence: 0.8,
            confirmed: true
          },
          {
            demo: true,
            source: 'demo',
            displayName: '《三体》',
            category: 'book',
            colors: [],
            visibleText: '三体',
            aliases: ['三体', '科幻书', '书'],
            description: '一本封面写着三体的书。',
            sourceImageId: 'demo_inside_right',
            bbox: { x: 0.44, y: 0.08, width: 0.3, height: 0.24 },
            confidence: 0.9,
            confirmed: true
          },
          {
            demo: true,
            source: 'demo',
            displayName: '蓝色封面的书',
            category: 'book',
            colors: ['蓝色'],
            aliases: ['蓝色书', '书', '蓝色封面'],
            description: '一本蓝色封面的书，书名不清晰。',
            sourceImageId: 'demo_inside_right',
            bbox: { x: 0.58, y: 0.34, width: 0.28, height: 0.25 },
            confidence: 0.62,
            confirmed: true
          }
        ]
      }
    ];

    demoContainers
      .filter((containerInput) => !existingContainers.some((container) => container.name === containerInput.name))
      .forEach((containerInput) => {
      saveContainer(Object.assign({ coverImageFileId: '' }, containerInput));
    });

    const orderedDemoNames = demoContainers.map((container) => container.name).reverse();
    const timestamp = now();
    writeArray(storage, CONTAINERS_KEY, readArray(storage, CONTAINERS_KEY).map((container) => {
      const orderIndex = orderedDemoNames.indexOf(container.name);
      if (orderIndex < 0) return container;
      return Object.assign({}, container, { updatedAt: timestamp - orderIndex });
    }));

    return { containers: listContainers(), items: listItems() };
  }

  return {
    listContainers,
    listUserContainers,
    listItems,
    listUserItems,
    getContainer,
    getItemsByContainer,
    saveContainer,
    addContentImage,
    replaceItemsForImage,
    getContentImages,
    deleteContainer,
    deleteContainers,
    removeDemoData,
    seedDemoData
  };
}

const defaultService = createStorageService();

module.exports = Object.assign({ createStorageService, FREE_CONTENT_IMAGE_LIMIT }, defaultService);
