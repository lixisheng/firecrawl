"""
Search functionality for Firecrawl v2 API.
"""

from typing import Dict, Any, Union, List, TypeVar, Type
from ..types import SearchRequest, SearchData, Document, SearchResultWeb, SearchResultNews, SearchResultImages, SearchQueryPlan, SearchQueryPlanSearch
from ..utils.normalize import normalize_document_input, _map_search_result_keys
from ..utils import HttpClient, handle_response_error, validate_scrape_options, prepare_scrape_options

T = TypeVar("T")

def search(
    client: HttpClient,
    request: SearchRequest
) -> SearchData:
    """
    Search for documents.
    
    Args:
        client: HTTP client instance
        request: Search request
        
    Returns:
        SearchData with search results grouped by source type
        
    Raises:
        FirecrawlError: If the search operation fails
    """
    request_data = _prepare_search_request(request)
    try:
        response = client.post("/v2/search", request_data)
        if response.status_code != 200:
            handle_response_error(response, "search")
        response_data = response.json()
        if not response_data.get("success"):
            handle_response_error(response, "search")
        data = response_data.get("data", {}) or {}
        return _transform_search_data(data)
    except Exception as err:
        # If the error is an HTTP error from requests, handle it
        # (simulate isAxiosError by checking for requests' HTTPError or Response)
        if hasattr(err, "response"):
            handle_response_error(getattr(err, "response"), "search")
        raise err

def _transform_search_data(data: Dict[str, Any]) -> SearchData:
    out = SearchData()
    if "web" in data:
        out.web = _transform_array(data["web"], SearchResultWeb)
    if "news" in data:
        out.news = _transform_array(data["news"], SearchResultNews)
    if "images" in data:
        out.images = _transform_array(data["images"], SearchResultImages)
    if isinstance(data.get("queryPlan"), dict):
        out.query_plan = _transform_query_plan(data["queryPlan"])
    return out

def _transform_query_plan(plan: Dict[str, Any]) -> SearchQueryPlan:
    searches: List[SearchQueryPlanSearch] = []
    for entry in plan.get("searches", []) or []:
        search_entry = SearchQueryPlanSearch(
            query=str(entry.get("query", "")),
            goal=entry.get("goal"),
        )
        if "web" in entry:
            search_entry.web = _transform_array(entry["web"], SearchResultWeb)
        if "news" in entry:
            search_entry.news = _transform_array(entry["news"], SearchResultNews)
        if "images" in entry:
            search_entry.images = _transform_array(entry["images"], SearchResultImages)
        searches.append(search_entry)

    return SearchQueryPlan(
        mode=plan.get("mode"),
        original_query=plan.get("originalQuery"),
        results_per_query=plan.get("resultsPerQuery"),
        searches=searches,
    )

def _transform_array(arr: List[Any], result_type: Type[T]) -> List[Union[T, 'Document']]:
    """
    Transforms an array of items into a list of result_type or Document.
    If the item dict contains any of the special keys, it is treated as a Document.
    Otherwise, it is treated as result_type.
    If the item is not a dict, it is wrapped as result_type with url=item.
    """
    results: List[Union[T, 'Document']] = []
    for item in arr:
        if item and isinstance(item, dict):
            if (
                "markdown" in item or
                "html" in item or
                "rawHtml" in item or
                "links" in item or
                "screenshot" in item or
                "changeTracking" in item or
                "summary" in item or
                "json" in item
            ):
                results.append(Document(**normalize_document_input(item)))
            else:
                result_type_name = None
                if result_type == SearchResultImages:
                    result_type_name = "images"
                elif result_type == SearchResultNews:
                    result_type_name = "news"
                elif result_type == SearchResultWeb:
                    result_type_name = "web"

                if result_type_name:
                    normalized_item = _map_search_result_keys(item, result_type_name)
                    results.append(result_type(**normalized_item))
                else:
                    results.append(result_type(**item))
        else:
            results.append(result_type(url=item))
    return results

