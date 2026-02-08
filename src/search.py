from __future__ import annotations

import os
import json
import time
import hashlib
from dataclasses import dataclass, asdict
from typing import List, Optional, Dict, Any, Tuple, Callable

import random
import re

import httpx
from dotenv import load_dotenv

load_dotenv()


# =========================
# Data model (stable output)
# =========================

@dataclass
class SearchHit:
    title: str
    url: str
    source: Optional[str] = None
    thumbnail: Optional[str] = None
    price_text: Optional[str] = None
    price_value: Optional[float] = None
    rating: Optional[float] = None
    reviews: Optional[int] = None
    delivery_text: Optional[str] = None
    delivery_days: Optional[int] = None
    in_stock: Optional[bool] = None


# =========================
# Delivery-days estimator
# =========================

_DELIVERY_PATTERNS: List[Tuple[re.Pattern, Any]] = [
    (re.compile(r"\bsame[\s-]?day\b", re.I), 0),
    (re.compile(r"\btomorrow\b", re.I), 1),
    (re.compile(r"\bnext[\s-]?day\b", re.I), 1),
    (re.compile(r"\b(\d+)\s*[-–to]+\s*(\d+)\s*(?:business\s+)?days?\b", re.I), "range"),
    (re.compile(r"\bin\s+(\d+)\s*(?:business\s+)?days?\b", re.I), "single"),
    (re.compile(r"\b(\d+)\s*(?:business\s+)?days?\s*(?:delivery|shipping)\b", re.I), "single"),
    (re.compile(r"\bdelivery\s+(?:in\s+)?(\d+)\s*(?:business\s+)?days?\b", re.I), "single"),
    (re.compile(r"\b(\d+)\s*[-–]\s*(\d+)\s*(?:business\s+)?(?:day|werktag)", re.I), "range"),
]


