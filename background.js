// Harbor Background Script
// Handles context menu, search triggering, messaging between sidebar and content scripts

// Store the latest search data so the sidebar can request it on load
let pendingSearchData = null;
let currentConfig = null;
const DEFAULT_API_SERVER_URL = 'http://127.0.0.1:8765';

// Create context menu on installation
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: 'harbor-search',
    title: 'Search with Harbor',
    contexts: ['selection', 'page', 'link', 'image']
  });
});

// Handle context menu clicks
browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'harbor-search') {
    handleSearchTrigger(info, tab);
  }
});

// Handle search trigger from context menu
async function handleSearchTrigger(info, tab) {
  pendingSearchData = {
    selectionText: info.selectionText || '',
    linkUrl: info.linkUrl || '',
    srcUrl: info.srcUrl || '',
    pageUrl: info.pageUrl || tab.url,
    pageTitle: tab.title
  };

  // Open the sidebar
  try {
    await browser.sidebarAction.open();
  } catch (error) {
    console.error('Failed to open sidebar:', error);
  }

  // Send search data to sidebar (with a small delay to let it render)
  setTimeout(() => {
    browser.runtime.sendMessage({
      type: 'SEARCH_DATA',
      data: pendingSearchData
    }).catch(() => {
      // Sidebar might not be ready yet, that's ok - it will request via GET_SEARCH_DATA
    });
  }, 300);
}

// Listen for messages from sidebar and content scripts
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'SEARCH_CONFIG':
      handleSearchConfig(message.config);
      sendResponse({ success: true });
      break;

    case 'GET_SEARCH_DATA':
      // Sidebar requesting pending search data on load
      sendResponse({ success: true, data: pendingSearchData });
      break;

    case 'PRODUCT_DETECTED':
      // Content script found product info - build results for sidebar
      handleProductResults(message.data, message.config);
      break;

    case 'SEARCH_QUERY':
      // Content script sending a search query (non-product page)
      handleSearchQuery(message.query, message.config);
      break;

    case 'PRODUCT_PAGE_DETECTED':
      // Content script detected a product page on load
      console.log('Product page detected:', message.data?.title);
      break;

    default:
      break;
  }
  return true;
});

// Handle search configuration from sidebar
async function handleSearchConfig(config) {
  currentConfig = config;

  // Store configuration
  await browser.storage.local.set({
    searchConfig: config,
    lastUpdated: new Date().toISOString()
  });

  // Get the active tab and execute search
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0) {
    executeSearch(tabs[0], config);
  }
}

// Execute the search on the active tab
async function executeSearch(tab, config) {
  // Try to inject content script
  try {
    await browser.tabs.executeScript(tab.id, { file: 'content.js' });
  } catch (error) {
    // Content script may already be injected
    console.log('Content script injection note:', error.message);
  }

  // Send search command to content script
  try {
    await browser.tabs.sendMessage(tab.id, {
      type: 'EXECUTE_SEARCH',
      config: config
    });
  } catch (err) {
    console.error('Failed to send to content script:', err);
    // If content script communication fails, fall back to building search URLs
    handleSearchQuery(config.query || pendingSearchData?.selectionText || '', config);
  }
}

async function getApiServerUrl() {
  try {
    const stored = await browser.storage.local.get(['apiServerUrl']);
    return stored?.apiServerUrl || DEFAULT_API_SERVER_URL;
  } catch (err) {
    console.warn('Unable to read apiServerUrl from storage:', err);
    return DEFAULT_API_SERVER_URL;
  }
}

function mapResultFromApi(item) {
  return {
    title: item?.title || 'Untitled product',
    url: item?.url || '#',
    source: item?.source || 'Unknown',
    delivery: item?.delivery || null,
    price: item?.price || null,
    image: item?.image || null,
    rating: item?.rating ?? null,
    reviews: item?.reviews ?? null,
    inStock: item?.inStock ?? null
  };
}