def _validate_search_request(request: SearchRequest) -> SearchRequest:
    """
    Validate and normalize search request.
    
    Args:
        request: Search request to validate
        
    Returns:
        Validated request
        
    Raises:
        ValueError: If request is invalid
    """
    # Validate query
    if isinstance(request.query, str):
        if not request.query or not request.query.strip():
            raise ValueError("Query cannot be empty")
    elif isinstance(request.query, list):
        if len(request.query) == 0:
            raise ValueError("Query array cannot be empty")
        if any((not isinstance(query, str)) or (not query.strip()) for query in request.query):
            raise ValueError("Query array cannot contain empty strings")
    else:
        raise ValueError("Query must be a string or list of strings")

    # Validate limit
    if request.limit is not None:
        if request.limit <= 0:
            raise ValueError("Limit must be positive")
        if request.limit > 100:
            raise ValueError("Limit cannot exceed 100")

    if request.results_per_query is not None:
        if request.results_per_query <= 0:
            raise ValueError("results_per_query must be positive")
        if request.results_per_query > 100:
            raise ValueError("results_per_query cannot exceed 100")

    # Validate timeout
    if request.timeout is not None:
        if request.timeout <= 0:
            raise ValueError("Timeout must be positive")
        if request.timeout > 300000:  # 5 minutes max
            raise ValueError("Timeout cannot exceed 300000ms (5 minutes)")

    if request.query_decomposition is not None:
        if not isinstance(request.query, str):
            raise ValueError("query_decomposition requires a single string query")
        if request.query_decomposition.max_queries is not None:
            if request.query_decomposition.max_queries < 2:
                raise ValueError("query_decomposition.max_queries must be at least 2")
            if request.query_decomposition.max_queries > 10:
                raise ValueError("query_decomposition.max_queries cannot exceed 10")

    # Validate sources (if provided)
    if request.sources is not None:
        valid_sources = {"web", "news", "images"}
        for source in request.sources:
            if isinstance(source, str):
                if source not in valid_sources:
                    raise ValueError(f"Invalid source type: {source}. Valid types: {valid_sources}")
            elif hasattr(source, 'type'):
                if source.type not in valid_sources:
                    raise ValueError(f"Invalid source type: {source.type}. Valid types: {valid_sources}")
    
    # Validate categories (if provided)
    if request.categories is not None:
        valid_categories = {"github", "research", "pdf"}
        for category in request.categories:
            if isinstance(category, str):
                if category not in valid_categories:
                    raise ValueError(f"Invalid category type: {category}. Valid types: {valid_categories}")
            elif hasattr(category, 'type'):
                if category.type not in valid_categories:
                    raise ValueError(f"Invalid category type: {category.type}. Valid types: {valid_categories}")
    
    # Validate location (if provided)
    if request.location is not None:
        if not isinstance(request.location, str) or len(request.location.strip()) == 0:
            raise ValueError("Location must be a non-empty string")
    
    # Validate tbs (time-based search, if provided)
    if request.tbs is not None:
        if not isinstance(request.tbs, str) or len(request.tbs.strip()) == 0:
            raise ValueError("tbs must be a non-empty string")
    
    # Validate scrape_options (if provided)
    if request.scrape_options is not None:
        validate_scrape_options(request.scrape_options)
    
    return request


def _prepare_search_request(request: SearchRequest) -> Dict[str, Any]:
    """
    Prepare a search request payload.
    
    Args:
        request: Search request
        
    Returns:
        Request payload dictionary
    """
    validated_request = _validate_search_request(request)
    data = validated_request.model_dump(exclude_none=True, by_alias=True)
    
    # Ensure default values are included only if not explicitly set to None
    if "limit" not in data and validated_request.limit is not None:
        data["limit"] = validated_request.limit
    if "timeout" not in data and validated_request.timeout is not None:
        data["timeout"] = validated_request.timeout
    
    # Handle snake_case to camelCase conversions manually
    # (Pydantic Field() aliases interfere with value assignment)
    
    # ignore_invalid_urls → ignoreInvalidURLs
    if validated_request.ignore_invalid_urls is not None:
        data["ignoreInvalidURLs"] = validated_request.ignore_invalid_urls
        data.pop("ignore_invalid_urls", None)

    if validated_request.results_per_query is not None:
        data["resultsPerQuery"] = validated_request.results_per_query
        data.pop("results_per_query", None)

    if validated_request.query_decomposition is not None:
        data["queryDecomposition"] = validated_request.query_decomposition.model_dump(
            exclude_none=True,
            by_alias=True,
        )
        data.pop("query_decomposition", None)

    # scrape_options → scrapeOptions
    if validated_request.scrape_options is not None:
        scrape_data = prepare_scrape_options(validated_request.scrape_options)
        if scrape_data:
            data["scrapeOptions"] = scrape_data
        data.pop("scrape_options", None)
    
    # Only include integration if it was explicitly provided and non-empty
    integration_value = getattr(validated_request, "integration", None)
    if integration_value is not None:
        integration_str = str(integration_value).strip()
        if integration_str:
            data["integration"] = integration_str
    
    return data
