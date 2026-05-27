const storage = require('../../services/storage');
const search = require('../../services/search');
const { isMockAssetPath } = require('../../utils/mock-assets');
const { navigateHome } = require('../../utils/navigation');

function createContainerViewModel(container) {
  const coverPhoto = container.coverImageFileId || container.contentImageFileId || '';
  const hasCoverPhoto = !!coverPhoto && !isMockAssetPath(coverPhoto);
  const itemCount = Number(container.itemCount) || 0;
  const imageCount = (container.contentImages || []).length;
  return Object.assign({}, container, {
    coverPhoto: hasCoverPhoto ? coverPhoto : '',
    showPlaceholder: !hasCoverPhoto,
    displayLocation: container.locationPath || '未填写位置',
    displaySubtitle: `${container.locationPath || '未填写位置'}，${itemCount} 件物品`,
    imageCount,
    statusPill: container.displayStatus || (itemCount > 0 ? '最近更新' : '待整理')
  });
}

function applySelection(containers, selectedIds) {
  const selected = (selectedIds || []).reduce((map, id) => {
    map[id] = true;
    return map;
  }, {});
  return (containers || []).map((container) => Object.assign({}, container, {
    isSelected: !!selected[container._id],
    selectClass: selected[container._id] ? 'selected' : ''
  }));
}

function getVisibleSelectedIds(containers, selectedIds) {
  const visible = (containers || []).reduce((map, container) => {
    if (container && container._id) map[container._id] = true;
    return map;
  }, {});
  return (selectedIds || []).filter((id) => visible[id]);
}

function getUserData() {
  if (typeof storage.removeDemoData === 'function') {
    storage.removeDemoData();
  }
  const containers = typeof storage.listUserContainers === 'function'
    ? storage.listUserContainers()
    : storage.listContainers();
  const items = typeof storage.listUserItems === 'function'
    ? storage.listUserItems()
    : storage.listItems();
  return { containers, items };
}

function buildSummary(containers) {
  const totalItems = (containers || []).reduce((total, container) => total + (Number(container.itemCount) || 0), 0);
  const totalImages = (containers || []).reduce((total, container) => total + ((container.contentImages || []).length), 0);
  return {
    containerCount: containers.length,
    itemCount: totalItems,
    imageCount: totalImages
  };
}

