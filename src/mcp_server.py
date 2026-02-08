"""MCP server exposing shopping search tools via Streamable HTTP."""
from __future__ import annotations

import os
from dataclasses import asdict
from typing import Any, Dict, List, Optional

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from src.search import (
    SearchHit,
    rank_hits,
    rank_hits_weighted,
    search_image_cached,
    search_text_cached,
)

mcp = FastMCP("ShoppingSearch")


def _format_items(hits: List[SearchHit]) -> List[Dict[str, Any]]:
    return [asdict(h) for h in hits]


@mcp.tool
async def shopping_search_text(
    query: str,
    country_code: str = "ch",
    language: str = "en",
    max_results: int = 10,
    rank: bool = True,
    weight_price: float = 0.7,
    weight_delivery: float = 0.3,
) -> Dict[str, Any]:
    """Search for products by text query across Google Shopping.

    Args:
        query: Product search query, e.g. "iphone 17 256gb"
        country_code: Two-letter country code, e.g. "ch" for Switzerland
        language: Language code, e.g. "en" or "de"
        max_results: Maximum number of results to return (1-25)
        rank: Whether to rank results by weighted score
        weight_price: Weight for price in ranking (0-1)
        weight_delivery: Weight for delivery speed in ranking (0-1)
    """
    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        return {"error": "SERPAPI_API_KEY environment variable is not set."}

    try:
        blob = await search_text_cached(
            query,
            engine="google_shopping",
            country_code=country_code,
            language=language,
            n=max_results,
        )
    except Exception as e:
        return {"error": f"Search failed: {e}"}

    hits = [SearchHit(**item) for item in blob.get("normalized_hits", [])]

    if rank and hits:
        hits = rank_hits_weighted(hits, weight_price=weight_price, weight_delivery=weight_delivery)

    return {
        "query": query,
        "engine": "google_shopping",
        "country_code": country_code,
        "count": len(hits),
        "items": _format_items(hits[:max_results]),
    }


@mcp.tool
async def shopping_search_image(
    image_url: str,
    search_type: str = "products",
    refine_query: Optional[str] = None,
    country_code: str = "ch",
    language: str = "en",
    max_results: int = 10,
    rank: bool = True,
    weight_price: float = 0.7,
    weight_delivery: float = 0.3,
) -> Dict[str, Any]:
    """Search for products by image using Google Lens.

    Args:
        image_url: URL of the product image to search for
        search_type: Type of search - "products" for shopping results, "visual_matches" for similar images
        refine_query: Optional text query to refine image search results
        country_code: Two-letter country code, e.g. "ch" for Switzerland
        language: Language code, e.g. "en" or "de"
        max_results: Maximum number of results to return (1-25)
        rank: Whether to rank results by weighted score
        weight_price: Weight for price in ranking (0-1)
        weight_delivery: Weight for delivery speed in ranking (0-1)
    """
    if search_type not in ("products", "visual_matches"):
        return {"error": f"search_type must be 'products' or 'visual_matches', got '{search_type}'"}

    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        return {"error": "SERPAPI_API_KEY environment variable is not set."}

    try:
        blob = await search_image_cached(
            image_url,
            search_type=search_type,
            refine_query=refine_query,
            country_code=country_code,
            language=language,
            n=max_results,
        )
    except Exception as e:
        return {"error": f"Image search failed: {e}"}

    hits = [SearchHit(**item) for item in blob.get("normalized_hits", [])]

    if rank and hits:
        hits = rank_hits_weighted(hits, weight_price=weight_price, weight_delivery=weight_delivery)

    return {
        "image_url": image_url,
        "search_type": search_type,
        "engine": "google_lens",
        "country_code": country_code,
        "count": len(hits),
        "items": _format_items(hits[:max_results]),
    }


# --- ASGI app with CORS for browser clients ---

middleware = [
    Middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["mcp-protocol-version", "mcp-session-id", "Authorization", "Content-Type"],
        expose_headers=["mcp-session-id"],
    )
]

app = mcp.http_app(path="/mcp", middleware=middleware)


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("MCP_HOST", "127.0.0.1")
    port = int(os.getenv("MCP_PORT", "8080"))
    print(f"MCP server starting at http://{host}:{port}/mcp")
    uvicorn.run(app, host=host, port=port)
