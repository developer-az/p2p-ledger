package io.github.developeraz.ledger.api;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class CapabilitiesController {
    @GetMapping("/v1/capabilities")
    public Map<String, Object> capabilities() {
        return Map.of("product", "Settle", "workflows", 2, "spending", true, "accountProvisioning", true);
    }
}
