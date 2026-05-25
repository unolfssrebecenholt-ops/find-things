const storage = require('../../services/storage');

function getChosenPath(result) {
  if (result && result.tempFiles && result.tempFiles[0]) {
    return result.tempFiles[0].tempFilePath;
  }
  if (result && result.tempFilePaths && result.tempFilePaths[0]) {
    return result.tempFilePaths[0];
  }
  return '';
}

Page({
  data: {
    name: '',
    locationPath: '',
    coverImageFileId: '',
    showCoverPlaceholder: true,
    contentImageFileId: '',
    contentImages: [],
    items: []
  },

  onLoad() {
    const draft = wx.getStorageSync('reviewDraft') || {};
    const contentImages = draft.contentImages || (draft.contentImageFileId
      ? [{ imageId: 'legacy_content_1', fileId: draft.contentImageFileId, label: '照片 1', sortOrder: 0, itemCount: (draft.items || []).length }]
      : []);
    this.setData({
      contentImages,
      contentImageFileId: draft.contentImageFileId || (contentImages[0] && contentImages[0].fileId) || '',
      items: draft.items || []
    });
  },

  inputName(event) {
    this.setData({ name: event.detail.value });
  },

  inputLocation(event) {
    this.setData({ locationPath: event.detail.value });
  },

  chooseCover() {
    const onSuccess = (result) => {
      const coverImageFileId = getChosenPath(result);
      this.setData({
        coverImageFileId,
        showCoverPlaceholder: !coverImageFileId
      });
    };
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: onSuccess
      });
      return;
    }
    wx.chooseImage({ count: 1, sourceType: ['album', 'camera'], success: onSuccess });
  },

  useContentAsCover() {
    this.setData({
      coverImageFileId: this.data.contentImageFileId,
      showCoverPlaceholder: !this.data.contentImageFileId
    });
  },

  save() {
    if (!this.data.name.trim()) {
      wx.showToast({ title: '请填写容器名称', icon: 'none' });
      return;
    }
    const saved = storage.saveContainer({
      name: this.data.name,
      locationPath: this.data.locationPath,
      coverImageFileId: this.data.coverImageFileId,
      contentImageFileId: this.data.contentImageFileId,
      contentImages: this.data.contentImages,
      items: this.data.items
    });
    wx.removeStorageSync('reviewDraft');
    wx.removeStorageSync('captureDraft');
    wx.showToast({ title: '已保存', icon: 'success' });
    wx.redirectTo({ url: `/pages/container/detail?id=${saved.container._id}` });
  }
});
