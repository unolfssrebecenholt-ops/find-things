let pendingAuthorizationResolve = null;
let activePageContext = null;
const registeredAdapters = [];

function setPrivacyPrompt(pageContext, patch) {
  if (!pageContext || typeof pageContext.setData !== 'function') return;
  pageContext.setData(Object.assign({
    privacyPromptVisible: true
  }, patch || {}));
}

function hidePrivacyPrompt(pageContext) {
  const context = pageContext || activePageContext;
  if (!context || typeof context.setData !== 'function') return;
  context.setData({ privacyPromptVisible: false });
}

function loadPrivacyContractName(adapter, pageContext) {
  if (!adapter || typeof adapter.getPrivacySetting !== 'function') return;
  adapter.getPrivacySetting({
    success(result) {
      const privacyContractName = result && result.privacyContractName;
      if (privacyContractName) {
        setPrivacyPrompt(pageContext, { privacyContractName });
      }
    }
  });
}

function registerNeedPrivacyAuthorization(adapter) {
  if (!adapter || typeof adapter.onNeedPrivacyAuthorization !== 'function') return;
  if (registeredAdapters.indexOf(adapter) >= 0) return;
  registeredAdapters.push(adapter);
  adapter.onNeedPrivacyAuthorization((resolve, eventInfo) => {
    pendingAuthorizationResolve = resolve;
    const pageContext = activePageContext;
    setPrivacyPrompt(pageContext, {
      privacyReferrer: eventInfo && eventInfo.referrer || '',
      privacyContractName: pageContext && pageContext.data && pageContext.data.privacyContractName
        ? pageContext.data.privacyContractName
        : '《搁哪儿用户隐私保护指引》'
    });
    loadPrivacyContractName(adapter, pageContext);
  });
}

function ensurePrivacyAuthorized(wxAdapter, pageContext) {
  const adapter = wxAdapter || (typeof wx !== 'undefined' ? wx : null);
  if (!adapter || typeof adapter.requirePrivacyAuthorize !== 'function') {
    return Promise.resolve({ authorized: true, skipped: true });
  }
  activePageContext = pageContext || activePageContext;
  registerNeedPrivacyAuthorization(adapter);

  return new Promise((resolve) => {
    adapter.requirePrivacyAuthorize({
      success(result) {
        hidePrivacyPrompt(pageContext);
        resolve(Object.assign({ authorized: true }, result || {}));
      },
      fail(error) {
        hidePrivacyPrompt(pageContext);
        resolve(Object.assign({ authorized: false }, error || {}));
      }
    });
  });
}

function resolvePendingAuthorization(result) {
  if (typeof pendingAuthorizationResolve === 'function') {
    pendingAuthorizationResolve(result || { event: 'disagree' });
  }
  pendingAuthorizationResolve = null;
  hidePrivacyPrompt();
}

function openPrivacyContract(wxAdapter) {
  const adapter = wxAdapter || (typeof wx !== 'undefined' ? wx : null);
  if (!adapter || typeof adapter.openPrivacyContract !== 'function') return;
  adapter.openPrivacyContract({});
}

function showPrivacyDeniedToast(wxAdapter) {
  const adapter = wxAdapter || (typeof wx !== 'undefined' ? wx : null);
  if (!adapter || typeof adapter.showToast !== 'function') return;
  adapter.showToast({
    title: '需要同意隐私协议后继续',
    icon: 'none'
  });
}

function guardPrivateAction(wxAdapter, pageContext, action) {
  return ensurePrivacyAuthorized(wxAdapter, pageContext).then((result) => {
    if (result && result.authorized) {
      if (typeof action === 'function') action();
      return result;
    }
    showPrivacyDeniedToast(wxAdapter);
    return result;
  });
}

module.exports = {
  ensurePrivacyAuthorized,
  guardPrivateAction,
  openPrivacyContract,
  resolvePendingAuthorization,
  showPrivacyDeniedToast
};
