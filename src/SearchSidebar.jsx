import React, { useState, useEffect, useCallback } from 'react';
import './SearchSidebar.css';

const SearchSidebar = () => {
  const [deliveryOption, setDeliveryOption] = useState('cheapest');
  const [locationSharing, setLocationSharing] = useState(false);
  const [customLocation, setCustomLocation] = useState('');
  const [privacyLevel, setPrivacyLevel] = useState('limited');
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [resultMeta, setResultMeta] = useState(null);
  const [view, setView] = useState('settings'); // 'settings' | 'results'
  const [error, setError] = useState(null);
  const [queryFromSelection, setQueryFromSelection] = useState(false); // Track if query was set from context menu selection
  const [openHelp, setOpenHelp] = useState(null); // e.g. 'selected' | 'search' | 'priority' | 'location' | 'privacy'

  const toggleHelp = (key) => {
    setOpenHelp((prev) => (prev === key ? null : key));
  };

  // Browser API helper (Firefox vs Chrome)
  const getBrowser = useCallback(() => {
    if (typeof browser !== 'undefined' && browser.runtime) return browser;
    if (typeof chrome !== 'undefined' && chrome.runtime) return chrome;
    return null;
  }, []);

  // Listen for messages from background script (context menu triggers)
  useEffect(() => {
    const b = getBrowser();
    if (!b) return;

    const listener = (message) => {
      if (message.type === 'SEARCH_DATA') { // Adjusted message type to avoid confusion with search results
        const data = message.data?.data || message.data;
        const selection = data?.selectionText || '';
        const fallback = data?.pageTitle || '';
        const query = selection || fallback || '';

        if (query) {
          setSearchQuery(query);
          setQueryFromSelection(Boolean(selection)); // true only if user selected text
        }
      }
      if (message.type === 'SEARCH_RESULTS') {
        setResults(message.results || []);
        setResultMeta(message.meta || null);
        if (message.query) {
          setSearchQuery(message.query);
        }
        setIsSearching(false);
        setView('results');
      }
      if (message.type === 'SEARCH_ERROR') {
        setError(message.error || 'Search failed');
        setIsSearching(false);
      }
    };

    b.runtime.onMessage.addListener(listener);
    return () => {
      try { b.runtime.onMessage.removeListener(listener); } catch (e) { /* cleanup */ }
    };
  }, [getBrowser]);

  // Load saved settings from storage on mount
  useEffect(() => {
    const b = getBrowser();
    if (!b || !b.storage) return;

    b.storage.local.get(['searchConfig'], (result) => {
      if (result?.searchConfig) {
        const cfg = result.searchConfig;
        if (cfg.delivery) setDeliveryOption(cfg.delivery);
        if (cfg.privacy) setPrivacyLevel(cfg.privacy);
        if (cfg.location && cfg.location !== 'auto') {
          setLocationSharing(false);
          setCustomLocation(cfg.location);
        } else if (cfg.location === 'auto') {
          setLocationSharing(true);
        }
      }
    });
  }, [getBrowser]);

  const handleLetsGo = async () => {
    setIsSearching(true);
    setError(null);
    setResultMeta(null);

    const searchConfig = {
      delivery: deliveryOption,
      location: locationSharing ? 'auto' : customLocation,
      privacy: privacyLevel,
      query: searchQuery,
      timestamp: new Date().toISOString()
    };

    const b = getBrowser();
    try {
      if (b) {
        await b.runtime.sendMessage({
          type: 'SEARCH_CONFIG',
          config: searchConfig
        });
      }
      console.log('Search configuration sent:', searchConfig);
    } catch (err) {
      console.error('Failed to send search config:', err);
      setError('Failed to start search. Make sure you are on a web page.');
      setIsSearching(false);
    }
  };

  const handleBackToSettings = () => {
    setView('settings');
    setResultMeta(null);
    setError(null);
  };

  const openProductPage = (url) => {
    const b = getBrowser();
    if (b && b.tabs) {
      b.tabs.create({ url, active: true });
    } else {
      window.open(url, '_blank');
    }
  };

  // Results view <div className="harbor-icon">&#9875;</div>
  if (view === 'results') {
    return (
      <div className="search-sidebar">
        <div className="sidebar-header results-header">
          <button className="back-button" onClick={handleBackToSettings}>
            <span className="back-arrow">&larr;</span> Settings
          </button>
          <div className="logo-area">
            
            <div className="harbor-icon" role="img" aria-label="Shopping bag">🛍️</div>

            <h1>Results</h1>
          </div>
          {queryFromSelection && searchQuery && (
            <section className="setting-section query-section">
              <div className="section-title-row">
                <h2 className="section-title">Selected Text</h2>
                <button
                  type="button"
                  className="info-button"
                  onClick={() => toggleHelp('selected')}
                  aria-label="What is selected text?"
                  aria-expanded={openHelp === 'selected'}
                >
                  ℹ️
                </button>
              </div>

              {openHelp === 'selected' && (
                <p className="help-text">
                  This is the text you highlighted on the page. We’ll use it as your search query.
                </p>
              )}

              <div className="query-display">
                <span className="query-text">{searchQuery}</span>
                <button
                  className="query-clear"
                  onClick={() => { setSearchQuery(''); setQueryFromSelection(false); }}
                  title="Clear selection"
                >
                  &times;
                </button>
              </div>
            </section>
          )}
          {resultMeta?.provider && (
            <p className="tagline result-meta">
              Source: {resultMeta.provider === 'local_api' ? 'Local API' : 'Fallback'}{resultMeta.count ? ` • ${resultMeta.count} results` : ''}
            </p>
          )}
        </div>

        <div className="sidebar-content results-content">
          {results.length === 0 ? (
            <div className="no-results">
              <span className="no-results-icon">&#128269;</span>
              <p>No products found yet.</p>
              <p className="no-results-hint">Right-click selected text on any page and choose "Search with Harbor" to find products.</p>
            </div>
          ) : (
            <div className="results-list">
              {results.map((product, index) => (
                <div
                  key={index}
                  className="result-card"
                  onClick={() => openProductPage(product.url)}
                >
                  {product.image && (
                    <div className="result-image-wrapper">
                      <img
                        src={product.image}
                        alt={product.title}
                        className="result-image"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    </div>
                  )}
                  <div className="result-info">
                    <h3 className="result-title">{product.title}</h3>
                    {product.price && (
                      <span className="result-price">{product.price}</span>
                    )}
                    {product.source && (
                      <span className="result-source">{product.source}</span>
                    )}
                    {product.delivery && (
                      <span className="result-delivery">{product.delivery}</span>
                    )}
                    {(product.rating || product.reviews) && (
                      <span className="result-rating">
                        {product.rating ? `Rating: ${product.rating}` : 'Rating: N/A'}
                        {product.reviews ? ` (${product.reviews} reviews)` : ''}
                      </span>
                    )}
                    {product.inStock !== null && product.inStock !== undefined && (
                      <span className={`result-stock ${product.inStock ? 'in-stock' : 'out-of-stock'}`}>
                        {product.inStock ? 'In stock' : 'Out of stock'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="action-area">
            <button className="lets-go-button secondary" onClick={handleBackToSettings}>
              <span className="button-icon">&#9881;</span>
              Adjust Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Settings view (default) <div className="harbor-icon">&#9875;</div>
  return (
    <div className="search-sidebar">
      <div className="sidebar-header">
        <div className="logo-area">
          
          <div className="harbor-icon" role="img" aria-label="Shopping bag">🛍️</div>

          <h1>Shop on your terms</h1>
        </div>
        <p className="tagline">Powered by Mozilla</p>
      </div>

      <div className="sidebar-content">
        {/* Selected Text (only when it came from highlight + right click) */}
          {queryFromSelection && searchQuery && (
            <section className="setting-section query-section">
              <div className="section-title-row">
                <h2 className="section-title">Selected Text</h2>
                <button
                  type="button"
                  className="info-button"
                  onClick={() => toggleHelp('selected')}
                  aria-label="What is selected text?"
                  aria-expanded={openHelp === 'selected'}
                >
                  ℹ️
                </button>
              </div>

              {openHelp === 'selected' && (
                <p className="help-text">
                  This is the text you highlighted on the page. We will use it as your search query.
                </p>
              )}

              <div className="query-display">
                <span className="query-text">{searchQuery}</span>
                <button
                  className="query-clear"
                  onClick={() => { setSearchQuery(''); setQueryFromSelection(false); setOpenHelp(null); }}
                  title="Clear selection"
                >
                  &times;
                </button>
              </div>
            </section>
          )}

        {/* Manual search input */}
        <section className="setting-section">
          <h2 className="section-title">Search</h2>
          <div className="location-input-wrapper">
            <input
              type="text"
              className="location-input search-input"
              placeholder="Enter product to search for..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setQueryFromSelection(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchQuery && (locationSharing || customLocation)) {
                  handleLetsGo();
                }
              }}
            />
          </div>
        </section>

        {/* Delivery Optimization */}
        {/* Delivery / Priority */}
        <section className="setting-section">
          <div className="section-title-row">
            <h2 className="section-title">Choose your priority</h2>
            <button
              type="button"
              className="info-button"
              onClick={() => toggleHelp('priority')}
              aria-label="What does this mean?"
              aria-expanded={openHelp === 'priority'}
            >
              ℹ️
            </button>
          </div>

          {openHelp === 'priority' && (
            <p className="help-text">
              Choose what matters most. “Fastest” may cost more. “Cheapest” prioritizes the lowest total price when available.
            </p>
          )}

          <div className="option-group">
            <label className={`option-card ${deliveryOption === 'fastest' ? 'active' : ''}`}>
              <input
                type="radio"
                name="delivery"
                value="fastest"
                checked={deliveryOption === 'fastest'}
                onChange={(e) => setDeliveryOption(e.target.value)}
              />
              <div className="option-content">
                <span className="option-icon">&#9889;</span>
                <div className="option-text">
                  <span className="option-label">Fastest Delivery</span>
                  <span className="option-description">Get it quickly</span>
                </div>
              </div>
            </label>

            <label className={`option-card ${deliveryOption === 'cheapest' ? 'active' : ''}`}>
              <input
                type="radio"
                name="delivery"
                value="cheapest"
                checked={deliveryOption === 'cheapest'}
                onChange={(e) => setDeliveryOption(e.target.value)}
              />
              <div className="option-content">
                <span className="option-icon">&#128176;</span>
                <div className="option-text">
                  <span className="option-label">Cheapest Price</span>
                  <span className="option-description">Best value</span>
                </div>
              </div>
            </label>
          </div>
        </section>

        {/* Location Settings */}
        <section className="setting-section">
          <h2 className="section-title">Location</h2>
          <div className="location-toggle">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={locationSharing}
                onChange={(e) => setLocationSharing(e.target.checked)}
              />
              <span className="toggle-switch"></span>
              <span className="toggle-text">Share my location</span>
            </label>
          </div>

          {!locationSharing && (
            <div className="location-input-wrapper">
              <input
                type="text"
                className="location-input"
                placeholder="Enter city or country"
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
              />
            </div>
          )}
        </section>

        {/* Privacy Settings */}
        <section className="setting-section">
          <h2 className="section-title">Privacy</h2>
          <div className="privacy-options">
            <label className={`privacy-card ${privacyLevel === 'strict' ? 'active' : ''}`}>
              <input
                type="radio"
                name="privacy"
                value="strict"
                checked={privacyLevel === 'strict'}
                onChange={(e) => setPrivacyLevel(e.target.value)}
              />
              <div className="privacy-content">
                <span className="privacy-icon">&#128274;</span>
                <div className="privacy-text">
                  <span className="privacy-label">Strict</span>
                  <span className="privacy-description">No tracking, local only</span>
                </div>
              </div>
            </label>

            <label className={`privacy-card ${privacyLevel === 'limited' ? 'active' : ''}`}>
              <input
                type="radio"
                name="privacy"
                value="limited"
                checked={privacyLevel === 'limited'}
                onChange={(e) => setPrivacyLevel(e.target.value)}
              />
              <div className="privacy-content">
                <span className="privacy-icon">&#128737;&#65039;</span>
                <div className="privacy-text">
                  <span className="privacy-label">Limited</span>
                  <span className="privacy-description">Essential services only</span>
                </div>
              </div>
            </label>

            <label className={`privacy-card ${privacyLevel === 'open' ? 'active' : ''}`}>
              <input
                type="radio"
                name="privacy"
                value="open"
                checked={privacyLevel === 'open'}
                onChange={(e) => setPrivacyLevel(e.target.value)}
              />
              <div className="privacy-content">
                <span className="privacy-icon">&#127760;</span>
                <div className="privacy-text">
                  <span className="privacy-label">Open</span>
                  <span className="privacy-description">All search engines</span>
                </div>
              </div>
            </label>
          </div>

          {privacyLevel === 'open' && (
            <div className="privacy-note">
              <p>Includes Google and other tracking services</p>
            </div>
          )}
        </section>

        {/* Error Display */}
        {error && (
          <div className="error-message">
            <p>{error}</p>
          </div>
        )}

        {/* Action Button */}
        <div className="action-area">
          <button
            className={`lets-go-button ${isSearching ? 'searching' : ''}`}
            onClick={handleLetsGo}
            disabled={isSearching || !searchQuery || (!locationSharing && !customLocation)}
          >
            {isSearching ? (
              <>
                <span className="spinner"></span>
                Searching...
              </>
            ) : (
              <>
                <span className="button-icon">&#128640;</span>
                Let's Go
              </>
            )}
          </button>
        </div>

        {/* View Results Button */}
        {results.length > 0 && (
          <div className="action-area">
            <button className="lets-go-button secondary" onClick={() => setView('results')}>
              View {results.length} Result{results.length !== 1 ? 's' : ''}
            </button>
          </div>
        )}

        {/* Info Footer */}
        <div className="sidebar-footer">
          <p className="footer-text">
            Right-click selected text on any page and choose "Search with Harbor" to find products
          </p>
        </div>
      </div>
    </div>
  );
};

export default SearchSidebar;
