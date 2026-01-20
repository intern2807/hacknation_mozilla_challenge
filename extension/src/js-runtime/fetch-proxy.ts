/**
 * Fetch proxy for JS MCP servers.
 *
 * Intercepts fetch requests from sandboxed workers and enforces
 * network capability restrictions based on the manifest's allowed hosts.
 */

export type FetchRequest = {
  type: 'fetch-request';
  id: string;
  url: string;
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | { type: string; data: number[] };
    mode?: RequestMode;
    credentials?: RequestCredentials;
    cache?: RequestCache;
    redirect?: RequestRedirect;
    referrer?: string;
    integrity?: string;
  };
};

export type FetchResponse = {
  type: 'fetch-response';
  id: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  error?: string;
};

/**
 * Matches a hostname against a pattern.
 *
 * Supported patterns:
 * - "*" - matches any host
 * - "*.example.com" - matches any subdomain of example.com
 * - "api.example.com" - exact match
 *
 * @param pattern - The pattern to match against
 * @param hostname - The hostname to check
 * @returns true if the hostname matches the pattern
 */
export function matchHostPattern(pattern: string, hostname: string): boolean {
  // Wildcard matches everything
  if (pattern === '*') {
    return true;
  }

  // Normalize both to lowercase
  const normalizedPattern = pattern.toLowerCase();
  const normalizedHostname = hostname.toLowerCase();

  // Wildcard subdomain pattern (e.g., "*.example.com")
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(1); // ".example.com"
    // Match if hostname ends with the suffix OR equals the base domain
    return (
      normalizedHostname.endsWith(suffix) ||
      normalizedHostname === normalizedPattern.slice(2)
    );
  }

  // Exact match
  return normalizedHostname === normalizedPattern;
}

/**
 * Validates if a URL's hostname is allowed by the given host patterns.
 *
 * @param url - The URL to validate
 * @param allowedHosts - Array of allowed host patterns
 * @returns true if the URL's host is allowed
 */
export function isHostAllowed(url: string, allowedHosts: string[]): boolean {
  try {
    const parsedUrl = new URL(url);
    return allowedHosts.some((pattern) =>
      matchHostPattern(pattern, parsedUrl.hostname),
    );
  } catch {
    // Invalid URL
    return false;
  }
}

/**
 * Deserializes the body from a fetch request.
 */
function deserializeBody(
  body: string | { type: string; data: number[] } | undefined,
): BodyInit | undefined {
  if (body === undefined) {
    return undefined;
  }

  if (typeof body === 'string') {
    return body;
  }

  if (body.type === 'arraybuffer' || body.type === 'uint8array') {
    return new Uint8Array(body.data);
  }

  return undefined;
}

/**
 * Sets up a fetch proxy for a worker, enforcing network capability restrictions.
 *
 * @param worker - The Web Worker to proxy fetch requests for
 * @param allowedHosts - Array of allowed host patterns from the manifest
 * @param onFetchAttempt - Optional callback for logging/monitoring fetch attempts
 */
export function setupFetchProxy(
  worker: Worker,
  allowedHosts: string[],
  onFetchAttempt?: (url: string, allowed: boolean) => void,
): void {
  const handleMessage = async (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.type !== 'fetch-request') {
      return;
    }

    const request = data as FetchRequest;
    const { id, url, options } = request;

    // Validate against allowlist
    const allowed = isHostAllowed(url, allowedHosts);
    onFetchAttempt?.(url, allowed);

    if (!allowed) {
      const hostname = (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return url;
        }
      })();

      const response: FetchResponse = {
        type: 'fetch-response',
        id,
        error: `Network access denied: ${hostname} is not in the allowed hosts list. Allowed: [${allowedHosts.join(', ')}]`,
      };
      worker.postMessage(response);
      return;
    }

    // Proxy the request
    try {
      const fetchOptions: RequestInit = {
        method: options?.method,
        headers: options?.headers,
        body: deserializeBody(options?.body),
        mode: options?.mode,
        credentials: options?.credentials,
        cache: options?.cache,
        redirect: options?.redirect,
        referrer: options?.referrer,
        integrity: options?.integrity,
      };

      // Remove undefined values
      Object.keys(fetchOptions).forEach((key) => {
        if (fetchOptions[key as keyof RequestInit] === undefined) {
          delete fetchOptions[key as keyof RequestInit];
        }
      });

      const fetchResponse = await fetch(url, fetchOptions);

      // Serialize response headers
      const headers: Record<string, string> = {};
      fetchResponse.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Get response body as text
      const body = await fetchResponse.text();

      const response: FetchResponse = {
        type: 'fetch-response',
        id,
        status: fetchResponse.status,
        statusText: fetchResponse.statusText,
        headers,
        body,
      };
      worker.postMessage(response);
    } catch (error) {
      const response: FetchResponse = {
        type: 'fetch-response',
        id,
        error: error instanceof Error ? error.message : String(error),
      };
      worker.postMessage(response);
    }
  };

  worker.addEventListener('message', handleMessage);
}

/**
 * Creates a fetch proxy that can be attached to multiple workers.
 * Useful for managing proxy state across worker lifecycle.
 */
export function createFetchProxyManager(allowedHosts: string[]) {
  const workers = new Set<Worker>();

  return {
    /**
     * Attach the fetch proxy to a worker.
     */
    attach(worker: Worker): void {
      if (!workers.has(worker)) {
        workers.add(worker);
        setupFetchProxy(worker, allowedHosts);
      }
    },

    /**
     * Detach the fetch proxy from a worker.
     * Note: This doesn't actually remove the listener since we can't
     * easily reference it. The worker should be terminated instead.
     */
    detach(worker: Worker): void {
      workers.delete(worker);
    },

    /**
     * Get the allowed hosts list.
     */
    getAllowedHosts(): readonly string[] {
      return allowedHosts;
    },
  };
}
