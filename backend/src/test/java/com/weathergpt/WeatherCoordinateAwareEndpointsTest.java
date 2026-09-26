package com.weathergpt;

import com.weathergpt.climate.ClimateAnalysisService;
import com.weathergpt.nwp.NwpModelService;
import com.weathergpt.weather.alert.ImdEarlyWarningService;
import com.weathergpt.weather.model.GeoLocation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Coordinate-aware handling for the remaining weather endpoints that the main
 * UI drives with the canonical location: IMD early warnings, NWP comparisons
 * and climate trends. In all three the coordinates are authoritative and the
 * display label is never geocoded.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:testdb_coord_endpoints",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "jwt.secret=dGVzdC1zZWNyZXQtdGVzdC1zZWNyZXQtdGVzdC1zZWNyZXQtdGVzdC1zZWNyZXQ="
})
class WeatherCoordinateAwareEndpointsTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ImdEarlyWarningService earlyWarningService;

    @MockBean
    private NwpModelService nwpModelService;

    @MockBean
    private ClimateAnalysisService climateAnalysisService;

    @Test
    @DisplayName("IMD early warnings accept coordinates and bypass geocoding")
    void earlyWarningsByCoordinates() throws Exception {
        mockMvc.perform(get("/api/alerts/early-warnings")
                        .param("latitude", "28.6139")
                        .param("longitude", "77.2090")
                        .param("name", "16th Park View(GYC)"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.message").value("IMD early warnings retrieved"));

        ArgumentCaptor<GeoLocation> captor = ArgumentCaptor.forClass(GeoLocation.class);
        verify(earlyWarningService).getEarlyWarningsForLocation(captor.capture());
        verify(earlyWarningService, never()).getEarlyWarnings(anyString());
        assertThat(captor.getValue().getLatitude()).isEqualTo(28.6139);
        assertThat(captor.getValue().getLongitude()).isEqualTo(77.2090);
        assertThat(captor.getValue().getName()).isEqualTo("16th Park View(GYC)");
    }

    @Test
    @DisplayName("NWP comparison accepts coordinates and bypasses geocoding")
    void nwpByCoordinates() throws Exception {
        mockMvc.perform(get("/api/weather/nwp")
                        .param("latitude", "28.6139")
                        .param("longitude", "77.2090")
                        .param("name", "Selected point"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.message").value("NWP multi-model comparison retrieved"));

        ArgumentCaptor<GeoLocation> captor = ArgumentCaptor.forClass(GeoLocation.class);
        verify(nwpModelService).compareModelsForLocation(captor.capture());
        verify(nwpModelService, never()).compareModels(anyString());
        assertThat(captor.getValue().getLatitude()).isEqualTo(28.6139);
        assertThat(captor.getValue().getName()).isEqualTo("Selected point");
    }

    @Test
    @DisplayName("Climate trends accept coordinates and bypass geocoding")
    void climateByCoordinates() throws Exception {
        mockMvc.perform(get("/api/weather/climate")
                        .param("latitude", "28.6139")
                        .param("longitude", "77.2090")
                        .param("name", "Delhi")
                        .param("startYear", "2015")
                        .param("endYear", "2024"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.message").value("Climate trends retrieved"));

        ArgumentCaptor<GeoLocation> captor = ArgumentCaptor.forClass(GeoLocation.class);
        verify(climateAnalysisService).analyzeClimateTrendsForLocation(captor.capture(), anyInt(), anyInt());
        verify(climateAnalysisService, never()).analyzeClimateTrends(anyString(), any(), any());
        assertThat(captor.getValue().getLatitude()).isEqualTo(28.6139);
        assertThat(captor.getValue().getName()).isEqualTo("Delhi");
    }
}