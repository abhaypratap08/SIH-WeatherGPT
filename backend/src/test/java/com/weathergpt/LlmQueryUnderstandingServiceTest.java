package com.weathergpt;

import com.weathergpt.climate.ClimateAnalysisService;
import com.weathergpt.dto.alert.AlertResponse;
import com.weathergpt.dto.chat.ChatQueryRequest;
import com.weathergpt.dto.chat.ChatResponse;
import com.weathergpt.nwp.NwpModelService;
import com.weathergpt.service.LlmQueryUnderstandingService;
import com.weathergpt.service.LocalizationService;
import com.weathergpt.service.SectorAdvisoryService;
import com.weathergpt.service.WeatherService;
import com.weathergpt.weather.alert.ImdEarlyWarningService;
import com.weathergpt.weather.model.GeoLocation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The AI assistant must answer with the user's currently selected location as
 * context (global location architecture, §19): when the query doesn't name a
 * place, the selected location from the request is used; a location named in
 * the message still wins. When NO location exists anywhere, the service asks
 * the user to specify one — it never fabricates coordinates or a default city.
 */
@ExtendWith(MockitoExtension.class)
class LlmQueryUnderstandingServiceTest {

    @Mock
    private WeatherService weatherService;
    @Mock
    private SectorAdvisoryService sectorAdvisoryService;
    @Mock
    private NwpModelService nwpModelService;
    @Mock
    private ClimateAnalysisService climateAnalysisService;
    @Mock
    private ImdEarlyWarningService earlyWarningService;
    @Mock
    private LocalizationService localizationService;

    private LlmQueryUnderstandingService service() {
        return new LlmQueryUnderstandingService(
                weatherService, sectorAdvisoryService, nwpModelService,
                climateAnalysisService, earlyWarningService, localizationService);
    }

    @Test
    @DisplayName("Selected location from the request is used as AI context when the message names no place")
    void usesRequestLocationAsAIContext() {
        when(localizationService.detectLanguage(anyString(), any())).thenReturn("en");
        GeoLocation noida = GeoLocation.builder()
                .name("Noida").latitude(28.57).longitude(77.32).country("India").build();
        when(weatherService.resolveLocation("Noida")).thenReturn(noida);
        when(earlyWarningService.getEarlyWarningsForLocation(any(GeoLocation.class)))
                .thenReturn(AlertResponse.builder().alerts(List.of()).build());

        ChatQueryRequest request = ChatQueryRequest.builder()
                .message("Is there an active warning for my district?")
                .location("Noida")
                .sessionId("locus-request-fallback-test")
                .build();

        ChatResponse response = service().processSpecializedQuery(request, null);

        assertThat(response).isNotNull();
        assertThat(response.getLocation()).isNotNull();
        assertThat(response.getLocation().getName()).isEqualTo("Noida");
        // The AI resolved the request's selected location, not any default.
        verify(weatherService).resolveLocation("Noida");
        verify(earlyWarningService).getEarlyWarningsForLocation(noida);
    }

    @Test
    @DisplayName("No location anywhere asks the user to specify one instead of defaulting to a city")
    void noLocationAsksForLocationInsteadOfDefaulting() {
        when(localizationService.detectLanguage(anyString(), any())).thenReturn("en");

        ChatQueryRequest request = ChatQueryRequest.builder()
                .message("Is there an active warning for my district?")
                .sessionId("locus-no-location-test")
                .build();

        ChatResponse response = service().processSpecializedQuery(request, null);

        assertThat(response).isNotNull();
        assertThat(response.getAnswer()).containsIgnoringCase("Please specify the location");
        // No coordinate fabrication and no provider query when there is no
        // location: neither the resolver nor a weather provider is touched.
        verify(weatherService, never()).resolveLocation(anyString());
        verify(earlyWarningService, never()).getEarlyWarningsForLocation(any(GeoLocation.class));
    }

    @Test
    @DisplayName("An unresolvable location answers truthfully instead of fabricating coordinates")
    void unresolvableLocationAnswersTruthfully() {
        when(localizationService.detectLanguage(anyString(), any())).thenReturn("en");
        when(weatherService.resolveLocation("Atlantis")).thenThrow(new RuntimeException("boom"));

        ChatQueryRequest request = ChatQueryRequest.builder()
                .message("Is there an active warning for Atlantis?")
                .build();

        ChatResponse response = service().processSpecializedQuery(request, "Atlantis");

        assertThat(response).isNotNull();
        assertThat(response.getAnswer()).contains("couldn't find");
        verify(earlyWarningService, never()).getEarlyWarningsForLocation(any(GeoLocation.class));
    }

    @Test
    @DisplayName("A location named in the message still wins over the selected-location context")
    void messageLocationWinsOverRequestContext() {
        when(localizationService.detectLanguage(anyString(), any())).thenReturn("en");
        GeoLocation mumbai = GeoLocation.builder()
                .name("Mumbai").latitude(19.07).longitude(72.87).country("India").build();
        when(weatherService.resolveLocation("Mumbai")).thenReturn(mumbai);
        when(earlyWarningService.getEarlyWarningsForLocation(any(GeoLocation.class)))
                .thenReturn(AlertResponse.builder().alerts(List.of()).build());

        ChatQueryRequest request = ChatQueryRequest.builder()
                .message("Is there an active warning for Mumbai?")
                .location("Noida")
                .sessionId("locus-message-wins-test")
                .build();

        ChatResponse response = service().processSpecializedQuery(request, "Mumbai");

        assertThat(response).isNotNull();
        assertThat(response.getLocation().getName()).isEqualTo("Mumbai");
        verify(weatherService).resolveLocation("Mumbai");
    }

    @Test
    @DisplayName("Session memory still restores the last location before the request context")
    void sessionMemoryWinsOverRequestContext() {
        when(localizationService.detectLanguage(anyString(), any())).thenReturn("en");
        GeoLocation pune = GeoLocation.builder()
                .name("Pune").latitude(18.52).longitude(73.85).country("India").build();
        when(weatherService.resolveLocation("Pune")).thenReturn(pune);
        when(earlyWarningService.getEarlyWarningsForLocation(any(GeoLocation.class)))
                .thenReturn(AlertResponse.builder().alerts(List.of()).build());

        // One service instance: the session cache lives on the instance.
        LlmQueryUnderstandingService svc = service();

        // First turn establishes Pune in session memory for this session.
        svc.processSpecializedQuery(
                ChatQueryRequest.builder()
                        .message("Is there an active warning for Pune?")
                        .sessionId("locus-session-test")
                        .build(),
                "Pune");

        // Second turn: no location in the message, no detected location — the
        // session memory (Pune) is restored even though the request sends a
        // different selected location (Noida).
        ChatResponse response = svc.processSpecializedQuery(
                ChatQueryRequest.builder()
                        .message("Any active warning for tomorrow?")
                        .location("Noida")
                        .sessionId("locus-session-test")
                        .build(),
                null);

        assertThat(response).isNotNull();
        assertThat(response.getLocation().getName()).isEqualTo("Pune");
        // Resolved on both turns (message turn + restored-memory turn).
        verify(weatherService, org.mockito.Mockito.times(2)).resolveLocation("Pune");
    }
}