// Harbor Content Script
// Runs on web pages to detect products, extract info, and handle search

(function() {
  'use strict';

  // Prevent double-injection
  if (window.__harborContentLoaded) return;
  window.__harborContentLoaded = true;

  // Product detection patterns
  const productPatterns = {
    amazon: /amazon\.(com|de|uk|fr|es|it|co\.jp)/i,
    ebay: /ebay\.(com|de|uk|fr|es|it)/i,
    alibaba: /alibaba\.com/i,
    aliexpress: /aliexpress\.com/i,
    etsy: /etsy\.com/i,
    walmart: /walmart\.com/i,
    target: /target\.com/i
  };

  // Check if current page is a product page
  function isProductPage() {
    const url = window.location.href;
    return Object.values(productPatterns).some(pattern => pattern.test(url));
  }

  // Extract product information from the page
  function extractProductInfo() {
    const info = {
      url: window.location.href,
      title: document.title,
      images: [],
      price: null,
      description: null,
      timestamp: new Date().toISOString()
    };

    // Try to extract price
    const priceSelectors = [
      '.price',
      '[class*="price"]',
      '[id*="price"]',
      'span[data-price]',
      '.product-price',
      '.a-price .a-offscreen',
      '#priceblock_ourprice',
      '.Price',
      '[data-testid*="price"]'
    ];

    for (const selector of priceSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          const text = element.textContent.trim();
          // Only accept text that looks like a price
          if (/[\$\€\£\¥]\s*\d|^\d+[\.,]\d{2}$/.test(text)) {
            info.price = text;
            break;
          }
        }
      } catch (e) {
        // Selector might be invalid, skip
      }
    }

    // Extract product images
    const imageSelectors = [
      'img[data-product-image]',
      '.product-image img',
      '[class*="product"] img',
      'img[alt*="product"]',
      '#main-image',
      '.s7-pnl-img-container img',
      '#landingImage'
    ];

    for (const selector of imageSelectors) {
      try {
        const images = document.querySelectorAll(selector);
        if (images.length > 0) {
          images.forEach(img => {
            if (img.src && !info.images.includes(img.src)) {
              info.images.push(img.src);
            }
          });
          break;
        }
      } catch (e) {
        // Skip
      }
    }

    // Extract description
    const descSelectors = [
      '[class*="description"]',
      '[id*="description"]',
      '.product-details',
      'meta[name="description"]'
    ];

    for (const selector of descSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          info.description = element.tagName === 'META'
            ? element.getAttribute('content')
            : element.textContent.trim().substring(0, 500);
          break;
        }
      } catch (e) {
        // Skip
      }
    }

    return info;
  }

  // Listen for messages from background script
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EXECUTE_SEARCH') {
      handleSearch(message.config);
      sendResponse({ success: true });
    } else if (message.type === 'GET_PRODUCT_INFO') {
      const productInfo = extractProductInfo();
      sendResponse({ success: true, data: productInfo });
    }
    return true;
  });

  // Handle search execution
  function handleSearch(config) {
    if (isProductPage()) {
      const productInfo = extractProductInfo();

      // Send product info back to background script
      browser.runtime.sendMessage({
        type: 'PRODUCT_DETECTED',
        data: productInfo,
        config: config
      });

      showSearchIndicator('Comparing prices...');
    } else {
      // Get selected text or use the query from config
      const selection = window.getSelection().toString().trim();
      const searchQuery = config.query || selection || extractPageKeywords();

      browser.runtime.sendMessage({
        type: 'SEARCH_QUERY',
        query: searchQuery,
        config: config
      });

      showSearchIndicator('Searching for deals...');
    }
  }

  // Extract keywords from page for search
  function extractPageKeywords() {
    const title = document.title;
    const metaDesc = document.querySelector('meta[name="description"]');
    const h1 = document.querySelector('h1');

    return title || (metaDesc && metaDesc.getAttribute('content')) ||
           (h1 && h1.textContent.trim()) || '';
  }

  // Show visual indicator that search is in progress
  function showSearchIndicator(message) {
    // Remove existing indicator if any
    const existing = document.getElementById('harbor-search-indicator');
    if (existing) existing.remove();

    const indicator = document.createElement('div');
    indicator.id = 'harbor-search-indicator';
    indicator.style.cssText = [
      'position: fixed',
      'top: 20px',
      'right: 20px',
      'background: linear-gradient(135deg, #1a4d6d, #2d7aa8)',
      'color: white',
      'padding: 16px 24px',
      'border-radius: 12px',
      'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2)',
      'z-index: 2147483647',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      'font-size: 14px',
      'font-weight: 600',
      'transition: opacity 0.3s ease, transform 0.3s ease',
      'transform: translateY(0)',
      'opacity: 1'
    ].join(';');

    indicator.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:20px;">&#9875;</span>' +
        '<span>' + message + '</span>' +
      '</div>';

    document.body.appendChild(indicator);

    setTimeout(() => {
      indicator.style.opacity = '0';
      indicator.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        if (indicator.parentNode) indicator.remove();
      }, 300);
    }, 3000);
  }

  // Initialize
  console.log('Harbor content script loaded on:', window.location.hostname);

  // Check if this is a product page on load
  if (isProductPage()) {
    console.log('Product page detected');
    browser.runtime.sendMessage({
      type: 'PRODUCT_PAGE_DETECTED',
      data: extractProductInfo()
    }).catch(() => {});
  }
})();
