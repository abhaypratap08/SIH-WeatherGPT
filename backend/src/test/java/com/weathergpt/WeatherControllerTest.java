package com.weathergpt;

import com.weathergpt.dto.weather.CurrentWeatherResponse;
import com.weathergpt.dto.weather.ForecastResponse;
import com.weathergpt.dto.weather.LocationInfo;
import com.weathergpt.exception.ResourceNotFoundException;
import com.weathergpt.exception.WeatherProviderException;
import com.weathergpt.service.WeatherService;
import com.weathergpt.weather.model.GeoLocation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:testdb_weather_controller",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "jwt.secret=dGVzdC1zZWNyZXQtdGVzdC1zZWNyZXQtdGVzdC1zZWNyZXQtdGVzdC1zZWNyZXQ="
})
class WeatherControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private WeatherService weatherService;

    private CurrentWeatherResponse currentWeatherFixture() {
        return CurrentWeatherResponse.builder()
                .location(LocationInfo.builder()
                        .name("Delhi").latitude(28.65195).longitude(77.23149)
                        .country("India").timezone("Asia/Kolkata").build())
                .temperature(27.9)
                .humidity(62)
                .weatherCode(2)
                .weatherDescription("Partly cloudy")
                .provider("Open-Meteo")
                .build();
    }

    private ForecastResponse forecastFixture() {
        return ForecastResponse.builder()
                .location(LocationInfo.builder().name("Delhi").latitude(28.65195).longitude(77.23149).build())
                .timezone("Asia/Kolkata")
                .provider("Open-Meteo")
                .days(List.of())
                .build();
    }

    @Test
    @DisplayName("Current weather for valid location returns normalized response without auth")
    void currentWeatherValidLocationIsPublic() throws Exception {
        when(weatherService.getCurrentWeather("Delhi")).thenReturn(currentWeatherFixture());

        mockMvc.perform(get("/api/weather/current").param("location", "Delhi"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.message").value("Current weather retrieved"))
                .andExpect(jsonPath("$.data.location.name").value("Delhi"))
                .andExpect(jsonPath("$.data.temperature").value(27.9))
                .andExpect(jsonPath("$.data.weatherDescription").value("Partly cloudy"))
                .andExpect(jsonPath("$.data.provider").value("Open-Meteo"));
    }

    @Test
    @DisplayName("Forecast for valid location returns normalized response")
    void forecastValidLocation() throws Exception {
        when(weatherService.getForecast("Delhi", 7)).thenReturn(forecastFixture());

        mockMvc.perform(get("/api/weather/forecast").param("location", "Delhi"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.message").value("Weather forecast retrieved"))
                .andExpect(jsonPath("$.data.location.name").value("Delhi"))
                .andExpect(jsonPath("$.data.days").isArray());
    }

    @Test
    @DisplayName("Forecast clamps days to the allowed range")
    void forecastDaysClamped() throws Exception {
        when(weatherService.getForecast("Delhi", 16)).thenReturn(forecastFixture());
        mockMvc.perform(get("/api/weather/forecast").param("location", "Delhi").param("days", "100"))
                .andExpect(status().isOk());
        verify(weatherService).getForecast(eq("Delhi"), eq(16));

        when(weatherService.getForecast("Delhi", 1)).thenReturn(forecastFixture());
        mockMvc.perform(get("/api/weather/forecast").param("location", "Delhi").param("days", "0"))
                .andExpect(status().isOk());
        verify(weatherService).getForecast(eq("Delhi"), eq(1));

        when(weatherService.getForecast("Delhi", 5)).thenReturn(forecastFixture());
        mockMvc.perform(get("/api/weather/forecast").param("location", "Delhi").param("days", "5"))
                .andExpect(status().isOk());
        verify(weatherService).getForecast(eq("Delhi"), eq(5));
    }

    @Test
    @DisplayName("Missing location returns 400 validation error")
    void missingLocationReturns400() throws Exception {
        mockMvc.perform(get("/api/weather/current"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("Location is required"));

        mockMvc.perform(get("/api/weather/forecast").param("location", "  "))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("Location is required"));
    }

    @Test
    @DisplayName("Invalid days parameter returns 400")
    void invalidDaysParamReturns400() throws Exception {
        mockMvc.perform(get("/api/weather/forecast").param("location", "Delhi").param("days", "abc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    @DisplayName("Unknown location returns 404 controlled error")
    void unknownLocationReturns404() throws Exception {
        when(weatherService.getCurrentWeather("InvalidFakeLocationXYZ"))
                .thenThrow(new ResourceNotFoundException("Location not found: InvalidFakeLocationXYZ"));

        mockMvc.perform(get("/api/weather/current").param("location", "InvalidFakeLocationXYZ"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("Location not found: InvalidFakeLocationXYZ"));
    }

    @Test
    @DisplayName("Weather provider failure returns 503 controlled error")
    void providerFailureReturns503() throws Exception {
        when(weatherService.getCurrentWeather("Delhi"))
                .thenThrow(new WeatherProviderException("Weather service is temporarily unavailable. Please try again later."));

        mockMvc.perform(get("/api/weather/current").param("location", "Delhi"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("Weather service is temporarily unavailable. Please try again later."));
    }

    @Test
    @DisplayName("Forecast by coordinates bypasses geocoding, so a non-geocodable display label works")
    void forecastByCoordinatesBypassesGeocoding() throws Exception {
        when(weatherService.getForecast(any(GeoLocation.class), eq(7))).thenReturn(forecastFixture());

        mockMvc.perform(get("/api/weather/forecast")
                        .param("latitude", "28.6500")
                        .param("longitude", "77.2300")
                        .param("name", "16th Park View(GYC)")
                        .param("days", "7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.message").value("Weather forecast retrieved"))
                .andExpect(jsonPath("$.data.days").isArray());

        ArgumentCaptor<GeoLocation> captor = ArgumentCaptor.forClass(GeoLocation.class);
        verify(weatherService).getForecast(captor.capture(), eq(7));
        // The authoritative query must be the coordinates; the display label is
        // never fed to the geocoder.
        verify(weatherService, never()).resolveLocation(anyString());
        assertThat(captor.getValue().getLatitude()).isEqualTo(28.65);
        assertThat(captor.getValue().getLongitude()).isEqualTo(77.23);
        assertThat(captor.getValue().getName()).isEqualTo("16th Park View(GYC)");
    }

    @Test
    @DisplayName("Current weather by coordinates works without geocoding")
    void currentWeatherByCoordinates() throws Exception {
        when(weatherService.getCurrentWeather(any(GeoLocation.class))).thenReturn(currentWeatherFixture());

        mockMvc.perform(get("/api/weather/current")
                        .param("latitude", "28.65195")
                        .param("longitude", "77.23149")
                        .param("name", "Selected point"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.message").value("Current weather retrieved"));

        ArgumentCaptor<GeoLocation> captor = ArgumentCaptor.forClass(GeoLocation.class);
        verify(weatherService).getCurrentWeather(captor.capture());
        verify(weatherService, never()).resolveLocation(anyString());
        assertThat(captor.getValue().getLatitude()).isEqualTo(28.65195);
        assertThat(captor.getValue().getLongitude()).isEqualTo(77.23149);
        assertThat(captor.getValue().getName()).isEqualTo("Selected point");
    }

    @Test
    @DisplayName("Out-of-range coordinates are rejected with 400")
    void invalidCoordinatesRejected() throws Exception {
        mockMvc.perform(get("/api/weather/forecast")
                        .param("latitude", "95")
                        .param("longitude", "77.23"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value(containsString("Invalid coordinates")));

        mockMvc.perform(get("/api/weather/current")
                        .param("latitude", "28.65")
                        .param("longitude", "181"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value(containsString("Invalid coordinates")));
    }

    @Test
    @DisplayName("Only one coordinate supplied falls back to location-string validation")
    void partialCoordinatesRequireLocation() throws Exception {
        mockMvc.perform(get("/api/weather/forecast").param("latitude", "28.65"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("Location is required"));
    }

    @Test
    @DisplayName("Existing ?location= forecast request stays on the string (geocoding) path")
    void stringLocationForecastCompatibility() throws Exception {
        when(weatherService.getForecast("Delhi", 7)).thenReturn(forecastFixture());

        mockMvc.perform(get("/api/weather/forecast").param("location", "Delhi").param("days", "7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.location.name").value("Delhi"));

        verify(weatherService).getForecast(eq("Delhi"), eq(7));
        verify(weatherService, never()).getForecast(any(GeoLocation.class), anyInt());
    }
}