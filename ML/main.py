import json
import os
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agent import build_agent
from route_weather.analyzer import analyze_route
from route_weather.geocoding import get_coordinates
from route_weather.route_api import get_route
from route_weather.route_processor import add_arrival_times, sample_route
from route_weather.weather_api import get_weather_for_route

# =========================================================
# FASTAPI APP & MIDDLEWARE
# =========================================================

app = FastAPI(
    title="WeatherGPT API",
    description="Unified API for Crop/Weather Agent and Route Weather Analysis.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# INITIALIZATION (OLLAMA / LANGCHAIN AGENT)
# =========================================================

# Model is configurable via OLLAMA_MODEL env var (default: llama3.2).
# Lazy-initialise so the server starts even if Ollama isn't running yet —
# it will fail gracefully at request time, not at startup.
_agent_instance = None


def get_agent():
    global _agent_instance
    if _agent_instance is None:
        _agent_instance = build_agent()  # reads OLLAMA_MODEL / OLLAMA_BASE_URL env vars
    return _agent_instance


# =========================================================
# REQUEST / RESPONSE MODELS
# =========================================================

class LocationPayload(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None


class AgentRequest(BaseModel):
    prompt: str
    location: Optional[LocationPayload] = None


class AgentResponse(BaseModel):
    message: str


class RouteWeatherRequest(BaseModel):
    origin: str
    destination: str
    departure_time: str


class RouteWeatherResponse(BaseModel):
    message: str
    route_info: dict[str, Any]
    risk_summary: dict[str, int]
    weather_data: list[dict[str, Any]]
    map_json: dict[str, Any]
    index_html: str


# =========================================================
# HELPER FUNCTIONS
# =========================================================

def reverse_geocode(latitude: float, longitude: float) -> Optional[str]:
    """
    Turn coordinates into a human-readable place name using OpenStreetMap's
    free Nominatim reverse-geocoding endpoint. Returns None on any failure
    so the caller can fall back to raw coordinates instead of erroring out.
    """
    try:
        params = urllib.parse.urlencode(
            {
                "lat": latitude,
                "lon": longitude,
                "format": "jsonv2",
                "zoom": 10,
                "addressdetails": 1,
            }
        )
        url = f"https://nominatim.openstreetmap.org/reverse?{params}"
        req = urllib.request.Request(
            url,
            headers={
                # Nominatim requires an identifying User-Agent for API use.
                "User-Agent": "WeatherGPT/1.0 (weather assistant app)"
            },
        )
        with urllib.request.urlopen(req, timeout=5) as res:
            data = json.loads(res.read().decode("utf-8"))

        address = data.get("address", {})
        city = (
            address.get("city")
            or address.get("town")
            or address.get("village")
            or address.get("county")
        )
        state = address.get("state")
        country = address.get("country")

        parts = [part for part in (city, state, country) if part]
        if parts:
            return ", ".join(parts)

        return data.get("display_name")
    except Exception:
        return None


def build_location_context(location: Optional[LocationPayload]) -> Optional[dict[str, str]]:
    """
    Turn a LocationPayload into a system message that tells the agent the
    user's current place, so it can answer "my location" style queries
    without asking the user to type a city.
    """
    if location is None:
        return None

    place_name = reverse_geocode(location.latitude, location.longitude)

    if place_name:
        location_desc = (
            f"{place_name} (approximately {location.latitude:.4f}, {location.longitude:.4f})"
        )
    else:
        location_desc = f"coordinates {location.latitude:.4f}, {location.longitude:.4f}"

    return {
        "role": "system",
        "content": (
            f"The user's current device location is: {location_desc}. "
            "If the user asks about 'my location', 'here', 'current location', "
            "or otherwise doesn't name a place, use this location directly instead "
            "of asking them to provide one."
        ),
    }


def generate_index_html(map_data: dict[str, Any]) -> str:
    """
    Generate a standalone Leaflet map HTML page matching the CLI output fields.
    """
    map_data_json = json.dumps(
        map_data,
        indent=2,
        ensure_ascii=False,
    )

    return f"""<!DOCTYPE html>
<html>
<head>
    <title>WeatherGPT Map</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        body {{ margin: 0; padding: 0; }}
        #map {{ height: 100vh; width: 100vw; }}
        .leaflet-popup-content {{
            font-family: Arial, sans-serif;
            font-size: 13px;
            line-height: 1.4;
        }}
        .risk-HIGH {{ color: #d9534f; font-weight: bold; }}
        .risk-MODERATE {{ color: #f0ad4e; font-weight: bold; }}
        .risk-LOW {{ color: #5cb85c; font-weight: bold; }}
    </style>
</head>
<body>
    <div id="map"></div>
    <script>
        const mapData = {map_data_json};
        const map = L.map('map');
        
        L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }}).addTo(map);

        if (mapData.route && mapData.route.length > 0) {{
            const polyline = L.polyline(mapData.route, {{color: 'blue'}}).addTo(map);
            map.fitBounds(polyline.getBounds());
        }}

        if (mapData.weather_points) {{
            mapData.weather_points.forEach(pt => {{
                // Robust lat/lon extraction
                const lat = pt.lat ?? pt.latitude ?? (Array.isArray(pt.coordinates) ? pt.coordinates[1] : null);
                const lon = pt.lon ?? pt.lng ?? pt.longitude ?? (Array.isArray(pt.coordinates) ? pt.coordinates[0] : null);

                if (lat !== null && lon !== null) {{
                    const popupContent = `
                        <div>
                            <b>Distance:</b> ${{pt.distance_from_start !== undefined ? pt.distance_from_start.toFixed(1) : 'N/A'}} km<br>
                            <b>Arrival:</b> ${{pt.arrival_time ? pt.arrival_time.substring(11, 16) : 'N/A'}}<br>
                            <b>Condition:</b> ${{pt.condition || 'N/A'}}<br>
                            <b>Temperature:</b> ${{pt.temperature !== undefined ? pt.temperature : 'N/A'}} °C<br>
                            <b>Rain probability:</b> ${{pt.rain_probability !== undefined ? pt.rain_probability : 'N/A'}}%<br>
                            <b>Wind:</b> ${{pt.wind_speed !== undefined ? pt.wind_speed : 'N/A'}} km/h<br>
                            <b>Risk:</b> <span class="risk-${{pt.risk}}">${{pt.risk || 'N/A'}}</span>
                        </div>
                    `;

                    L.marker([lat, lon])
                     .bindPopup(popupContent)
                     .addTo(map);
                }}
            }});
        }}
    </script>
</body>
</html>"""


# =========================================================
# ENDPOINTS
# =========================================================

@app.get("/")
def root():
    return {
        "message": "welcome to WeatherGPT",
        "services": ["weather_agent", "route_weather"],
    }


@app.post("/agent", response_model=AgentResponse)
def weather_agent(request: AgentRequest):
    messages: list[dict[str, str]] = []

    location_context = build_location_context(request.location)
    if location_context:
        messages.append(location_context)

    messages.append(
        {
            "role": "user",
            "content": request.prompt,
        }
    )

    result = get_agent().invoke({"messages": messages})

    response = result["messages"][-1].content

    return {
        "message": response
    }


@app.post("/route-weather", response_model=RouteWeatherResponse)
def route_weather(request: RouteWeatherRequest):
    # 1. Geocode locations
    origin = get_coordinates(request.origin)
    destination = get_coordinates(request.destination)

    if not origin:
        return {
            "message": "Could not find origin",
            "route_info": {},
            "risk_summary": {},
            "weather_data": [],
            "map_json": {},
            "index_html": "",
        }

    if not destination:
        return {
            "message": "Could not find destination",
            "route_info": {},
            "risk_summary": {},
            "weather_data": [],
            "map_json": {},
            "index_html": "",
        }

    # 2. Parse departure time
    today = datetime.now().strftime("%Y-%m-%d")
    departure_time = datetime.strptime(
        f"{today} {request.departure_time}",
        "%Y-%m-%d %H:%M",
    )

    # 3. Fetch & sample route
    route = get_route(origin, destination)
    route_points = sample_route(
        route["coordinates"],
        interval_km=30,
    )

    # 4. Add estimated arrival times along route
    route_points = add_arrival_times(
        route_points,
        route["distance_km"],
        route["duration_minutes"],
        departure_time,
    )

    # 5. Fetch and analyze weather
    weather_data = get_weather_for_route(route_points)
    analyzed_data = analyze_route(weather_data)

    # 6. Risk summary aggregation
    high = sum(1 for item in analyzed_data if item["risk"] == "HIGH")
    moderate = sum(1 for item in analyzed_data if item["risk"] == "MODERATE")
    low = sum(1 for item in analyzed_data if item["risk"] == "LOW")

    # 7. Construct map JSON matching CLI output formatting
    map_data = {
        "route": [
            [coordinate[1], coordinate[0]]
            for coordinate in route["coordinates"]
        ],
        "weather_points": [
            {
                **weather,
                "lat": weather.get("lat") or weather.get("latitude") or (weather.get("coordinates", [None, None])[1] if isinstance(weather.get("coordinates"), (list, tuple)) else None),
                "lon": weather.get("lon") or weather.get("lng") or weather.get("longitude") or (weather.get("coordinates", [None, None])[0] if isinstance(weather.get("coordinates"), (list, tuple)) else None),
                "arrival_time": weather["arrival_time"].isoformat() if hasattr(weather.get("arrival_time"), "isoformat") else str(weather.get("arrival_time")),
                "weather_time": weather["weather_time"].isoformat() if hasattr(weather.get("weather_time"), "isoformat") else str(weather.get("weather_time")),
            }
            for weather in analyzed_data
        ],
        "route_info": {
            "origin": request.origin,
            "destination": request.destination,
            "distance_km": route["distance_km"],
            "duration_minutes": route["duration_minutes"],
            "departure_time": departure_time.isoformat(),
        },
    }

    # 8. Save local artifacts (JSON & standalone HTML)
    map_folder = os.path.join(os.path.dirname(__file__), "map")
    os.makedirs(map_folder, exist_ok=True)

    json_path = os.path.join(map_folder, "route_weather_data.json")
    with open(json_path, "w", encoding="utf-8") as file:
        json.dump(map_data, file, indent=2)

    index_html = generate_index_html(map_data)
    html_path = os.path.join(map_folder, "index.html")
    with open(html_path, "w", encoding="utf-8") as file:
        file.write(index_html)

    # 9. Return Response
    return {
        "message": "WeatherGPT route analysis complete",
        "route_info": map_data["route_info"],
        "risk_summary": {
            "HIGH": high,
            "MODERATE": moderate,
            "LOW": low,
        },
        "weather_data": analyzed_data,
        "map_json": map_data,
        "index_html": index_html,
    }