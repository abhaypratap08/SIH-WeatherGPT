"""
Local LangChain Weather Agent
=============================

A LangChain "tool calling" agent that answers natural-language weather
questions like:

    "What's the weather like in Delhi?"
    "Will it rain in Mumbai?"
    "Is it hot in New York?"

It runs 100% locally using Ollama as the LLM backend (no OpenAI/Anthropic
API keys needed) and uses the free, no-API-key Open-Meteo APIs for:
  1. Geocoding a place name -> latitude/longitude
  2. Fetching current weather + today's forecast for those coordinates
"""

import argparse
import json
import os
import sys

import requests
from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_ollama import ChatOllama

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# WMO weather interpretation codes -> human readable description
WEATHER_CODES = {
    0: "clear sky",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "depositing rime fog",
    51: "light drizzle",
    53: "moderate drizzle",
    55: "dense drizzle",
    56: "light freezing drizzle",
    57: "dense freezing drizzle",
    61: "slight rain",
    63: "moderate rain",
    65: "heavy rain",
    66: "light freezing rain",
    67: "heavy freezing rain",
    71: "slight snow fall",
    73: "moderate snow fall",
    75: "heavy snow fall",
    77: "snow grains",
    80: "slight rain showers",
    81: "moderate rain showers",
    82: "violent rain showers",
    85: "slight snow showers",
    86: "heavy snow showers",
    95: "thunderstorm",
    96: "thunderstorm with slight hail",
    99: "thunderstorm with heavy hail",
}


# ---------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------

@tool
def geocode_place(place_name: str) -> str:
    """Look up the latitude, longitude, resolved name, and country for a
    place name (city, town, etc). Always call this FIRST for any place
    before fetching weather, since the weather tool needs coordinates,
    not a place name. Returns a JSON string."""
    try:
        resp = requests.get(
            GEOCODE_URL,
            params={"name": place_name, "count": 1, "language": "en", "format": "json"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        return json.dumps({"error": f"Geocoding request failed: {e}"})

    results = data.get("results")
    if not results:
        return json.dumps({"error": f"No location found matching '{place_name}'."})

    top = results[0]
    return json.dumps(
        {
            "name": top.get("name"),
            "country": top.get("country"),
            "admin1": top.get("admin1"),
            "latitude": top.get("latitude"),
            "longitude": top.get("longitude"),
            "timezone": top.get("timezone"),
        }
    )


@tool
def get_weather(latitude: float, longitude: float) -> str:
    """Fetch current weather conditions and today's forecast (max/min temp,
    precipitation chance, windspeed) for a given latitude/longitude.
    Call geocode_place first to turn a place name into coordinates.
    Returns a JSON string with the weather data."""
    try:
        resp = requests.get(
            FORECAST_URL,
            params={
                "latitude": latitude,
                "longitude": longitude,
                "current": "temperature_2m,apparent_temperature,relative_humidity_2m,"
                           "precipitation,weathercode,windspeed_10m",
                "daily": "weathercode,temperature_2m_max,temperature_2m_min,"
                         "precipitation_probability_max,precipitation_sum",
                "timezone": "auto",
                "forecast_days": 1,
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        return json.dumps({"error": f"Weather request failed: {e}"})

    current = data.get("current", {})
    daily = data.get("daily", {})

    def describe(code):
        return WEATHER_CODES.get(code, f"unknown conditions (code {code})")

    result = {
        "current": {
            "temperature_c": current.get("temperature_2m"),
            "feels_like_c": current.get("apparent_temperature"),
            "humidity_percent": current.get("relative_humidity_2m"),
            "precipitation_mm": current.get("precipitation"),
            "windspeed_kmh": current.get("windspeed_10m"),
            "condition": describe(current.get("weathercode")),
        },
        "today_forecast": {
            "max_temp_c": (daily.get("temperature_2m_max") or [None])[0],
            "min_temp_c": (daily.get("temperature_2m_min") or [None])[0],
            "chance_of_rain_percent": (daily.get("precipitation_probability_max") or [None])[0],
            "total_precipitation_mm": (daily.get("precipitation_sum") or [None])[0],
            "condition": describe((daily.get("weathercode") or [None])[0]),
        },
        "timezone": data.get("timezone"),
    }
    return json.dumps(result)


TOOLS = [geocode_place, get_weather]


# ---------------------------------------------------------------------
# Agent construction
# ---------------------------------------------------------------------

SYSTEM_PROMPT = """You are WeatherGPT, a helpful AI weather assistant aligned with IMD (India Meteorological Department) standards.

For ANY question about weather, temperature, rain, heat, cold, wind, etc.
in a place, you MUST use your tools to get real data — never guess or use
prior knowledge about typical weather.

Workflow:
1. Call `geocode_place` with the place name mentioned by the user to get
   its latitude/longitude.
2. Call `get_weather` with that latitude/longitude to get current
   conditions and today's forecast.
3. Answer the user's actual question directly and concisely in plain
   language (e.g. "Yes, it's likely to rain in Mumbai today — about a
   70% chance, with 12mm expected."). Include the temperature in
   Celsius. Don't dump raw JSON at the user.
4. If relevant, add a brief actionable advisory (e.g. carry an umbrella,
   avoid outdoor work during peak heat, etc.).

If the place cannot be found, say so clearly instead of guessing.
"""


def build_agent(model_name: str = None, base_url: str = None):
    """Build a LangChain 1.0+ agent backed by a local Ollama chat model.

    Model priority:
      1. model_name argument (if provided and not None)
      2. OLLAMA_MODEL environment variable
      3. Default: llama3.2
    """
    resolved_model = model_name or os.environ.get("OLLAMA_MODEL", "llama3.2")
    resolved_url = base_url or os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

    llm = ChatOllama(
        model=resolved_model,
        base_url=resolved_url,
        temperature=0,
    )

    return create_agent(
        model=llm,
        tools=TOOLS,
        system_prompt=SYSTEM_PROMPT,
    )


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Local LangChain weather agent (Ollama-powered).")
    parser.add_argument("query", nargs="*", help="Weather question, e.g. 'is it hot in new york'")
    parser.add_argument(
        "--model",
        default=os.environ.get("OLLAMA_MODEL", "llama3.2"),
        help="Ollama model tag to use (default: llama3.2, or $OLLAMA_MODEL).",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="Ollama server URL (default: http://localhost:11434 or $OLLAMA_BASE_URL)",
    )
    args = parser.parse_args()

    agent = build_agent(args.model, args.base_url)

    def ask(query: str) -> str:
        result = agent.invoke({"messages": [{"role": "user", "content": query}]})
        return result["messages"][-1].content

    if args.query:
        query = " ".join(args.query)
        print("\n" + "=" * 60)
        print(ask(query))
        return

    print(f"Local Weather Agent (model: {args.model}). Type 'exit' to quit.\n")
    while True:
        try:
            query = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not query:
            continue
        if query.lower() in {"exit", "quit"}:
            break
        print(f"\nAgent: {ask(query)}\n")


if __name__ == "__main__":
    sys.exit(main())
