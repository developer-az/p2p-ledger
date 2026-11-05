package io.github.developeraz.ledger.requests;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/requests")
@Validated
public class PaymentRequestController {
    private final PaymentRequestService service;
    public PaymentRequestController(PaymentRequestService service) { this.service = service; }

    public record Payer(@NotNull UUID accountId, @Positive @Max(9007199254740991L) long amountMinor) { }
    public record Split(@NotNull UUID requesterAccountId, @NotNull @Size(min=1,max=8) List<@Valid Payer> payers,
                        @Size(max=140) String memo) { }
    public record Actor(@NotNull UUID accountId, @Pattern(regexp="zelle|cashapp|venmo|cash|crypto|other") String settledVia) { }

    @PostMapping
    public Map<String, List<PaymentRequest>> split(@Valid @RequestBody Split input,
            @RequestHeader("Idempotency-Key") @NotBlank @Size(max=255) String key) {
        return Map.of("requests", service.split(new PaymentRequestService.Split(input.requesterAccountId(),
                input.payers().stream().map(p -> new PaymentRequestService.Payer(p.accountId(), p.amountMinor())).toList(), input.memo()), key));
    }
    @GetMapping("/{id}")
    public PaymentRequest get(@PathVariable UUID id) { return service.get(id); }
    @GetMapping
    public List<PaymentRequest> list(@RequestParam UUID accountId, @RequestParam(defaultValue="60") @Min(1) @Max(200) int limit) {
        return service.list(accountId, limit);
    }
    @PostMapping("/{id}/pay")
    public PaymentRequestService.Payment pay(@PathVariable UUID id, @Valid @RequestBody Actor actor,
            @RequestHeader("Idempotency-Key") @NotBlank @Size(max=255) String key) {
        return service.pay(id, actor.accountId(), key);
    }
    @PostMapping("/{id}/{action:decline|cancel|settle}")
    public Map<String, PaymentRequest> resolve(@PathVariable UUID id, @PathVariable String action, @Valid @RequestBody Actor actor) {
        return Map.of("request", service.resolve(id, actor.accountId(), action, actor.settledVia()));
    }
}
