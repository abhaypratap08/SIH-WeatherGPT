package com.weathergpt;

import com.weathergpt.dto.weather.ForecastResponse;
import com.weathergpt.dto.weather.LocationInfo;
import com.weathergpt.service.WeatherService;
import jakarta.servlet.Filter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Focused regression test for the production CORS fix.
 *
 * <p>The deployed frontend origin is {@code https://weathergpt-zet.vercel.app};
 * the previous config only allowed {@code https://sih-weather-gpt.vercel.app/}
 * (wrong hostname, trailing slash), so the browser blocked every response with
 * "NetworkError when attempting to fetch resource.".
 *
 * <p>Two layers are covered:
 * <ul>
 *   <li>the {@link CorsConfigurationSource} bean itself (origins normalized,
 *       prod + localhost present, unsupported origins rejected);</li>
 *   <li>the real request path — the Spring Security filter chain (including the
 *       CorsFilter registered by {@code .cors()}) is wired into MockMvc so the
 *       Access-Control-Allow-Origin header is verified end-to-end for normal GET
 *       requests and OPTIONS preflights.</li>
 * </ul>
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:testdb_cors",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "jwt.secret=dGVzdC1zZWNyZXQtdGVzdC1zZWNyZXQtdGVzdC1zZWNyZXQtdGVzdC1zZWNyZXQ="
})
class CorsConfigurationTest {

    /** The actual deployed production frontend origin. */
    private static final String PRODUCTION_ORIGIN = "https://weathergpt-zet.vercel.app";

    /** Legacy Vercel hostname kept as an intentionally supported deployment. */
    private static final String LEGACY_PRODUCTION_ORIGIN = "https://sih-weather-gpt.vercel.app";

    private static final String UNSUPPORTED_ORIGIN = "https://evil.example.com";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    @Qualifier("springSecurityFilterChain")
    private Filter springSecurityFilterChain;

    @Autowired
    private CorsConfigurationSource corsConfigurationSource;

    @MockBean
    private WeatherService weatherService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        // Wire the real Spring Security filter chain — including the CorsFilter
        // added by .cors() — into MockMvc so CORS behavior is exercised on the
        // same request path the browser uses.
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(springSecurityFilterChain)
                .build();

        when(weatherService.getForecast("Delhi", 7)).thenReturn(ForecastResponse.builder()
                .location(LocationInfo.builder().name("Delhi").latitude(28.65195).longitude(77.23149).build())
                .days(List.of())
                .build());
    }

    @Test
    @DisplayName("Configured origins are normalized (no trailing slash) and include prod + localhost")
    void configuredOriginsAreNormalizedOnTheSource() {
        CorsConfiguration config = corsConfigurationSource.getCorsConfiguration(
                new MockHttpServletRequest("GET", "/api/weather/forecast"));

        assertThat(config).isNotNull();
        assertThat(config.getAllowedOrigins())
                .contains(PRODUCTION_ORIGIN)
                .contains(LEGACY_PRODUCTION_ORIGIN)
                .doesNotContain(LEGACY_PRODUCTION_ORIGIN + "/")
                .contains("http://localhost:5173", "http://localhost:3000")
                .doesNotContain("*");

        // Exact matching: an origin outside the allow-list must never be echoed.
        assertThat(config.checkOrigin(UNSUPPORTED_ORIGIN)).isNull();
    }

    @Test
    @DisplayName("GET from the deployed production origin receives Access-Control-Allow-Origin")
    void allowedProductionOriginGetsAcaoHeader() throws Exception {
        mockMvc.perform(get("/api/weather/forecast")
                        .param("location", "Delhi")
                        .header("Origin", PRODUCTION_ORIGIN))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", PRODUCTION_ORIGIN))
                .andExpect(header().string("Access-Control-Allow-Credentials", "true"));
    }

    @Test
    @DisplayName("GET from the legacy hostname still works (configured trailing slash is normalized)")
    void legacyProductionOriginGetsAcaoHeader() throws Exception {
        mockMvc.perform(get("/api/weather/forecast")
                        .param("location", "Delhi")
                        .header("Origin", LEGACY_PRODUCTION_ORIGIN))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", LEGACY_PRODUCTION_ORIGIN));
    }

    @Test
    @DisplayName("GET from an unsupported origin is rejected with 403 and no Access-Control-Allow-Origin")
    void unsupportedOriginDoesNotGetAcaoPermission() throws Exception {
        mockMvc.perform(get("/api/weather/forecast")
                        .param("location", "Delhi")
                        .header("Origin", UNSUPPORTED_ORIGIN))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    @DisplayName("OPTIONS preflight from the production origin is allowed")
    void preflightFromAllowedOriginIsAccepted() throws Exception {
        mockMvc.perform(options("/api/weather/forecast")
                        .header("Origin", PRODUCTION_ORIGIN)
                        .header("Access-Control-Request-Method", "GET")
                        .header("Access-Control-Request-Headers", "Content-Type"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", PRODUCTION_ORIGIN))
                .andExpect(header().string("Access-Control-Allow-Methods", containsString("GET")))
                .andExpect(header().string("Access-Control-Allow-Credentials", "true"));
    }
}