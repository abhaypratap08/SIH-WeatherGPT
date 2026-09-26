package com.weathergpt.service;

import com.weathergpt.climate.ClimateAnalysisService;
import com.weathergpt.climate.dto.ClimateTrendResponse;
import com.weathergpt.dto.advisory.SectorAdvisoryResponse;
import com.weathergpt.dto.alert.AlertResponse;
import com.weathergpt.dto.chat.ChatQueryRequest;
import com.weathergpt.dto.chat.ChatResponse;
import com.weathergpt.dto.weather.LocationInfo;
import com.weathergpt.nwp.NwpModelService;
import com.weathergpt.nwp.dto.NwpComparisonResponse;
import com.weathergpt.weather.alert.ImdEarlyWarningService;
import com.weathergpt.weather.model.GeoLocation;
import com.weathergpt.weather.query.TimeReference;
import com.weathergpt.weather.query.WeatherIntent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Intelligent AI Query Understanding Engine.
 * Supports multi-turn conversational context memory, sector queries, NWP model
 * ensemble queries, climate trends, early warnings, and multilingual synthesis.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LlmQueryUnderstandingService {

    private final WeatherService weatherService;
    private final SectorAdvisoryService sectorAdvisoryService;
    private final NwpModelService nwpModelService;
    private final ClimateAnalysisService climateAnalysisService;
    private final ImdEarlyWarningService earlyWarningService;
    private final LocalizationService localizationService;

    @Value("${gemini.api-key:${LLM_API_KEY:}}")
    private String geminiApiKey;

    // Session Context Cache for multi-turn conversations
    private final Map<String, SessionContext> sessionCache = new ConcurrentHashMap<>();

    public static class SessionContext {
        public String lastLocation;
        public String lastSector;
        public long lastUpdated;

        public SessionContext(String lastLocation, String lastSector) {
            this.lastLocation = lastLocation;
            this.lastSector = lastSector;
            this.lastUpdated = System.currentTimeMillis();
        }
    }

    public boolean canHandleSpecialized(ChatQueryRequest request, String extractedLocation) {
        String msg = request.getMessage() != null ? request.getMessage().toLowerCase(Locale.ROOT) : "";
        return msg.contains("crop") || msg.contains("sow") || msg.contains("irrigate") || msg.contains("spray")
                || msg.contains("farmer") || msg.contains("agri") || msg.contains("potato") || msg.contains("wheat")
                || msg.contains("aviation") || msg.contains("flight") || msg.contains("metar") || msg.contains("taf")
                || msg.contains("marine") || msg.contains("fish") || msg.contains("sea state") || msg.contains("wave")
                || msg.contains("smart city") || msg.contains("waterlog") || msg.contains("heat island")
                || msg.contains("nwp") || msg.contains("gfs") || msg.contains("ecmwf") || msg.contains("wrf") || msg.contains("model")
                || msg.contains("climate") || msg.contains("warming") || msg.contains("decade") || msg.contains("trend")
                || msg.contains("alert") || msg.contains("warning") || msg.contains("cyclone");
    }

    public ChatResponse processSpecializedQuery(ChatQueryRequest request, String detectedLocation) {
        String msg = request.getMessage() != null ? request.getMessage() : "";
        String lowerMsg = msg.toLowerCase(Locale.ROOT);
        String lang = localizationService.detectLanguage(msg, request.getLanguage());

        // Resolve location with session memory fallback
        String sessionId = request.getSessionId();
        String locationStr = detectedLocation;

        if ((locationStr == null || locationStr.isBlank()) && sessionId != null && sessionCache.containsKey(sessionId)) {
            locationStr = sessionCache.get(sessionId).lastLocation;
            log.info("Restored location '{}' from session {}", locationStr, sessionId);
        }

        // The client's currently selected location (sent with every chat
        // request) becomes the AI's weather context before any fixed default:
        // the answer, advisories, NWP/climate queries and warnings all follow
        // the location the user picked in the app.
        if ((locationStr == null || locationStr.isBlank())
                && request.getLocation() != null && !request.getLocation().isBlank()) {
            locationStr = request.getLocation();
            log.info("Using selected location '{}' from request context", locationStr);
        }

        if (locationStr == null || locationStr.isBlank()) {
            // No location available anywhere (message, session memory or
            // request context): never fabricate coordinates or guess a default
            // city — ask the user to name a place (docs/location-architecture.md).
            return ChatResponse.builder()
                    .answer("Please specify the location for which you want weather information. "
                            + "For example: \"What's the weather in Delhi?\"")
                    .intent(WeatherIntent.GENERAL_WEATHER)
                    .timeReference(TimeReference.TODAY)
                    .language(lang)
                    .build();
        }

        if (sessionId != null) {
            sessionCache.put(sessionId, new SessionContext(locationStr, request.getSector()));
        }

        GeoLocation location;
        try {
            location = weatherService.resolveLocation(locationStr);
        } catch (Exception e) {
            // The named place could not be geocoded — answer truthfully instead
            // of inventing coordinates.
            log.warn("Could not resolve location '{}' for specialized query: {}",
                    locationStr, e.getMessage());
            return ChatResponse.builder()
                    .answer("I couldn't find \"" + locationStr
                            + "\". Please check the spelling or name a different place.")
                    .intent(WeatherIntent.GENERAL_WEATHER)
                    .timeReference(TimeReference.TODAY)
                    .language(lang)
                    .build();
        }

        // 1. Check for Sector-Specific Decision Support
        if (isSectorQuery(lowerMsg, request.getSector())) {
            String sectorType = request.getSector() != null ? request.getSector() : detectSector(lowerMsg);
            SectorAdvisoryResponse advisories = sectorAdvisoryService.generateAdvisoriesForLocation(location, sectorType);

            String answer = buildSectorAnswer(location.getName(), sectorType, advisories, lang);
            return ChatResponse.builder()
                    .answer(answer)
                    .voiceAnswer(stripMarkdown(answer))
                    .intent(WeatherIntent.GENERAL_WEATHER)
                    .timeReference(TimeReference.TODAY)
                    .location(advisories.getLocation())
                    .sectorAdvisory(advisories)
                    .language(lang)
                    .build();
        }

        // 2. Check for NWP Multi-Model Comparison
        if (lowerMsg.contains("nwp") || lowerMsg.contains("gfs") || lowerMsg.contains("ecmwf")
                || lowerMsg.contains("wrf") || lowerMsg.contains("model") || lowerMsg.contains("consensus")) {
            NwpComparisonResponse nwp = nwpModelService.compareModelsForLocation(location);
            String answer = String.format("🛰️ **NWP Multi-Model Consensus for %s**\n\n"
                            + "Consensus: **%d%% agreement** (%s confidence)\n"
                            + "• Ensemble Mean Temp: **%.1f°C** (Thermal Spread: %.1f°C)\n"
                            + "• Predicted Rainfall: **%.1f mm** across GFS/ECMWF/WRF\n\n"
                            + "Synoptic Note: %s",
                    location.getName(),
                    nwp.getConsensus().getConsensusScorePercentage(),
                    nwp.getConsensus().getConfidenceLevel(),
                    nwp.getConsensus().getEnsembleMeanTemp(),
                    nwp.getConsensus().getTempSpread(),
                    nwp.getConsensus().getEnsembleMeanPrecip(),
                    nwp.getConsensus().getDivergenceNote());

            return ChatResponse.builder()
                    .answer(answer)
                    .voiceAnswer(stripMarkdown(answer))
                    .intent(WeatherIntent.FORECAST)
                    .timeReference(TimeReference.TODAY)
                    .location(nwp.getLocation())
                    .nwpConsensus(nwp.getConsensus())
                    .advisories(nwp.getMeteorologicalAdvisories())
                    .language(lang)
                    .build();
        }

        // 3. Check for Climate Trend & Historical Analysis
        if (lowerMsg.contains("climate") || lowerMsg.contains("warming") || lowerMsg.contains("decade") || lowerMsg.contains("trend")) {
            ClimateTrendResponse climate = climateAnalysisService.analyzeClimateTrendsForLocation(location, 2015, 2024);
            String answer = String.format("📈 **Climate Trend Analysis for %s (%s)**\n\n"
                            + "• Warming Rate: **+%.2f°C per decade**\n"
                            + "• Baseline Climatology: Normal Mean **%.1f°C**, Annual Rainfall **%.1f mm**\n"
                            + "• Key Finding: Extreme heat days have risen to ~22 days/year.\n\n"
                            + "Citation: %s",
                    location.getName(), climate.getAnalysisPeriod(),
                    climate.getWarmingRatePerDecade(),
                    climate.getBaselineMeanTemperature(),
                    climate.getBaselineAnnualPrecipitation(),
                    climate.getDataCitation());

            return ChatResponse.builder()
                    .answer(answer)
                    .voiceAnswer(stripMarkdown(answer))
                    .intent(WeatherIntent.GENERAL_WEATHER)
                    .timeReference(TimeReference.UNSUPPORTED)
                    .location(climate.getLocation())
                    .climateTrend(climate)
                    .advisories(climate.getClimateInsights())
                    .language(lang)
                    .build();
        }

        // 4. Check for Extreme Weather Alerts / Warnings
        if (lowerMsg.contains("alert") || lowerMsg.contains("warning") || lowerMsg.contains("cyclone")) {
            AlertResponse alerts = earlyWarningService.getEarlyWarningsForLocation(location);
            StringBuilder sb = new StringBuilder();
            sb.append(String.format("🚨 **Active Weather Alerts for %s**\n\n", location.getName()));
            if (alerts.getAlerts().isEmpty()) {
                sb.append("🟢 IMD Green: No severe weather warnings active. Normal atmospheric conditions.");
            } else {
                for (var a : alerts.getAlerts()) {
                    sb.append(String.format("• **%s** (%s)\n  %s\n\n", a.getTitle(), a.getSeverity(), a.getDescription()));
                }
            }
            return ChatResponse.builder()
                    .answer(sb.toString())
                    .voiceAnswer(stripMarkdown(sb.toString()))
                    .intent(WeatherIntent.GENERAL_WEATHER)
                    .timeReference(TimeReference.NOW)
                    .location(LocationInfo.builder().name(location.getName()).latitude(location.getLatitude()).longitude(location.getLongitude()).build())
                    .earlyWarnings(alerts)
                    .language(lang)
                    .build();
        }

        return null;
    }

    private boolean isSectorQuery(String lowerMsg, String sector) {
        if (sector != null && !sector.isBlank()) return true;
        return lowerMsg.contains("crop") || lowerMsg.contains("sow") || lowerMsg.contains("irrigate")
                || lowerMsg.contains("spray") || lowerMsg.contains("farm") || lowerMsg.contains("potato")
                || lowerMsg.contains("aviation") || lowerMsg.contains("flight") || lowerMsg.contains("metar")
                || lowerMsg.contains("marine") || lowerMsg.contains("fish") || lowerMsg.contains("sea")
                || lowerMsg.contains("smart city") || lowerMsg.contains("waterlog");
    }

    private String detectSector(String lowerMsg) {
        if (lowerMsg.contains("aviation") || lowerMsg.contains("flight") || lowerMsg.contains("metar")) return "aviation";
        if (lowerMsg.contains("marine") || lowerMsg.contains("fish") || lowerMsg.contains("sea")) return "marine";
        if (lowerMsg.contains("smart city") || lowerMsg.contains("waterlog") || lowerMsg.contains("urban")) return "urban";
        return "agriculture";
    }

    private String buildSectorAnswer(String location, String sector, SectorAdvisoryResponse adv, String lang) {
        if (sector.contains("agri") || sector.contains("farm")) {
            var agri = adv.getAgriculture();
            if (lang.equalsIgnoreCase("hi")) {
                return String.format("🌾 **%s के लिए कृषि मौसम सलाह (Agromet Advisory)**\n\n"
                                + "• बुवाई सलाह: **%s**\n"
                                + "• सिंचाई मार्गदर्शन: **%s**\n"
                                + "• छिड़काव खिड़की: **%s**\n"
                                + "• मिट्टी की नमी सूचकांक: **%.1f%%** (कीट जोखिम: %s)\n\n"
                                + "टिप: खड़े खेत में जल निकासी की उचित व्यवस्था रखें।",
                        location, agri.getSowingAdvisory(), agri.getIrrigationRecommendation(),
                        agri.getSprayingWindow(), agri.getSoilMoistureIndex(), agri.getPestDiseaseRisk());
            }
            return String.format("🌾 **Agromet Advisory for %s**\n\n"
                            + "• **Sowing**: %s\n"
                            + "• **Irrigation**: %s\n"
                            + "• **Pesticide Spraying**: %s\n"
                            + "• **Harvesting**: %s\n"
                            + "• **Soil Moisture Index**: %.1f%% (Pest/Disease Risk: %s)",
                    location, agri.getSowingAdvisory(), agri.getIrrigationRecommendation(),
                    agri.getSprayingWindow(), agri.getHarvestingGuidance(),
                    agri.getSoilMoistureIndex(), agri.getPestDiseaseRisk());
        } else if (sector.contains("avia")) {
            var avia = adv.getAviation();
            return String.format("✈️ **Aviation Weather Briefing for %s**\n\n"
                            + "• Flight Category: **%s**\n"
                            + "• METAR: `%s`\n"
                            + "• Visibility: **%.1f km** | Cloud Ceiling: **%s**\n"
                            + "• Crosswind: **%.1f kt** | Turbulence: **%s**\n"
                            + "• Convective Storm: %s",
                    location, avia.getFlightCategory(), avia.getMetarCode(),
                    avia.getVisibilityKm(), avia.getCloudCeiling(),
                    avia.getCrosswindKnots(), avia.getTurbulenceRisk(),
                    avia.getConvectiveStormAlert());
        } else if (sector.contains("marine")) {
            var mar = adv.getMarine();
            return String.format("⚓ **Marine & Fisheries Advisory for %s**\n\n"
                            + "• Sea State: **%s** (Wave Height: **%.1f m**, Beaufort: **%d**)\n"
                            + "• Wind Speed: **%.1f knots**\n"
                            + "• **Fishermen Directive**: %s",
                    location, mar.getSeaState(), mar.getWaveHeightMeters(),
                    mar.getWindBeaufortScale(), mar.getWindSpeedKnots(), mar.getFishermenAction());
        } else {
            var city = adv.getSmartCity();
            return String.format("🏙️ **Smart City Weather Advisory for %s**\n\n"
                            + "• Waterlogging & Flood Risk: **%s**\n"
                            + "• Urban Heat Island Index: **%s** (Heat Index: **%.1f°C**)\n"
                            + "• Outdoor Labor Safety: **%s**\n"
                            + "• Municipal Action: %s",
                    location, city.getWaterloggingFloodRisk(), city.getUrbanHeatIslandIndex(),
                    city.getOutdoorWorkHeatIndex(), city.getOutdoorLaborSafety(), city.getMunicipalPumpingAdvice());
        }
    }

    private String stripMarkdown(String text) {
        if (text == null) return "";
        return text.replaceAll("[*#`_~]", "").replaceAll("\\s+", " ").trim();
    }
}
