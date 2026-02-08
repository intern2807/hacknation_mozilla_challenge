from __future__ import annotations

import asyncio
import os
from dataclasses import asdict
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from search import SearchHit, rank_hits, search_image_cached, search_text_cached


DEFAULT_PORT = int(os.getenv("HARBOR_API_PORT", "8765"))
DEFAULT_HOST = os.getenv("HARBOR_API_HOST", "127.0.0.1")
DEFAULT_ORIGINS = os.getenv(
    "HARBOR_API_CORS_ORIGINS",
    "http://localhost,http://127.0.0.1",
)


def _parse_origins(value: str) -> List[str]:
    return [origin.strip() for origin in value.split(",") if origin.strip()]


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=300)
    delivery: Literal["cheapest", "fastest"] = "cheapest"
    privacy: Literal["strict", "limited", "open"] = "limited"
    location: Optional[str] = ""
    country_code: str = Field(default="us", min_length=2, max_length=2)
    language: str = Field(default="en", min_length=2, max_length=8)
    n: int = Field(default=12, ge=1, le=25)
    force_refresh: bool = False
    product_image_url: Optional[str] = None
    product_title: Optional[str] = None


app = FastAPI(title="Harbor Search API", version="0.1.0")

cors_origins = _parse_origins(DEFAULT_ORIGINS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins if cors_origins else ["*"],
    allow_origin_regex=r"^(moz-extension|chrome-extension)://.*$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _engines_for_privacy(privacy: str) -> List[str]:
    if privacy == "strict":
        return ["duckduckgo"]
    if privacy == "open":
        return ["google_shopping", "amazon", "duckduckgo"]
    return ["google_shopping", "duckduckgo"]


def _to_ui_result(hit: SearchHit) -> Dict[str, Any]:
    price = hit.price_text
    if not price and hit.price_value is not None:
        price = f"${hit.price_value:.2f}"

    delivery = hit.delivery_text
    if not delivery and hit.delivery_days is not None:
        delivery = f"Estimated delivery: {hit.delivery_days} day{'s' if hit.delivery_days != 1 else ''}"

    return {
        "title": hit.title,
        "url": hit.url,
        "source": hit.source or "Unknown",
        "image": hit.thumbnail,
        "price": price,
        "delivery": delivery,
        "rating": hit.rating,
        "reviews": hit.reviews,
        "inStock": hit.in_stock,
    }


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {"ok": True, "host": DEFAULT_HOST, "port": DEFAULT_PORT}


@app.post("/search")
async def search(payload: SearchRequest) -> Dict[str, Any]:
    query = payload.query.strip()
    if payload.location and payload.location.strip() and payload.location != "auto":
        query = f"{query} {payload.location.strip()}"

    engines = _engines_for_privacy(payload.privacy)
    tasks = [
        search_text_cached(
            query,
            engine=engine,
            country_code=payload.country_code,
            language=payload.language,
            n=payload.n,
            force_refresh=payload.force_refresh,
        )
        for engine in engines
    ]

    if payload.product_image_url:
        tasks.append(
                search_image_cached(
                    payload.product_image_url,
                    search_type="products",
                    refine_query=payload.product_title or query,
                country_code=payload.country_code,
                language=payload.language,
                n=payload.n,
                force_refresh=payload.force_refresh,
            )
        )

    blobs = await asyncio.gather(*tasks, return_exceptions=True)

    hits: List[SearchHit] = []
    failures: List[str] = []
    for blob in blobs:
        if isinstance(blob, Exception):
            failures.append(str(blob))
            continue
        for item in blob.get("normalized_hits", []):
            try:
                hits.append(SearchHit(**item))
            except TypeError:
                continue

    if not hits:
        detail = "No results returned from providers."
        if failures:
            detail = f"{detail} Errors: {'; '.join(failures)}"
        raise HTTPException(status_code=502, detail=detail)

    deduped: Dict[str, SearchHit] = {}
    for hit in hits:
        if hit.url not in deduped:
            deduped[hit.url] = hit

    merged_hits = list(deduped.values())
    sort_field = "delivery_days" if payload.delivery == "fastest" else "price"
    ranked_hits = rank_hits(merged_hits, sort_by=sort_field)
    sliced_hits = ranked_hits[: payload.n]

    return {
        "query": payload.query,
        "results": [_to_ui_result(hit) for hit in sliced_hits],
        "meta": {
            "engines": engines,
            "delivery": payload.delivery,
            "privacy": payload.privacy,
            "count": len(sliced_hits),
            "total_before_dedupe": len(hits),
            "errors": failures,
        },
        "normalized_hits": [asdict(hit) for hit in sliced_hits],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=DEFAULT_HOST, port=DEFAULT_PORT, reload=False)
