package com.weathergpt;

import com.weathergpt.dto.alert.AlertResponse;
import com.weathergpt.dto.weather.CurrentWeatherResponse;
import com.weathergpt.dto.weather.ForecastDay;
import com.weathergpt.dto.weather.ForecastResponse;
import com.weathergpt.service.WeatherService;
import com.weathergpt.weather.alert.AlertInformationClass;
import com.weathergpt.weather.alert.AlertSeverity;
import com.weathergpt.weather.alert.AlertType;
import com.weathergpt.weather.alert.ImdEarlyWarningService;
import com.weathergpt.weather.model.GeoLocation;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;

@ExtendWith(MockitoExtension.class)
class ImdEarlyWarningServiceTest {

    @Mock
    private WeatherService weatherService;

    @InjectMocks
    private ImdEarlyWarningService earlyWarningService;

    private static final GeoLocation MUMBAI = GeoLocation.builder()
            .name("Mumbai")
            .latitude(19.07)
            .longitude(72.87)
            .country("India")
            .timezone("Asia/Kolkata")
            .build();

    @BeforeEach
    void setUp() {
        given(weatherService.resolveLocation("Mumbai")).willReturn(MUMBAI);
    }

    @Test
    @DisplayName("Generates Orange Alert when heavy rainfall exceeds 64.5mm threshold")
    void heavyRainfall_generatesOrangeAlert() {
        given(weatherService.getCurrentWeather(MUMBAI)).willReturn(
                CurrentWeatherResponse.builder().temperature(28.0).windSpeed(15.0).weatherCode(65).build());
        given(weatherService.getForecast(eq(MUMBAI), anyInt())).willReturn(
                ForecastResponse.builder().days(List.of(
                        ForecastDay.builder().date("2026-09-08").precipitationSum(85.0).build()
                )).build());

        AlertResponse response = earlyWarningService.getEarlyWarnings("Mumbai");

        assertThat(response).isNotNull();
        assertThat(response.getAlerts()).isNotEmpty();
        assertThat(response.getAlerts()).anyMatch(a ->
                a.getSeverity() == AlertSeverity.SEVERE &&
                a.getAlertType() == AlertType.HEAVY_RAIN &&
                a.getInformationClass() == AlertInformationClass.AUTOMATED_ADVISORY);
    }

    @Test
    @DisplayName("Generates Heatwave warning when temperature exceeds 40°C")
    void heatwave_generatesWarning() {
        given(weatherService.getCurrentWeather(MUMBAI)).willReturn(
                CurrentWeatherResponse.builder().temperature(42.5).windSpeed(10.0).weatherCode(0).build());
        given(weatherService.getForecast(eq(MUMBAI), anyInt())).willReturn(
                ForecastResponse.builder().days(List.of(
                        ForecastDay.builder().date("2026-09-08").precipitationSum(0.0).build()
                )).build());

        AlertResponse response = earlyWarningService.getEarlyWarnings("Mumbai");

        assertThat(response.getAlerts()).anyMatch(a ->
                a.getAlertType() == AlertType.HEATWAVE &&
                a.getSeverity() == AlertSeverity.SEVERE);
    }
}
