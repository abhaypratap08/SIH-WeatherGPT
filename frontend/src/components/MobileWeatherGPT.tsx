
import {
  CheckCircle,
  MapPin,
  Mic,
  Send,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { API_BASE_URL } from "../config/api";
import { useVoiceInput } from "../hooks/useVoiceInput";
import { useVoiceOutput } from "../hooks/useVoiceOutput";

import "./MobileWeatherGPT.css";

interface ChatMessage {
  id: string;
  role: "bot" | "user";
  content: string;
  timestamp: Date;
  voiceText?: string;
  structuredData?: any;
}

type ActiveTab =
  | "chat"
  | "nowcast"
  | "nwp"
  | "sectors"
  | "alerts"
  | "climate";

type Sector = "agriculture" | "aviation" | "marine" | "urban";

const LANGUAGES = [
  { code: "en", label: "English", speechLocale: "en-IN" },
  { code: "hi", label: "हिन्दी (Hindi)", speechLocale: "hi-IN" },
  { code: "ta", label: "தமிழ் (Tamil)", speechLocale: "ta-IN" },
  { code: "te", label: "తెలుగు (Telugu)", speechLocale: "te-IN" },
  { code: "bn", label: "বাংলা (Bengali)", speechLocale: "bn-IN" },
  { code: "mr", label: "मराठी (Marathi)", speechLocale: "mr-IN" },
  { code: "gu", label: "ગુજરાતી (Gujarati)", speechLocale: "gu-IN" },
];

export default function MobileWeatherGPT() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("chat");

  // Language is fixed to English because the language selector was removed.
  const selectedLang = "en";

  // Location
  const [currentCity, setCurrentCity] = useState("Delhi");
  const [gpsCoords, setGpsCoords] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [gpsWatching, setGpsWatching] = useState(false);
  const [gpsWatchId, setGpsWatchId] = useState<number | null>(null);

  // Chat
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "bot",
      content:
        "👋 Greetings! I am **WeatherGPT**, your AI meteorological & disaster decision-support assistant aligned with MoES / IMD.\n\nAsk me in your preferred language about forecasts, crop advisories, NWP multi-model predictions, or extreme weather alerts!",
      timestamp: new Date(),
    },
  ]);

  // Voice
  const [isSpeakingId, setIsSpeakingId] = useState<string | null>(null);

  // Live data
  const [nowcastData, setNowcastData] = useState<any>(null);
  const [forecastDays, setForecastDays] = useState<any[]>([]);
  const [nwpData, setNwpData] = useState<any>(null);
  const [sectorData, setSectorData] = useState<any>(null);
  const [activeSector, setActiveSector] =
    useState<Sector>("agriculture");
  const [alertsData, setAlertsData] = useState<any>(null);
  const [climateData, setClimateData] = useState<any>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const activeLangObj = useMemo(
    () =>
      LANGUAGES.find((language) => language.code === selectedLang) ??
      LANGUAGES[0],
    [selectedLang]
  );

  const { speak, stop: stopSpeech, isSpeaking } = useVoiceOutput();

  const {
    status: voiceStatus,
    isSupported: voiceSupported,
    startListening,
    stopListening,
  } = useVoiceInput({
    lang: activeLangObj.speechLocale,

    onTranscript: (text: string) => {
      if (!text) return;

      setInput(text);
    },
  });

  /*
   * Scroll chat to bottom whenever messages/loading changes.
   */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, isLoading]);

  /*
   * Stop speech when changing language.
   */
  useEffect(() => {
    stopSpeech();
    setIsSpeakingId(null);
  }, [selectedLang, stopSpeech]);

  /*
   * API helper.
   */
  const fetchJson = useCallback(
    async <T,>(url: string, signal?: AbortSignal): Promise<T> => {
      const response = await fetch(url, {
        signal,
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Request failed: ${response.status} ${response.statusText}`
        );
      }

      return response.json();
    },
    []
  );

  /*
   * Fetch current weather + forecast.
   */
  const fetchNowcast = useCallback(
    async (city: string, signal?: AbortSignal) => {
      try {
        const encodedCity = encodeURIComponent(city);

        const currentResponse = await fetchJson<any>(
          `${API_BASE_URL}/api/weather/current?location=${encodedCity}`,
          signal
        );

        if (currentResponse.success && currentResponse.data) {
          setNowcastData(currentResponse.data);
        }

        const forecastResponse = await fetchJson<any>(
          `${API_BASE_URL}/api/weather/forecast?location=${encodedCity}&days=7`,
          signal
        );

        if (
          forecastResponse.success &&
          Array.isArray(forecastResponse.data?.days)
        ) {
          setForecastDays(forecastResponse.data.days);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        console.warn("Could not fetch nowcast:", error);
      }
    },
    [fetchJson]
  );

  /*
   * Fetch NWP models.
   */
  const fetchNwp = useCallback(
    async (city: string, signal?: AbortSignal) => {
      try {
        const response = await fetchJson<any>(
          `${API_BASE_URL}/api/weather/nwp?location=${encodeURIComponent(
            city
          )}`,
          signal
        );

        if (response.success && response.data) {
          setNwpData(response.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        console.warn("Could not fetch NWP:", error);
      }
    },
    [fetchJson]
  );

  /*
   * Fetch sector advisories.
   */
  const fetchSectorAdvisories = useCallback(
    async (
      city: string,
      sector: Sector,
      signal?: AbortSignal
    ) => {
      try {
        const response = await fetchJson<any>(
          `${API_BASE_URL}/api/weather/advisories?location=${encodeURIComponent(
            city
          )}&sector=${encodeURIComponent(sector)}`,
          signal
        );

        if (response.success && response.data) {
          setSectorData(response.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        console.warn("Could not fetch sector advisories:", error);
      }
    },
    [fetchJson]
  );

  /*
   * Fetch alerts.
   */
  const fetchAlerts = useCallback(
    async (city: string, signal?: AbortSignal) => {
      try {
        const response = await fetchJson<any>(
          `${API_BASE_URL}/api/alerts/early-warnings?location=${encodeURIComponent(
            city
          )}`,
          signal
        );

        if (response.success && response.data) {
          setAlertsData(response.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        console.warn("Could not fetch alerts:", error);
      }
    },
    [fetchJson]
  );

  /*
   * Fetch climate data.
   */
  const fetchClimate = useCallback(
    async (city: string, signal?: AbortSignal) => {
      try {
        const response = await fetchJson<any>(
          `${API_BASE_URL}/api/weather/climate?location=${encodeURIComponent(
            city
          )}&startYear=2015&endYear=2024`,
          signal
        );

        if (response.success && response.data) {
          setClimateData(response.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        console.warn("Could not fetch climate data:", error);
      }
    },
    [fetchJson]
  );

  /*
   * Initial / location-change data loading.
   */
  useEffect(() => {
    const controller = new AbortController();

    const loadAll = async () => {
      await Promise.allSettled([
        fetchNowcast(currentCity, controller.signal),
        fetchNwp(currentCity, controller.signal),
        fetchSectorAdvisories(
          currentCity,
          activeSector,
          controller.signal
        ),
        fetchAlerts(currentCity, controller.signal),
        fetchClimate(currentCity, controller.signal),
      ]);
    };

    loadAll();

    return () => {
      controller.abort();
    };
  }, [
    currentCity,
    activeSector,
    fetchNowcast,
    fetchNwp,
    fetchSectorAdvisories,
    fetchAlerts,
    fetchClimate,
  ]);

  /*
   * Use browser GPS location.
   * Starts a real-time watch so the displayed location stays
   * current as the device moves; precise fix requested via
   * enableHighAccuracy + maximumAge === 0.
   *
   * Each fresh fix also immediately refreshes the advisory
   * data for the Agriculture, Smart City and Marine sectors.
   */
  /*
   * Fetch advisories for a GPS location and post them to the chat.
   */
  const loadAdvisoriesForLocation = useCallback(async (latitude: number, longitude: number) => {
    setIsLoading(true);

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: `📍 My GPS location: ${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
      timestamp: new Date(),
    };

    setMessages((previous) => [...previous, userMessage]);

    try {
      const response = await fetchJson<any>(
        `${API_BASE_URL}/api/weather/advisories?latitude=${latitude}&longitude=${longitude}&sector=all`
      );

      if (response.success && response.data) {
        setSectorData(response.data);

        const agriculture = response.data.agriculture ?? {};
        const marine = response.data.marine ?? {};

        const botMessage: ChatMessage = {
          id: `${Date.now()}-bot`,
          role: "bot",
          content:
            `📍 **Field Location Coordinates: ${latitude.toFixed(2)}°N, ${longitude.toFixed(2)}°E**\n\n` +
            `Hyper-local advisories retrieved for Agriculture, Smart City, and Severe Weather.\n\n` +
            `• Sowing Advisory: ${agriculture.sowingAdvisory ?? "Normal"}\n` +
            `• Irrigation: ${agriculture.irrigationRecommendation ?? "Adequate"}` +
            `• Marine/Fisheries: ${marine.fishermenAction ?? "Safe"}`,
          timestamp: new Date(),
        };

        setMessages((previous) => [...previous, botMessage]);
      }
    } catch (error) {
      console.error("GPS advisory request failed:", error);

      setMessages((previous) => [
        ...previous,
        {
          id: `${Date.now()}-error`,
          role: "bot",
          content:
            "⚠️ Unable to retrieve hyper-local weather advisories.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [fetchJson]);

  const handleUseMyLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      window.alert("Geolocation is not supported by your browser.");
      return;
    }

    // Toggle off an active watch
    if (gpsWatchId !== null) {
      navigator.geolocation.clearWatch(gpsWatchId);
      setGpsWatching(false);
      setGpsWatchId(null);
      setGpsCoords(null);
      return;
    }

    const watchOptions: PositionOptions = {
      enableHighAccuracy: true, // request GPS / precise fix
      timeout: 8000,
      maximumAge: 0, // never use a cached position — always get a fresh fix
    };

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;

        setCurrentCity(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        setGpsCoords({ latitude, longitude, accuracy: accuracy ?? 0 });
        setGpsWatching(true);

        console.info(
          `GPS fix: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} | accuracy: ${Math.round(accuracy ?? 0)}m`
        );

        // Fetch advisories on the first good fix only (don't spam the backend while the user stands still).
        await loadAdvisoriesForLocation(latitude, longitude);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          window.alert(
            `Location access denied. Please enable location for this site (and turn on \"Use precise location\" in your browser prompt), then try again.`
          );
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          console.warn("GPS signal unavailable:", error.message);
        } else if (error.code === error.TIMEOUT) {
          console.warn("GPS fix timed out:", error.message);
        } else {
          console.error("GPS watch error:", error);
        }
        // Keep watching — real devices often recover from temporary unavailability
      },
      watchOptions
    );

    setGpsWatchId(watchId);
    setGpsWatching(true);
  }, [gpsWatchId, loadAdvisoriesForLocation]);

  /*
   * Tear down the GPS watch whenever the component unmounts
   * so we stop consuming battery and geolocation resources.
   */
  useEffect(() => {
    return () => {
      if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
      }
    };
  }, [gpsWatchId]);

  /*
   * Send chat query.
   */
  const handleSend = useCallback(
    async (customMessage?: string) => {
      const textToSend = (
        customMessage !== undefined ? customMessage : input
      ).trim();

      if (!textToSend || isLoading) {
        return;
      }

      setInput("");
      setIsLoading(true);

      const userMessage: ChatMessage = {
        id: `${Date.now()}-user`,
        role: "user",
        content: textToSend,
        timestamp: new Date(),
      };

      setMessages((previous) => [
        ...previous,
        userMessage,
      ]);

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/chat/query`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              message: textToSend,
              language: selectedLang,
              sector: activeSector,
              sessionId: "mobile-session-01",
            }),
          }
        );

        if (!response.ok) {
          throw new Error(
            `Chat request failed: ${response.status}`
          );
        }

        const data = await response.json();

        if (data.success && data.data) {
          const botData = data.data;

          const answer =
            botData.answer || "Query processed.";

          const botMessage: ChatMessage = {
            id: `${Date.now()}-bot`,
            role: "bot",
            content: answer,
            voiceText: botData.voiceAnswer || answer,
            structuredData: botData,
            timestamp: new Date(),
          };

          setMessages((previous) => [
            ...previous,
            botMessage,
          ]);

          /*
           * Backend can return a resolved location.
           */
          if (botData.location?.name) {
            setCurrentCity(botData.location.name);
          }

          /*
           * Speak automatically for non-English languages
           * or when voiceAnswer was returned.
           */
          if (
            botData.voiceAnswer &&
            selectedLang !== "en"
          ) {
            stopSpeech();

            speak(
              botData.voiceAnswer,
              activeLangObj.speechLocale
            );
          }
        } else {
          const errorAnswer =
            data.message ||
            "I couldn't process that query. Please try asking about weather in a city.";

          setMessages((previous) => [
            ...previous,
            {
              id: `${Date.now()}-error`,
              role: "bot",
              content: `⚠️ ${errorAnswer}`,
              timestamp: new Date(),
            },
          ]);
        }
      } catch (error) {
        console.error("WeatherGPT chat error:", error);

        setMessages((previous) => [
          ...previous,
          {
            id: `${Date.now()}-network-error`,
            role: "bot",
            content:
              "⚠️ Unable to reach WeatherGPT backend. Please verify your internet connection and backend server.",
            timestamp: new Date(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [
      input,
      isLoading,
      selectedLang,
      activeSector,
      activeLangObj.speechLocale,
      speak,
      stopSpeech,
    ]
  );

  /*
   * Toggle speech recognition.
   */
  const toggleListen = useCallback(() => {
    if (!voiceSupported) {
      return;
    }

    if (voiceStatus === "listening") {
      stopListening();
      return;
    }

    stopSpeech();
    setIsSpeakingId(null);

    startListening();
  }, [
    voiceSupported,
    voiceStatus,
    stopListening,
    stopSpeech,
    startListening,
  ]);

  /*
   * Read a bot message aloud.
   */
  const handleReadAloud = useCallback(
    (message: ChatMessage) => {
      if (
        isSpeaking &&
        isSpeakingId === message.id
      ) {
        stopSpeech();
        setIsSpeakingId(null);
        return;
      }

      stopSpeech();

      const textToSpeak =
        message.voiceText ||
        message.content
          .replace(/\*\*/g, "")
          .replace(/[*#`_~]/g, "")
          .replace(/•/g, "");

      speak(
        textToSpeak,
        activeLangObj.speechLocale
      );

      setIsSpeakingId(message.id);
    },
    [
      isSpeaking,
      isSpeakingId,
      stopSpeech,
      speak,
      activeLangObj.speechLocale,
    ]
  );

  /*
   * Stop tracking message once speech ends.
   */
  useEffect(() => {
    if (!isSpeaking) {
      setIsSpeakingId(null);
    }
  }, [isSpeaking]);

  /*
   * Render chat text.
   */
  const renderBotMessage = (content: string) => {
    return content.split("\n\n").map(
      (paragraph, paragraphIndex) => (
        <div
          key={paragraphIndex}
          className="bot-message-section"
        >
          {paragraph.split("\n").map(
            (line, lineIndex) => {
              const cleanedLine = line.replace(
                /\*\*/g,
                ""
              );

              const isBullet =
                cleanedLine.trim().startsWith("•");

              return (
                <p
                  key={lineIndex}
                  className={
                    isBullet
                      ? "bullet-line"
                      : ""
                  }
                >
                  {cleanedLine}
                </p>
              );
            }
          )}
        </div>
      )
    );
  };

  return (
    <div className="mobile-weathergpt-container">
      {/* Header */}

      <header className="mobile-chat-header">
        <div className="mobile-header-left">
          <button
            type="button"
            className="mobile-branding-logo"
            title="WeatherGPT"
            aria-label="WeatherGPT"
          >
            <svg
              className="mobile-breeze-icon"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M2 16C2 23.7268 8.2732 30 16 30C23.7268 30 30 23.7268 30 16C30 8.2732 23.7268 2 16 2C8.2732 2 2 8.2732 2 16V16"
                stroke="white"
                strokeOpacity="0.225"
                strokeWidth="2.2"
                strokeLinecap="round"
              />

              <path
                d="M9 13.5C11.5 12 14 12 16.5 13.5C19 15 21.5 15 24 13.5"
                stroke="white"
                strokeOpacity="0.9"
                strokeWidth="2.2"
                strokeLinecap="round"
              />

              <path
                d="M8 17.5C10.5 16 13 16 15.5 17.5C18 19 20.5 19 23 17.5"
                stroke="white"
                strokeOpacity="0.9"
                strokeWidth="2.2"
                strokeLinecap="round"
              />

              <path
                d="M10 21.5C12 20.5 14 20.5 16 21.5C18 22.5 20 22.5 22 21.5"
                stroke="white"
                strokeOpacity="0.9"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="mobile-header-title">
            <h1 className="mobile-title">
              WeatherGPT Intelligence
            </h1>

            <p className="mobile-subtitle">
              <span className="status-dot" />
              MoES / IMD Multi-Model Ensemble •
              Latency: 142ms
            </p>
          </div>
        </div>

        <div className="mobile-header-actions">
          <button
            type="button"
            className="gps-btn"
            onClick={handleUseMyLocation}
            title="Use My Location"
            aria-label="Use my location"
          >
            {gpsWatching && gpsCoords ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: gpsCoords.accuracy <= 50 ? '#10b981' : '#f59e0b' }}>●</span>
                <MapPin size={14} />
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>GPS {Math.round(gpsCoords.accuracy)}m</span>
              </span>
            ) : (
              <MapPin size={16} />
            )}
          </button>
        </div>
      </header>

      {/* Navigation */}

      <nav
        className="mobile-nav-tabs"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gridTemplateRows: "repeat(2, auto)",
          gap: "6px",
          width: "100%",
          padding: "6px 18px",
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        {/* FIRST ROW: Alerts, Chat, Climate */}

        <button
          type="button"
          className={`nav-tab ${
            activeTab === "alerts" ? "active" : ""
          }`}
          onClick={() => setActiveTab("alerts")}
          style={{
            width: "100%",
            minWidth: 0,
            maxWidth: "none",
            boxSizing: "border-box",
            whiteSpace: "nowrap",
            justifyContent: "center",
          }}
        >
          🚨 Alerts{" "}
          {Number(alertsData?.totalAlerts ?? 0) > 0 && (
            <span className="tab-badge">
              {alertsData.totalAlerts}
            </span>
          )}
        </button>

        <button
          type="button"
          className={`nav-tab ${
            activeTab === "chat" ? "active" : ""
          }`}
          onClick={() => setActiveTab("chat")}
          style={{
            width: "100%",
            minWidth: 0,
            maxWidth: "none",
            boxSizing: "border-box",
            whiteSpace: "nowrap",
            justifyContent: "center",
          }}
        >
          💬 Chat
        </button>

        <button
          type="button"
          className={`nav-tab ${
            activeTab === "climate" ? "active" : ""
          }`}
          onClick={() => setActiveTab("climate")}
          style={{
            width: "100%",
            minWidth: 0,
            maxWidth: "none",
            boxSizing: "border-box",
            whiteSpace: "nowrap",
            justifyContent: "center",
          }}
        >
          📈 Climate
        </button>

        {/* SECOND ROW: Nowcast, NWP Models, Sectors */}

        <button
          type="button"
          className={`nav-tab ${
            activeTab === "nowcast" ? "active" : ""
          }`}
          onClick={() => setActiveTab("nowcast")}
          style={{
            width: "100%",
            minWidth: 0,
            maxWidth: "none",
            boxSizing: "border-box",
            whiteSpace: "nowrap",
            justifyContent: "center",
          }}
        >
          🌤️ Nowcast
        </button>

        <button
          type="button"
          className={`nav-tab ${
            activeTab === "nwp" ? "active" : ""
          }`}
          onClick={() => setActiveTab("nwp")}
          style={{
            width: "100%",
            minWidth: 0,
            maxWidth: "none",
            boxSizing: "border-box",
            whiteSpace: "nowrap",
            justifyContent: "center",
          }}
        >
          🛰️ NWP Models
        </button>

        <button
          type="button"
          className={`nav-tab ${
            activeTab === "sectors" ? "active" : ""
          }`}
          onClick={() => setActiveTab("sectors")}
          style={{
            width: "100%",
            minWidth: 0,
            maxWidth: "none",
            boxSizing: "border-box",
            whiteSpace: "nowrap",
            justifyContent: "center",
          }}
        >
          🌾 Sectors
        </button>
      </nav>

      {/* Main content */}

      <div className="mobile-content-area">
        {/* CHAT */}

        {activeTab === "chat" && (
          <div className="mobile-chat-body">
            <div className="quick-chip-tray">
              <button
                type="button"
                className="chip"
                onClick={() =>
                  handleSend(
                    `Weather in ${currentCity}`
                  )
                }
              >
                🌤️ Weather in {currentCity}
              </button>

              <button
                type="button"
                className="chip"
                onClick={() =>
                  handleSend(
                    `Will it rain tomorrow in ${currentCity}?`
                  )
                }
              >
                🌧️ Rain Tomorrow
              </button>

              <button
                type="button"
                className="chip"
                onClick={() =>
                  handleSend(
                    `Sowing advisory for ${currentCity}`
                  )
                }
              >
                🌾 Sowing Guidance
              </button>

              <button
                type="button"
                className="chip"
                onClick={() =>
                  handleSend(
                    `Compare GFS and ECMWF models for ${currentCity}`
                  )
                }
              >
                🛰️ NWP Models
              </button>

              <button
                type="button"
                className="chip"
                onClick={() =>
                  handleSend(
                    `Climate trend for ${currentCity}`
                  )
                }
              >
                📈 Climate Trend
              </button>
            </div>

            {messages.map((message) => (
              <div
                key={message.id}
                className={`mobile-message ${message.role}`}
              >
                {message.role === "bot" ? (
                  <div className="bot-message-container">
                    <div className="bot-message-content">
                      {renderBotMessage(
                        message.content
                      )}
                    </div>

                    <div className="bot-message-footer">
                      <button
                        type="button"
                        className="voice-read-btn"
                        onClick={() =>
                          handleReadAloud(message)
                        }
                        title="Read aloud"
                      >
                        {isSpeaking &&
                        isSpeakingId ===
                          message.id ? (
                          <VolumeX size={15} />
                        ) : (
                          <Volume2 size={15} />
                        )}

                        <span>
                          {isSpeaking &&
                          isSpeakingId ===
                            message.id
                            ? "Stop Speech"
                            : "Listen"}
                        </span>
                      </button>

                      <span className="source-tag">
                        MoES / IMD Synoptic Data
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="user-message-container">
                    <div className="user-message-bubble">
                      {message.content}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="mobile-message bot typing-message">
                <div className="typing-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}

        {/* NOWCAST */}

        {activeTab === "nowcast" && (
          <div className="nowcast-pane">
            <div className="city-search-box">
              <input
                type="text"
                value={currentCity}
                onChange={(event) =>
                  setCurrentCity(event.target.value)
                }
                placeholder="Enter city..."
              />

              <button
                type="button"
                onClick={() =>
                  fetchNowcast(currentCity)
                }
              >
                Fetch
              </button>
            </div>

            {nowcastData ? (
              <div className="metric-dashboard">
                <div className="main-temp-card">
                  <div className="card-top">
                    <span className="card-city">
                      {nowcastData.location?.name ??
                        currentCity}
                      {nowcastData.location?.country
                        ? `, ${nowcastData.location.country}`
                        : ""}
                    </span>

                    <span className="card-obs">
                      {nowcastData.observedAt ??
                        "Live"}
                    </span>
                  </div>

                  <div className="temp-hero">
                    <span className="temp-val">
                      {Number.isFinite(
                        Number(
                          nowcastData.temperature
                        )
                      )
                        ? Math.round(
                            Number(
                              nowcastData.temperature
                            )
                          )
                        : "--"}
                      °C
                    </span>

                    <span className="condition-pill">
                      {nowcastData.weatherDescription ??
                        "Unknown"}
                    </span>
                  </div>

                  <div className="metrics-row">
                    <div className="mini-metric">
                      <span className="m-lbl">
                        Feels Like
                      </span>

                      <span className="m-val">
                        {nowcastData.apparentTemperature !=
                        null
                          ? `${Math.round(
                              Number(
                                nowcastData.apparentTemperature
                              )
                            )}°C`
                          : "--"}
                      </span>
                    </div>

                    <div className="mini-metric">
                      <span className="m-lbl">
                        Humidity
                      </span>

                      <span className="m-val">
                        {nowcastData.humidity != null
                          ? `${nowcastData.humidity}%`
                          : "--"}
                      </span>
                    </div>

                    <div className="mini-metric">
                      <span className="m-lbl">
                        Wind
                      </span>

                      <span className="m-val">
                        {nowcastData.windSpeed != null
                          ? `${nowcastData.windSpeed} km/h`
                          : "--"}
                      </span>
                    </div>

                    <div className="mini-metric">
                      <span className="m-lbl">
                        Pressure
                      </span>

                      <span className="m-val">
                        {nowcastData.pressure != null
                          ? `${nowcastData.pressure} hPa`
                          : "--"}
                      </span>
                    </div>
                  </div>
                </div>

                <h3 className="section-title">
                  📅 7-Day Numerical Forecast
                </h3>

                <div className="forecast-scroll-row">
                  {forecastDays.map(
                    (day: any, index: number) => {
                      const dateText =
                        typeof day.date === "string"
                          ? day.date.substring(5)
                          : "--";

                      return (
                        <div
                          key={
                            day.date ??
                            `forecast-${index}`
                          }
                          className="forecast-day-card"
                        >
                          <span className="f-date">
                            {index === 0
                              ? "Today"
                              : index === 1
                              ? "Tmrw"
                              : dateText}
                          </span>

                          <span className="f-temp">
                            {day.tempMax != null
                              ? Math.round(
                                  Number(
                                    day.tempMax
                                  )
                                )
                              : "--"}
                            ° /{" "}
                            {day.tempMin != null
                              ? Math.round(
                                  Number(
                                    day.tempMin
                                  )
                                )
                              : "--"}
                            °
                          </span>

                          <span className="f-desc">
                            {day.weatherDescription ??
                              "Unknown"}
                          </span>

                          <span className="f-rain">
                            🌧️{" "}
                            {day.precipitationProbabilityMax ??
                              "--"}
                            %
                          </span>
                        </div>
                      );
                    }
                  )}
                </div>
              </div>
            ) : (
              <div className="loading-state">
                Loading Nowcast telemetry...
              </div>
            )}
          </div>
        )}

        {/* NWP */}

        {activeTab === "nwp" && (
          <div className="nwp-pane">
            <h3 className="section-title">
              🛰️ Numerical Weather Prediction
              (NWP) Ensemble
            </h3>

            <p className="section-sub">
              Direct comparison across NOAA GFS,
              ECMWF IFS (High Res), and WRF
              regional models.
            </p>

            {nwpData ? (
              <div>
                <div className="consensus-banner">
                  <div className="score-ring">
                    <span className="score-num">
                      {nwpData.consensus
                        ?.consensusScorePercentage ??
                        "--"}
                      %
                    </span>

                    <span className="score-lbl">
                      Consensus
                    </span>
                  </div>

                  <div className="consensus-info">
                    <strong>
                      Confidence:{" "}
                      {nwpData.consensus
                        ?.confidenceLevel ??
                        "Unknown"}
                    </strong>

                    <p>
                      {nwpData.consensus
                        ?.synopticSummary ??
                        "No summary available."}
                    </p>

                    <span className="spread-note">
                      Thermal Spread:{" "}
                      {nwpData.consensus
                        ?.tempSpread ?? "--"}
                      °C • Rain Spread:{" "}
                      {nwpData.consensus
                        ?.precipSpread ?? "--"}{" "}
                      mm
                    </span>
                  </div>
                </div>

                <div className="models-table">
                  {Array.isArray(
                    nwpData.models
                  ) &&
                    nwpData.models.map(
                      (
                        model: any,
                        index: number
                      ) => (
                        <div
                          key={
                            model.modelName ??
                            index
                          }
                          className="model-row"
                        >
                          <div className="model-header">
                            <span className="model-name">
                              {model.modelName ??
                                "Unknown Model"}
                            </span>

                            <span className="model-res">
                              {model.resolution ??
                                "--"}
                            </span>
                          </div>

                          <div className="model-stats">
                            <span>
                              Max:{" "}
                              <strong>
                                {model.maxTemp ??
                                  "--"}
                                °C
                              </strong>
                            </span>

                            <span>
                              Min:{" "}
                              <strong>
                                {model.minTemp ??
                                  "--"}
                                °C
                              </strong>
                            </span>

                            <span>
                              Rain:{" "}
                              <strong>
                                {model.totalPrecipitation ??
                                  "--"}{" "}
                                mm
                              </strong>{" "}
                              (
                              {model.precipitationProbability ??
                                "--"}
                              %)
                            </span>

                            <span>
                              Wind:{" "}
                              <strong>
                                {model.maxWindSpeed ??
                                  "--"}{" "}
                                km/h
                              </strong>
                            </span>
                          </div>

                          <div className="model-syn">
                            {model.synopticCondition ??
                              "No synoptic condition available."}
                          </div>
                        </div>
                      )
                    )}
                </div>
              </div>
            ) : (
              <div className="loading-state">
                Loading NWP model data...
              </div>
            )}
          </div>
        )}

        {/* SECTORS */}

        {activeTab === "sectors" && (
          <div className="sectors-pane">
            <div className="sector-selector-bar">
              <button
                type="button"
                className={`sector-tab ${
                  activeSector ===
                  "agriculture"
                    ? "active"
                    : ""
                }`}
                onClick={() =>
                  setActiveSector(
                    "agriculture"
                  )
                }
              >
                🌾 Agriculture
              </button>

              <button
                type="button"
                className={`sector-tab ${
                  activeSector ===
                  "aviation"
                    ? "active"
                    : ""
                }`}
                onClick={() =>
                  setActiveSector("aviation")
                }
              >
                ✈️ Aviation
              </button>

              <button
                type="button"
                className={`sector-tab ${
                  activeSector ===
                  "marine"
                    ? "active"
                    : ""
                }`}
                onClick={() =>
                  setActiveSector("marine")
                }
              >
                ⚓ Marine
              </button>

              <button
                type="button"
                className={`sector-tab ${
                  activeSector ===
                  "urban"
                    ? "active"
                    : ""
                }`}
                onClick={() =>
                  setActiveSector("urban")
                }
              >
                🏙️ Smart City
              </button>
            </div>

            {sectorData ? (
              <div className="sector-advisory-card">
                {/* Agriculture */}

                {activeSector ===
                  "agriculture" &&
                  sectorData.agriculture && (
                    <div>
                      <h4 className="advisory-title">
                        🌱 Agromet
                        Crop-Weather
                        Directives
                      </h4>

                      <div className="directive-item alert-success">
                        <strong>
                          Sowing Advice:
                        </strong>{" "}
                        {
                          sectorData
                            .agriculture
                            .sowingAdvisory
                        }
                      </div>

                      <div className="directive-item">
                        <strong>
                          Irrigation:
                        </strong>{" "}
                        {
                          sectorData
                            .agriculture
                            .irrigationRecommendation
                        }
                      </div>

                      <div className="directive-item">
                        <strong>
                          Chemical Spraying:
                        </strong>{" "}
                        {
                          sectorData
                            .agriculture
                            .sprayingWindow
                        }
                      </div>

                      <div className="directive-item">
                        <strong>
                          Harvest Window:
                        </strong>{" "}
                        {
                          sectorData
                            .agriculture
                            .harvestingGuidance
                        }
                      </div>

                      <div className="metric-pills">
                        <span>
                          Soil Moisture:{" "}
                          <strong>
                            {
                              sectorData
                                .agriculture
                                .soilMoistureIndex
                            }
                            %
                          </strong>
                        </span>

                        <span>
                          Pest Risk:{" "}
                          <strong>
                            {
                              sectorData
                                .agriculture
                                .pestDiseaseRisk
                            }
                          </strong>
                        </span>
                      </div>
                    </div>
                  )}

                {/* Aviation */}

                {activeSector ===
                  "aviation" &&
                  sectorData.aviation && (
                    <div>
                      <h4 className="advisory-title">
                        ✈️ Airport &
                        Aviation Weather
                        Briefing
                      </h4>

                      <div className="directive-item">
                        <strong>
                          Flight Category:
                        </strong>{" "}
                        <span className="cat-badge">
                          {
                            sectorData
                              .aviation
                              .flightCategory
                          }
                        </span>
                      </div>

                      <div className="code-box">
                        <code>
                          {
                            sectorData
                              .aviation
                              .metarCode
                          }
                        </code>
                      </div>

                      <div className="directive-item">
                        <strong>
                          Visibility:
                        </strong>{" "}
                        {
                          sectorData
                            .aviation
                            .visibilityKm
                        }{" "}
                        km |{" "}
                        <strong>
                          Ceiling:
                        </strong>{" "}
                        {
                          sectorData
                            .aviation
                            .cloudCeiling
                        }
                      </div>

                      <div className="directive-item">
                        <strong>
                          Crosswind:
                        </strong>{" "}
                        {
                          sectorData
                            .aviation
                            .crosswindKnots
                        }{" "}
                        kt |{" "}
                        <strong>
                          Turbulence:
                        </strong>{" "}
                        {
                          sectorData
                            .aviation
                            .turbulenceRisk
                        }
                      </div>
                    </div>
                  )}

                {/* Marine */}

                {activeSector ===
                  "marine" &&
                  sectorData.marine && (
                    <div>
                      <h4 className="advisory-title">
                        ⚓ Marine &
                        Coastal Fisheries
                        Advisory
                      </h4>

                      <div
                        className={`directive-item ${
                          sectorData.marine
                            .fishermenWarningActive
                            ? "alert-danger"
                            : "alert-success"
                        }`}
                      >
                        <strong>
                          Fishermen Directive:
                        </strong>{" "}
                        {
                          sectorData.marine
                            .fishermenAction
                        }
                      </div>

                      <div className="directive-item">
                        <strong>
                          Sea State:
                        </strong>{" "}
                        {
                          sectorData.marine
                            .seaState
                        }{" "}
                        (Wave Height:{" "}
                        {
                          sectorData.marine
                            .waveHeightMeters
                        }{" "}
                        m)
                      </div>

                      <div className="directive-item">
                        <strong>
                          Wind:
                        </strong>{" "}
                        {
                          sectorData.marine
                            .windSpeedKnots
                        }{" "}
                        knots (Beaufort Scale{" "}
                        {
                          sectorData.marine
                            .windBeaufortScale
                        }
                        )
                      </div>
                    </div>
                  )}

                {/* Urban */}

                {activeSector ===
                  "urban" &&
                  sectorData.smartCity && (
                    <div>
                      <h4 className="advisory-title">
                        🏙️ Smart City
                        Weather & Heat
                        Island Monitoring
                      </h4>

                      <div className="directive-item">
                        <strong>
                          Flood /
                          Waterlogging Risk:
                        </strong>{" "}
                        {
                          sectorData
                            .smartCity
                            .waterloggingFloodRisk
                        }
                      </div>

                      <div className="directive-item">
                        <strong>
                          Heat Island Index:
                        </strong>{" "}
                        {
                          sectorData
                            .smartCity
                            .urbanHeatIslandIndex
                        }{" "}
                        (Heat Index:{" "}
                        {
                          sectorData
                            .smartCity
                            .outdoorWorkHeatIndex
                        }
                        °C)
                      </div>

                      <div className="directive-item">
                        <strong>
                          Outdoor Labor
                          Safety:
                        </strong>{" "}
                        {
                          sectorData
                            .smartCity
                            .outdoorLaborSafety
                        }
                      </div>

                      <div className="directive-item">
                        <strong>
                          Municipal Storm
                          Pumping:
                        </strong>{" "}
                        {
                          sectorData
                            .smartCity
                            .municipalPumpingAdvice
                        }
                      </div>
                    </div>
                  )}
              </div>
            ) : (
              <div className="loading-state">
                Loading sector advisories...
              </div>
            )}
          </div>
        )}

        {/* ALERTS */}

        {activeTab === "alerts" && (
          <div className="alerts-pane">
            <h3 className="section-title">
              🚨 IMD Extreme Weather
              Alerts & Early Warnings
            </h3>

            <p className="section-sub">
              Standardized MoES/IMD
              colour-coded warnings
              (Green, Yellow, Orange, Red).
            </p>

            {alertsData &&
            Array.isArray(
              alertsData.alerts
            ) ? (
              <div className="alerts-list">
                {alertsData.alerts.length ===
                0 ? (
                  <div className="green-alert-box">
                    <CheckCircle
                      size={32}
                      className="green-icon"
                    />

                    <h4>
                      🟢 IMD Green: Normal
                      Weather
                    </h4>

                    <p>
                      No severe weather
                      warnings active for{" "}
                      {currentCity}.
                      Standard
                      meteorological
                      conditions prevail.
                    </p>
                  </div>
                ) : (
                  alertsData.alerts.map(
                    (alert: any, index: number) => {
                      const severity =
                        String(
                          alert.severity ??
                            ""
                        ).toLowerCase();

                      return (
                        <div
                          key={
                            alert.id ??
                            `alert-${index}`
                          }
                          className={`alert-card ${severity}`}
                        >
                          <div className="alert-card-header">
                            <span className="alert-severity-badge">
                              {alert.severity ??
                                "Unknown"}
                            </span>

                            <span className="alert-type-badge">
                              {alert.alertType ??
                                "Weather Alert"}
                            </span>

                            <span className="info-class-badge">
                              {alert.informationClass ??
                                "Information"}
                            </span>
                          </div>

                          <h4 className="alert-card-title">
                            {alert.title ??
                              "Weather Alert"}
                          </h4>

                          <p className="alert-card-desc">
                            {alert.description ??
                              "No description available."}
                          </p>

                          <div className="alert-card-meta">
                            <span>
                              Source:{" "}
                              {alert.source ??
                                "Unknown"}
                            </span>
                          </div>
                        </div>
                      );
                    }
                  )
                )}
              </div>
            ) : (
              <div className="loading-state">
                Checking early warnings...
              </div>
            )}
          </div>
        )}

        {/* CLIMATE */}

        {activeTab === "climate" && (
          <div className="climate-pane">
            <h3 className="section-title">
              📈 10-Year Climate Trend
              Analytics
            </h3>

            <p className="section-sub">
              Decadal climate analytics over{" "}
              {currentCity} based on
              historical reanalysis records.
            </p>

            {climateData ? (
              <div className="climate-card">
                <div className="climate-stats-grid">
                  <div className="c-stat">
                    <span className="c-lbl">
                      Decadal Warming Rate
                    </span>

                    <span className="c-val hot">
                      +
                      {climateData.warmingRatePerDecade ??
                        "--"}
                      °C / dec
                    </span>
                  </div>

                  <div className="c-stat">
                    <span className="c-lbl">
                      Baseline Mean Temp
                    </span>

                    <span className="c-val">
                      {climateData.baselineMeanTemperature ??
                        "--"}
                      °C
                    </span>
                  </div>

                  <div className="c-stat">
                    <span className="c-lbl">
                      Annual Rain Baseline
                    </span>

                    <span className="c-val">
                      {climateData.baselineAnnualPrecipitation ??
                        "--"}{" "}
                      mm
                    </span>
                  </div>
                </div>

                <h4 className="trend-title">
                  Yearly Mean Temperature
                  Deviation
                </h4>

                <div className="trend-bars">
                  {Array.isArray(
                    climateData.yearlyMetrics
                  ) &&
                    climateData.yearlyMetrics.map(
                      (metric: any) => {
                        const anomaly = Number(
                          metric.tempAnomalyVsBaseline ??
                            0
                        );

                        const height = Math.min(
                          100,
                          Math.max(
                            20,
                            Math.abs(
                              anomaly * 40
                            )
                          )
                        );

                        return (
                          <div
                            key={metric.year}
                            className="year-bar-col"
                          >
                            <span className="bar-anomaly">
                              {anomaly > 0
                                ? `+${anomaly}`
                                : anomaly}
                              °
                            </span>

                            <div
                              className={`bar-fill ${
                                anomaly > 0
                                  ? "pos"
                                  : "neg"
                              }`}
                              style={{
                                height: `${height}px`,
                              }}
                            />

                            <span className="bar-year">
                              {String(
                                metric.year
                              ).substring(2)}
                            </span>
                          </div>
                        );
                      }
                    )}
                </div>

                <div className="climate-insights-box">
                  <h4>
                    Key Meteorological
                    Findings:
                  </h4>

                  <ul>
                    {Array.isArray(
                      climateData.climateInsights
                    ) &&
                      climateData.climateInsights.map(
                        (
                          insight: string,
                          index: number
                        ) => (
                          <li key={index}>
                            {insight}
                          </li>
                        )
                      )}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="loading-state">
                Loading climate analytics...
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}

      <div className="mobile-input-bar">
        <input
          ref={inputRef}
          type="text"
          className="mobile-input-field"
          placeholder={
            voiceStatus === "listening"
              ? `Listening in ${activeLangObj.label}...`
              : "Ask WeatherGPT (e.g. Sowing in Pune, Rain in Delhi)..."
          }
          value={input}
          onChange={(event) =>
            setInput(event.target.value)
          }
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey
            ) {
              event.preventDefault();
              handleSend();
            }
          }}
          disabled={isLoading}
          aria-label="Ask WeatherGPT"
        />

        <button
          type="button"
          className={`mobile-voice-btn ${
            voiceStatus === "listening"
              ? "pulsing"
              : ""
          }`}
          onClick={toggleListen}
          disabled={!voiceSupported || isLoading}
          title={
            voiceSupported
              ? "Speak in your language"
              : "Voice not supported in this browser"
          }
          aria-label="Voice input"
        >
          <Mic size={18} />
        </button>

        <button
          type="button"
          className="mobile-send-btn"
          onClick={() => handleSend()}
          disabled={
            !input.trim() || isLoading
          }
          title="Send message"
          aria-label="Send message"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

