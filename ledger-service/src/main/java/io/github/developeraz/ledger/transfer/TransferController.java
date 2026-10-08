package io.github.developeraz.ledger.transfer;

import java.net.URI;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
public class TransferController {

    static final String IDEMPOTENCY_KEY = "Idempotency-Key";
    static final String REPLAYED = "Idempotent-Replayed";

    private final TransferService service;

    public TransferController(TransferService service) {
        this.service = service;
    }

    public record TransferRequest(@NotNull UUID sourceAccountId,
                                  @NotNull UUID destinationAccountId,
                                  @NotNull @Positive Long amountMinor,
                                  @NotBlank @Pattern(regexp = "[A-Z]{3}") String currency,
                                  @Size(max = 140) String memo) {
    }

    public record DepositRequest(@NotNull @Positive Long amountMinor, @Size(max = 140) String memo) {
    }

    @PostMapping("/v1/transfers")
    public ResponseEntity<Transfer> transfer(@RequestHeader(IDEMPOTENCY_KEY) @NotBlank @Size(max = 255) String key,
                                             @Valid @RequestBody TransferRequest request) {
        return respond(service.transfer(key, request.sourceAccountId(), request.destinationAccountId(),
                request.amountMinor(), request.currency(), request.memo()));
    }

    @PostMapping("/v1/accounts/{accountId}/deposits")
    public ResponseEntity<Transfer> deposit(@RequestHeader(IDEMPOTENCY_KEY) @NotBlank @Size(max = 255) String key,
                                            @PathVariable UUID accountId,
                                            @Valid @RequestBody DepositRequest request) {
        return respond(service.deposit(key, accountId, request.amountMinor(), request.memo()));
    }

    @GetMapping("/v1/transfers/{id}")
    public Transfer get(@PathVariable UUID id) {
        return service.get(id);
    }

    @GetMapping("/v1/transfers")
    public List<Transfer> forAccount(@RequestParam UUID accountId,
                                     @RequestParam(defaultValue = "50") @Min(1) @Max(500) int limit) {
        return service.forAccount(accountId, limit);
    }

    /**
     * 201 for a newly processed request (check {@code status}: a decline is still a processed
     * request), 200 with {@code Idempotent-Replayed: true} when returning a stored result.
     */
    private static ResponseEntity<Transfer> respond(TransferService.Result result) {
        Transfer t = result.transfer();
        if (result.replayed()) {
            return ResponseEntity.ok().header(REPLAYED, "true").body(t);
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .location(URI.create("/v1/transfers/" + t.id()))
                .body(t);
    }
}