Page({
  data: {
    query: '',
    containers: [],
    allContainers: [],
    hasContainers: false,
    showEmpty: true,
    summary: { containerCount: 0, itemCount: 0, imageCount: 0 },
    isManaging: false,
    manageLabel: '管理',
    manageButtonClass: '',
    rowModeClass: '',
    showRowMoreActions: true,
    selectedIds: [],
    selectedCount: 0,
    hasSelection: false,
    showBatchBar: false
  },

  onShow() {
    this.load();
  },

  load() {
    const data = getUserData();
    const containers = applySelection(data.containers.map(createContainerViewModel), []);
    this.setData({
      query: '',
      allContainers: containers,
      containers,
      hasContainers: containers.length > 0,
      showEmpty: containers.length === 0,
      summary: buildSummary(data.containers),
      isManaging: false,
      manageLabel: '管理',
      manageButtonClass: '',
      selectedIds: [],
      selectedCount: 0,
      hasSelection: false,
      showBatchBar: false,
      rowModeClass: '',
      showRowMoreActions: true
    });
  },

  inputQuery(event) {
    const query = event.detail.value;
    const data = getUserData();
    const containers = query
      ? search.searchContainers(query, data).map((result) => result.container)
      : data.containers;
    const viewModels = applySelection(containers.map(createContainerViewModel), []);
    this.setData({
      query,
      containers: viewModels,
      allContainers: query ? applySelection(this.data.allContainers, []) : viewModels,
      hasContainers: viewModels.length > 0,
      showEmpty: viewModels.length === 0,
      selectedIds: [],
      selectedCount: 0,
      hasSelection: false,
      showBatchBar: false
    });
  },

  toggleManageMode() {
    const next = !this.data.isManaging;
    const containers = next ? this.data.containers : applySelection(this.data.containers, []);
    const allContainers = next ? this.data.allContainers : applySelection(this.data.allContainers, []);
    this.setData({
      isManaging: next,
      manageLabel: next ? '完成' : '管理',
      manageButtonClass: next ? 'active' : '',
      rowModeClass: next ? 'manage-row' : '',
      showRowMoreActions: !next,
      selectedIds: next ? this.data.selectedIds : [],
      selectedCount: next ? this.data.selectedCount : 0,
      hasSelection: next ? this.data.hasSelection : false,
      showBatchBar: next ? this.data.hasSelection : false,
      containers,
      allContainers
    });
  },

  toggleSelect(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    const selected = this.data.selectedIds || [];
    const exists = selected.indexOf(id) >= 0;
    const nextSelected = exists ? selected.filter((item) => item !== id) : selected.concat(id);
    this.setData({
      selectedIds: nextSelected,
      selectedCount: nextSelected.length,
      hasSelection: nextSelected.length > 0,
      showBatchBar: this.data.isManaging && nextSelected.length > 0,
      containers: applySelection(this.data.containers, nextSelected),
      allContainers: applySelection(this.data.allContainers, nextSelected)
    });
  },

  openContainer(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    if (this.data.isManaging) {
      this.toggleSelect(event);
      return;
    }
    wx.navigateTo({ url: `/pages/container/detail?id=${id}` });
  },

  showContainerActions(event) {
    const { id, name } = event.currentTarget.dataset;
    if (!id) return;

    if (wx.showActionSheet) {
      wx.showActionSheet({
        itemList: ['删除容器'],
        itemColor: '#a33b2f',
        success: (result) => {
          if (result.tapIndex !== 0) return;
          this.confirmDeleteContainer(id, name);
        }
      });
      return;
    }

    this.confirmDeleteContainer(id, name);
  },

  confirmDeleteFromRow(event) {
    const { id, name } = event.currentTarget.dataset;
    if (!id) return;
    this.confirmDeleteContainer(id, name);
  },

  confirmDeleteContainer(id, name) {
    wx.showModal({
      title: '删除容器',
      content: `确定删除「${name || '这个容器'}」吗？删除后，本地搜索不会再显示这个容器里的物品。`,
      confirmText: '删除',
      confirmColor: '#a33b2f',
      success: (result) => {
        if (!result.confirm) return;
        storage.deleteContainer(id);
        wx.showToast({ title: '已删除', icon: 'success' });
        this.load();
      }
    });
  },

  confirmBatchDelete() {
    const ids = getVisibleSelectedIds(this.data.containers, this.data.selectedIds);
    if (!ids.length) {
      this.setData({
        selectedIds: [],
        selectedCount: 0,
        hasSelection: false,
        showBatchBar: false,
        containers: applySelection(this.data.containers, []),
        allContainers: applySelection(this.data.allContainers, [])
      });
      return;
    }
    wx.showModal({
      title: '删除容器',
      content: `确定删除已选的 ${ids.length} 个容器吗？删除后，本地搜索不会再显示这些容器里的物品。`,
      confirmText: '删除',
      confirmColor: '#a33b2f',
      success: (result) => {
        if (!result.confirm) return;
        if (typeof storage.deleteContainers === 'function') {
          storage.deleteContainers(ids);
        } else {
          ids.forEach((id) => storage.deleteContainer(id));
        }
        wx.showToast({ title: '已删除', icon: 'success' });
        this.load();
        this.setData({
          isManaging: false,
          manageLabel: '管理',
          manageButtonClass: '',
          rowModeClass: '',
          showRowMoreActions: true,
          showBatchBar: false
        });
      }
    });
  },

  goHome() {
    navigateHome();
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/index' });
  },

  goCapture() {
    wx.navigateTo({ url: '/pages/capture/index' });
  }
});
