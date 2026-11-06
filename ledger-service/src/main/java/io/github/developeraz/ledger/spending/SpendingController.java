package io.github.developeraz.ledger.spending;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/accounts/{account}/spends")
@Validated
public class SpendingController {
    private final SpendingService service;
    public SpendingController(SpendingService service) { this.service=service; }
    public record Input(@Positive @Max(9007199254740991L) long amountMinor, @NotNull String category,
                        @Size(max=140) String note, Instant occurredAt, String source, String currency) { }
    public record Csv(@NotBlank @Size(max=1000000) String csv, @Size(max=64) String timeZone) { }
    @PostMapping
    public SpendLog record(@PathVariable UUID account, @Valid @RequestBody Input input,
            @RequestHeader("Idempotency-Key") @NotBlank @Size(max=255) String key) {
        return service.record(account, new SpendingService.Input(input.amountMinor(), input.category(), input.note(),
                input.occurredAt(),input.source(),input.currency()), key);
    }
    @GetMapping
    public List<SpendLog> list(@PathVariable UUID account, @RequestParam(required=false) Instant since,
                              @RequestParam(defaultValue="100") @Min(1) @Max(500) int limit) {
        return service.list(account,since,limit);
    }
    @DeleteMapping("/{id}")
    public Map<String,Boolean> remove(@PathVariable UUID account, @PathVariable UUID id) {
        return Map.of("removed", service.remove(account,id));
    }
    @PostMapping("/import")
    public SpendingService.ImportResult importCsv(@PathVariable UUID account, @Valid @RequestBody Csv input) {
        return service.importCsv(account,input.csv(),input.timeZone());
    }
}