async function fetchSearchResults(query, productData, config) {
  const apiServerUrl = await getApiServerUrl();
  const payload = {
    query,
    delivery: config?.delivery || 'cheapest',
    privacy: config?.privacy || 'limited',
    location: config?.location || '',
    product_title: productData?.title || null,
    product_image_url: productData?.images?.[0] || null,
    n: 12
  };

  const response = await fetch(`${apiServerUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let detail = '';
    try {
      const errJson = await response.json();
      detail = errJson?.detail || '';
    } catch (e) {
      // ignore parse errors
    }
    throw new Error(`Search API failed (${response.status}): ${detail}`);
  }

  const body = await response.json();
  const apiResults = Array.isArray(body?.results) ? body.results : [];
  return {
    results: apiResults.map(mapResultFromApi),
    meta: {
      provider: 'local_api',
      apiServerUrl,
      ...body?.meta
    }
  };
}

// Handle product data from content script - fetch comparison results from API
async function handleProductResults(productData, config) {
  const query = productData.title || pendingSearchData?.selectionText || '';
  if (!query) {
    browser.runtime.sendMessage({
      type: 'SEARCH_ERROR',
      error: 'No product information found on the page.'
    }).catch(() => {});
    return;
  }

  try {
    const apiData = await fetchSearchResults(query, productData, config);
    browser.runtime.sendMessage({
      type: 'SEARCH_RESULTS',
      results: apiData.results,
      query,
      meta: apiData.meta
    }).catch(err => console.error('Failed to send API results to sidebar:', err));
  } catch (apiError) {
    console.error('Search API failed, falling back to static URL mode:', apiError);
    const fallbackResults = buildSearchResults(query, productData, config);
    browser.runtime.sendMessage({
      type: 'SEARCH_RESULTS',
      results: fallbackResults,
      query,
      meta: { provider: 'fallback_static_urls', error: apiError.message }
    }).catch(err => console.error('Failed to send fallback results to sidebar:', err));
  }
}

// Handle text-based search query
async function handleSearchQuery(query, config) {
  if (!query) {
    browser.runtime.sendMessage({
      type: 'SEARCH_ERROR',
      error: 'No search query found. Select text on a page and right-click to search.'
    }).catch(() => {});
    return;
  }

  try {
    const apiData = await fetchSearchResults(query, null, config);
    browser.runtime.sendMessage({
      type: 'SEARCH_RESULTS',
      results: apiData.results,
      query,
      meta: apiData.meta
    }).catch(err => console.error('Failed to send API results to sidebar:', err));
  } catch (apiError) {
    console.error('Search API failed, falling back to static URL mode:', apiError);
    const fallbackResults = buildSearchResults(query, null, config);
    browser.runtime.sendMessage({
      type: 'SEARCH_RESULTS',
      results: fallbackResults,
      query,
      meta: { provider: 'fallback_static_urls', error: apiError.message }
    }).catch(err => console.error('Failed to send fallback results to sidebar:', err));
  }
}

// Build search result links based on config
function buildSearchResults(query, productData, config) {
  const encodedQuery = encodeURIComponent(query);
  const results = [];
  const privacy = config?.privacy || 'limited';
  const delivery = config?.delivery || 'cheapest';
  const location = config?.location || '';

  // Add location qualifier to query if provided
  let locationSuffix = '';
  if (location && location !== 'auto') {
    locationSuffix = ' ' + location;
  }
  const fullQuery = encodeURIComponent(query + locationSuffix);

  // Always include privacy-friendly sources
  // DuckDuckGo Shopping
  results.push({
    title: query + ' - DuckDuckGo Shopping',
    url: 'https://duckduckgo.com/?q=' + fullQuery + '&ia=shopping',
    source: 'DuckDuckGo',
    delivery: delivery === 'fastest' ? 'Sorted by fastest delivery' : 'Sorted by price',
    price: productData?.price || null,
    image: productData?.images?.[0] || null
  });

  // eBay
  const ebaySortParam = delivery === 'cheapest' ? '&_sop=15' : '&_sop=1';
  results.push({
    title: query + ' - eBay',
    url: 'https://www.ebay.com/sch/i.html?_nkw=' + fullQuery + ebaySortParam,
    source: 'eBay',
    delivery: delivery === 'fastest' ? 'Buy It Now + Fast shipping' : 'Price + Shipping: lowest first',
    price: null,
    image: null
  });

  // Amazon (if privacy allows)
  if (privacy !== 'strict') {
    const amazonSort = delivery === 'cheapest' ? '&s=price-asc-rank' : '';
    results.push({
      title: query + ' - Amazon',
      url: 'https://www.amazon.com/s?k=' + fullQuery + amazonSort,
      source: 'Amazon',
      delivery: delivery === 'fastest' ? 'Prime eligible' : 'Price: Low to High',
      price: null,
      image: null
    });
  }

  // Etsy
  const etsySort = delivery === 'cheapest' ? '&order=price_asc' : '&order=most_relevant';
  results.push({
    title: query + ' - Etsy',
    url: 'https://www.etsy.com/search?q=' + fullQuery + etsySort,
    source: 'Etsy',
    delivery: delivery === 'fastest' ? 'Ready to ship' : 'Best price',
    price: null,
    image: null
  });

  // Google Shopping (only if privacy is open)
  if (privacy === 'open') {
    const googleSort = delivery === 'cheapest' ? ',p_ord:p' : '';
    results.push({
      title: query + ' - Google Shopping',
      url: 'https://www.google.com/search?q=' + fullQuery + '&tbm=shop' + googleSort,
      source: 'Google Shopping',
      delivery: delivery === 'fastest' ? 'Nearby + fast shipping' : 'Lowest price',
      price: null,
      image: null
    });
  }

  // AliExpress (for cheapest)
  if (delivery === 'cheapest') {
    results.push({
      title: query + ' - AliExpress',
      url: 'https://www.aliexpress.com/wholesale?SearchText=' + fullQuery + '&SortType=price_asc',
      source: 'AliExpress',
      delivery: 'International shipping (slower)',
      price: null,
      image: null
    });
  }

  // Limited privacy: include a few more sources
  if (privacy === 'limited' || privacy === 'open') {
    results.push({
      title: query + ' - Walmart',
      url: 'https://www.walmart.com/search?q=' + fullQuery + (delivery === 'cheapest' ? '&sort=price_low' : ''),
      source: 'Walmart',
      delivery: delivery === 'fastest' ? 'In-store pickup available' : 'Low prices',
      price: null,
      image: null
    });
  }

  return results;
}

// Handle keyboard shortcut
browser.commands.onCommand.addListener((command) => {
  if (command === 'open-harbor-search') {
    browser.sidebarAction.open();
  }
});

// Initialize
console.log('Harbor background script loaded');
