const HOME_URL = '/pages/home/index';
const SEARCH_URL = '/pages/search/index';
const CONTAINERS_URL = '/pages/container/list';
const INSTANT_ROUTE_OPTIONS = {
  animationType: 'none',
  animationDuration: 0
};
const TAB_ROUTES = {};
TAB_ROUTES[HOME_URL] = 0;
TAB_ROUTES[SEARCH_URL] = 1;
TAB_ROUTES[CONTAINERS_URL] = 2;
const SECTION_REFRESH = {};

function normalizeRoute(route) {
  const value = String(route || '');
  const path = value.split('?')[0];
  return path.charAt(0) === '/' ? path : `/${path}`;
}

function withInstantRouteOptions(options) {
  return Object.assign({}, options, INSTANT_ROUTE_OPTIONS);
}

function currentPages() {
  if (typeof getCurrentPages !== 'function') return [];
  return getCurrentPages() || [];
}

function currentRoute() {
  const pages = currentPages();
  const currentPage = pages[pages.length - 1];
  return normalizeRoute(currentPage && currentPage.route);
}

function routeDelta(route) {
  const normalizedRoute = normalizeRoute(route);
  const pages = currentPages();
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    if (normalizeRoute(pages[index] && pages[index].route) === normalizedRoute) {
      return pages.length - 1 - index;
    }
  }
  return -1;
}

function isTabRoute(route) {
  return Object.prototype.hasOwnProperty.call(TAB_ROUTES, normalizeRoute(route));
}

function markSectionRefresh(route) {
  const normalizedRoute = normalizeRoute(route);
  if (isTabRoute(normalizedRoute)) SECTION_REFRESH[normalizedRoute] = true;
}

function consumeSectionRefresh(route) {
  const normalizedRoute = normalizeRoute(route);
  const shouldRefresh = SECTION_REFRESH[normalizedRoute] === true;
  delete SECTION_REFRESH[normalizedRoute];
  return shouldRefresh;
}

function switchSection(url) {
  if (typeof wx === 'undefined' || !url) return;
  const normalizedUrl = normalizeRoute(url);
  if (currentRoute() === normalizedUrl) return;

  if (isTabRoute(normalizedUrl) && wx.switchTab) {
    if (!isTabRoute(currentRoute())) markSectionRefresh(normalizedUrl);
    wx.switchTab({ url: normalizedUrl });
    return;
  }

  const delta = routeDelta(normalizedUrl);
  if (delta > 0 && wx.navigateBack) {
    wx.navigateBack(withInstantRouteOptions({ delta }));
    return;
  }
  if (wx.redirectTo) {
    wx.redirectTo(withInstantRouteOptions({ url }));
    return;
  }
  if (wx.navigateTo) {
    wx.navigateTo(withInstantRouteOptions({ url }));
    return;
  }
  if (wx.reLaunch) {
    wx.reLaunch(withInstantRouteOptions({ url }));
  }
}

function navigateHome() {
  switchSection(HOME_URL);
}

function syncTabBar(page, url) {
  const index = TAB_ROUTES[normalizeRoute(url)];
  if (typeof index !== 'number') return;
  if (!page || typeof page.getTabBar !== 'function') return;
  const tabBar = page.getTabBar();
  if (tabBar && typeof tabBar.setData === 'function') {
    tabBar.setData({ selected: index });
  }
}

module.exports = {
  CONTAINERS_URL,
  HOME_URL,
  SEARCH_URL,
  consumeSectionRefresh,
  navigateHome,
  syncTabBar,
  switchSection
};
