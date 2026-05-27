const HOME_URL = '/pages/home/index';

function normalizeRoute(route) {
  const value = String(route || '');
  return value.charAt(0) === '/' ? value : `/${value}`;
}

function navigateHome() {
  if (typeof getCurrentPages === 'function') {
    const pages = getCurrentPages() || [];
    for (let index = pages.length - 1; index >= 0; index -= 1) {
      if (normalizeRoute(pages[index] && pages[index].route) === HOME_URL) {
        const delta = pages.length - 1 - index;
        if (delta > 0 && typeof wx !== 'undefined' && wx.navigateBack) {
          wx.navigateBack({ delta });
        }
        return;
      }
    }
  }

  if (typeof wx === 'undefined') return;
  if (wx.redirectTo) {
    wx.redirectTo({ url: HOME_URL });
    return;
  }
  if (wx.reLaunch) {
    wx.reLaunch({ url: HOME_URL });
  }
}

module.exports = {
  HOME_URL,
  navigateHome
};