def parse_price(text: Optional[str]) -> Optional[float]:
    """Extract numeric price from strings like 'CHF 1'067.95', '$29.99', '€1.199,00'."""
    if not text:
        return None
    # Strip currency symbols/words, keep digits, dots, commas
    cleaned = re.sub(r"[^\d.,]", "", text.replace("'", "").replace("\u2019", ""))
    if not cleaned:
        return None
    # Handle European format: 1.199,00 -> 1199.00
    if "," in cleaned and "." in cleaned:
        if cleaned.rindex(",") > cleaned.rindex("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        # Could be 1,00 (decimal) or 1,000 (thousands) — guess by position
        parts = cleaned.split(",")
        if len(parts[-1]) == 2:
            cleaned = cleaned.replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_delivery_days(text: Optional[str]) -> Optional[int]:
    """Best-effort parse of delivery strings into estimated days.  Returns None if unparseable."""
    if not text:
        return None
    for pattern, action in _DELIVERY_PATTERNS:
        m = pattern.search(text)
        if not m:
            continue
        if isinstance(action, int):
            return action
        if action == "range":
            lo, hi = int(m.group(1)), int(m.group(2))
            return (lo + hi + 1) // 2  # midpoint, rounded up
        if action == "single":
            return int(m.group(1))
    return None


def _mock_delivery_days(title: str) -> int:
    """Deterministic mock: hash the title so same product always gets same value."""
    h = hash(title) % 10
    # spread: 1–7 days, weighted toward 2–4
    return [1, 2, 2, 3, 3, 3, 4, 4, 5, 7][h]


# =========================
# Normalize raw SerpAPI items → SearchHit
# =========================

def _fix_price(extracted: Optional[float], price_text: Optional[str]) -> Optional[float]:
    """SerpAPI's extracted_price chokes on Swiss apostrophe thousands separator.  Fall back to our own parser."""
    parsed = parse_price(price_text) if price_text else None
    if extracted is not None and parsed is not None:
        # If SerpAPI's value is suspiciously small vs our parse, trust ours
        if parsed > extracted * 5:
            return parsed
        return extracted
    return parsed if parsed is not None else extracted


def normalize_google_shopping(raw_items: List[Dict[str, Any]]) -> List[SearchHit]:
    hits: List[SearchHit] = []
    for item in raw_items:
        title = item.get("title") or ""
        url = item.get("product_link") or item.get("link") or ""
        if not title or not url:
            continue
        delivery_text = item.get("delivery") or (item.get("extensions", [None])[0] if item.get("extensions") else None)
        price_text = item.get("price")
        hits.append(SearchHit(
            title=title, url=url,
            source=item.get("source"),
            thumbnail=item.get("thumbnail"),
            price_text=price_text,
            price_value=_fix_price(item.get("extracted_price"), price_text),
            rating=item.get("rating"),
            reviews=item.get("reviews"),
            delivery_text=delivery_text if isinstance(delivery_text, str) else None,
            delivery_days=parse_delivery_days(delivery_text if isinstance(delivery_text, str) else None) or _mock_delivery_days(title),
            in_stock=None,
        ))
    return hits


def normalize_amazon(raw_items: List[Dict[str, Any]]) -> List[SearchHit]:
    hits: List[SearchHit] = []
    for item in raw_items:
        title = item.get("title") or ""
        url = item.get("link") or ""
        if not title or not url:
            continue
        price_text = None
        if item.get("price"):
            price_text = item["price"] if isinstance(item["price"], str) else item["price"].get("raw")
        delivery_raw = item.get("delivery") or ""
        if isinstance(delivery_raw, list):
            delivery_text = "; ".join(str(d) for d in delivery_raw)
        else:
            delivery_text = str(delivery_raw)
        hits.append(SearchHit(
            title=title, url=url,
            source="Amazon",
            thumbnail=item.get("thumbnail"),
            price_text=price_text,
            price_value=_fix_price(item.get("extracted_price") or item.get("price", {}).get("value") if isinstance(item.get("price"), dict) else item.get("extracted_price"), price_text),
            rating=item.get("rating"),
            reviews=item.get("reviews"),
            delivery_text=delivery_text or None,
            delivery_days=parse_delivery_days(delivery_text) or _mock_delivery_days(title),
            in_stock=None,
        ))
    return hits


def normalize_duckduckgo(raw_items: List[Dict[str, Any]]) -> List[SearchHit]:
    """DuckDuckGo returns organic web results, not shopping. We extract what we can."""
    hits: List[SearchHit] = []
    for item in raw_items:
        title = item.get("title") or ""
        url = item.get("link") or ""
        if not title or not url:
            continue
        hits.append(SearchHit(
            title=title, url=url,
            source=item.get("source") or item.get("displayed_link"),
            thumbnail=item.get("favicon"),
            price_text=None,
            price_value=None,
            rating=None,
            reviews=None,
            delivery_text=None,
            delivery_days=_mock_delivery_days(title),
            in_stock=None,
        ))
    return hits


def normalize_google_lens(raw_items: List[Dict[str, Any]]) -> List[SearchHit]:
    hits: List[SearchHit] = []
    for item in raw_items:
        title = item.get("title") or ""
        url = item.get("link") or ""
        if not title or not url:
            continue
        price_obj = item.get("price") or {}
        price_text = price_obj.get("value") if isinstance(price_obj, dict) else None
        price_extracted = price_obj.get("extracted_value") if isinstance(price_obj, dict) else None
        hits.append(SearchHit(
            title=title, url=url,
            source=item.get("source"),
            thumbnail=item.get("thumbnail"),
            price_text=price_text,
            price_value=_fix_price(price_extracted, price_text),
            rating=item.get("rating"),
            reviews=item.get("reviews"),
            delivery_text=None,
            delivery_days=_mock_delivery_days(title),
            in_stock=item.get("in_stock"),
        ))
    # Prioritize hits with prices
    priced = [h for h in hits if h.price_value is not None]
    unpriced = [h for h in hits if h.price_value is None]
    return priced + unpriced


# =========================
# Ranking
# =========================

def rank_hits(
    hits: List[SearchHit],
    sort_by: str = "price",
    descending: bool = False,
) -> List[SearchHit]:
    """Sort hits by 'price' or 'delivery_days'. Items missing the field go last."""
    if sort_by == "price":
        key_fn = lambda h: (h.price_value is None, h.price_value or 0)
    elif sort_by == "delivery_days":
        key_fn = lambda h: (h.delivery_days is None, h.delivery_days or 0)
    else:
        raise ValueError(f"Unknown sort_by={sort_by!r}, expected 'price' or 'delivery_days'")
    return sorted(hits, key=key_fn, reverse=descending)


NORMALIZERS = {
    "google_shopping": ("shopping_results", normalize_google_shopping),
    "google_lens": ("visual_matches", normalize_google_lens),
    "amazon": ("organic_results", normalize_amazon),
    "duckduckgo": ("organic_results", normalize_duckduckgo),
}


def normalize_raw(engine: str, raw: Dict[str, Any], n: int = 10) -> List[SearchHit]:
    results_key, fn = NORMALIZERS[engine]
    raw_items = raw.get(results_key) or []
    # For Lens, pass all items so price-first sorting works before trimming
    if engine == "google_lens":
        return fn(raw_items)[:n]
    return fn(raw_items[:n])


# =========================
# Provider: SerpAPI (multi-engine)
# =========================

class SerpApiProvider:
    """Uses SerpAPI — supports google_shopping, amazon, duckduckgo."""

    def __init__(self, api_key: Optional[str] = None) -> None:
        self.api_key = api_key or os.getenv("SERPAPI_API_KEY")
        if not self.api_key:
            raise RuntimeError("Missing SERPAPI_API_KEY env var (or pass api_key=...).")
        self.endpoint = "https://serpapi.com/search.json"

    async def search_text(
        self,
        query: str,
        *,
        engine: str = "google_shopping",
        country_code: str = "ch",
        language: str = "en",
        n: int = 10,
    ) -> Tuple[List[SearchHit], Dict[str, Any]]:
        if engine == "google_shopping":
            params = {"engine": engine, "q": query, "gl": country_code, "hl": language, "api_key": self.api_key}
        elif engine == "amazon":
            params = {"engine": engine, "k": query, "amazon_domain": "amazon.de", "language": "en_GB", "api_key": self.api_key}
        elif engine == "duckduckgo":
            # DDG kl format: "wt-wt" (worldwide) or "ch-de", "us-en", etc.
            params = {"engine": engine, "q": query, "api_key": self.api_key}
            if country_code:
                params["kl"] = f"{country_code}-{language}"
        else:
            raise ValueError(f"Unknown engine: {engine}")

        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(self.endpoint, params=params)
            r.raise_for_status()
            raw = r.json()

        return normalize_raw(engine, raw, n), raw

    async def search_image(
        self,
        image_url: str,
        *,
        search_type: str = "products",
        refine_query: Optional[str] = None,
        country_code: str = "ch",
        language: str = "en",
        n: int = 10,
    ) -> Tuple[List[SearchHit], Dict[str, Any]]:
        params: Dict[str, Any] = {
            "engine": "google_lens",
            "url": image_url,
            "hl": language,
            "api_key": self.api_key,
        }
        if country_code:
            params["country"] = country_code
        if search_type in ("products", "visual_matches"):
            params["type"] = search_type
        if refine_query:
            params["q"] = refine_query

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(self.endpoint, params=params)
            r.raise_for_status()
            raw = r.json()

        # normalize_google_lens already sorts priced-first
        return normalize_raw("google_lens", raw, n), raw


# =========================
# Cache / snapshots (avoid burning requests)
# =========================

class DiskCache:
    """
    Stores responses to avoid repeated paid requests.
    File format:
      {
        "meta": {...},
        "request": {...},
        "normalized_hits": [...],
        "raw": {...}
      }
    """
    def __init__(self, cache_dir: str = ".cache/shopping_search", ttl_seconds: int = 7 * 24 * 3600) -> None:
        self.cache_dir = cache_dir
        self.ttl_seconds = ttl_seconds
        os.makedirs(self.cache_dir, exist_ok=True)

    def _key(self, request: Dict[str, Any]) -> str:
        s = json.dumps(request, sort_keys=True, ensure_ascii=False).encode("utf-8")
        return hashlib.sha256(s).hexdigest()

    def _path(self, key: str) -> str:
        return os.path.join(self.cache_dir, f"{key}.json")

    def load(self, request: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        key = self._key(request)
        path = self._path(key)
        if not os.path.exists(path):
            return None

        try:
            with open(path, "r", encoding="utf-8") as f:
                blob = json.load(f)
        except Exception:
            return None

        ts = blob.get("meta", {}).get("timestamp")
        if isinstance(ts, (int, float)) and (time.time() - ts) > self.ttl_seconds:
            return None

        return blob

    def save(self, request: Dict[str, Any], normalized_hits: List[SearchHit], raw: Dict[str, Any]) -> Dict[str, Any]:
        key = self._key(request)
        path = self._path(key)
        tmp = path + ".tmp"

        blob = {
            "meta": {"timestamp": time.time(), "provider": request.get("provider"), "cache_hit": False},
            "request": request,
            "normalized_hits": [asdict(h) for h in normalized_hits],
            "raw": raw,
        }

        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(blob, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
        return blob


def save_snapshot(blob: Dict[str, Any], out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(blob, f, ensure_ascii=False, indent=2)
    os.replace(tmp, out_path)


# =========================
# Main function you call
# =========================

async def search_text_cached(
    query: str,
    *,
    engine: str = "google_shopping",
    country_code: str = "ch",
    language: str = "en",
    n: int = 10,
    force_refresh: bool = False,
    cache: Optional[DiskCache] = None,
) -> Dict[str, Any]:
    request = {
        "engine": engine,
        "mode": "text",
        "query": query,
        "country_code": country_code,
        "language": language,
        "n": n,
    }

    cache = cache or DiskCache()

    if not force_refresh:
        cached = cache.load(request)
        if cached is not None:
            cached.setdefault("meta", {})
            cached["meta"]["cache_hit"] = True
            return cached

    provider = SerpApiProvider()
    hits, raw = await provider.search_text(query, engine=engine, country_code=country_code, language=language, n=n)
    blob = cache.save(request, hits, raw)
    return blob


async def search_image_cached(
    image_url: str,
    *,
    search_type: str = "products",
    refine_query: Optional[str] = None,
    country_code: str = "ch",
    language: str = "en",
    n: int = 10,
    force_refresh: bool = False,
    cache: Optional[DiskCache] = None,
) -> Dict[str, Any]:
    request = {
        "engine": "google_lens",
        "mode": "image",
        "image_url": image_url,
        "search_type": search_type,
        "refine_query": refine_query,
        "country_code": country_code,
        "language": language,
        "n": n,
    }

    cache = cache or DiskCache()

    if not force_refresh:
        cached = cache.load(request)
        if cached is not None:
            cached.setdefault("meta", {})
            cached["meta"]["cache_hit"] = True
            return cached

    provider = SerpApiProvider()
    hits, raw = await provider.search_image(
        image_url, search_type=search_type, refine_query=refine_query,
        country_code=country_code, language=language, n=n,
    )
    blob = cache.save(request, hits, raw)
    return blob


# =========================
# CLI
# =========================

if __name__ == "__main__":
    import argparse
    import asyncio

    p = argparse.ArgumentParser()
    p.add_argument("--q", default="", help="Search query, e.g. 'iphone 17'")
    p.add_argument("--image-url", default="", help="Image URL for visual search (Google Lens)")
    p.add_argument("--search-type", default="products", choices=["products", "visual_matches"])
    p.add_argument("--engine", default="google_shopping", choices=["google_shopping", "google_lens", "amazon", "duckduckgo"])
    p.add_argument("--country", default="ch", help="Country code, e.g. ch")
    p.add_argument("--lang", default="en", help="Language code, e.g. en/de")
    p.add_argument("--n", type=int, default=10, help="Number of hits")
    p.add_argument("--force", action="store_true", help="Bypass cache and hit the API")
    p.add_argument("--sort-by", default="", choices=["", "price", "delivery_days"], help="Rank results by field")
    p.add_argument("--desc", action="store_true", help="Sort descending (default is ascending / cheapest first)")
    p.add_argument("--out", default="", help="Optional snapshot path, e.g. snapshots/foo.json")
    p.add_argument("--replay", default="", help="Re-normalize from a saved snapshot (no API call)")
    args = p.parse_args()

    if not args.replay and not args.q and not args.image_url:
        p.error("Either --q or --image-url is required (unless using --replay)")

    async def _run() -> None:
        if args.replay:
            with open(args.replay, "r", encoding="utf-8") as f:
                blob = json.load(f)
            engine = blob.get("request", {}).get("engine", args.engine)
            hits = normalize_raw(engine, blob["raw"], args.n)
            if args.sort_by:
                hits = rank_hits(hits, sort_by=args.sort_by, descending=args.desc)
            blob["normalized_hits"] = [asdict(h) for h in hits]
            print(json.dumps(blob["normalized_hits"], ensure_ascii=False, indent=2))
            if args.out:
                save_snapshot(blob, args.out)
            return

        if args.image_url:
            blob = await search_image_cached(
                args.image_url,
                search_type=args.search_type,
                refine_query=args.q or None,
                country_code=args.country,
                language=args.lang,
                n=args.n,
                force_refresh=args.force,
            )
        else:
            blob = await search_text_cached(
                args.q,
                engine=args.engine,
                country_code=args.country,
                language=args.lang,
                n=args.n,
                force_refresh=args.force,
            )

        if args.sort_by:
            hits = [SearchHit(**h) for h in blob["normalized_hits"]]
            hits = rank_hits(hits, sort_by=args.sort_by, descending=args.desc)
            blob["normalized_hits"] = [asdict(h) for h in hits]

        print(json.dumps(blob["normalized_hits"], ensure_ascii=False, indent=2))

        # optional: save full blob (meta+request+normalized+raw) to a file
        if args.out:
            save_snapshot(blob, args.out)

    asyncio.run(_run())
