package io.github.developeraz.ledger.account;

import java.net.URI;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/accounts")
@Validated
public class AccountController {

    private final AccountService service;

    public AccountController(AccountService service) {
        this.service = service;
    }

    public record OpenAccountRequest(@NotBlank @Size(max = 128) String ownerId,
                                     @NotBlank @Pattern(regexp = "[A-Z]{3}") String currency) {
    }

    @PostMapping
    public ResponseEntity<Account> open(@Valid @RequestBody OpenAccountRequest request) {
        Account account = service.open(request.ownerId(), request.currency());
        return ResponseEntity.created(URI.create("/v1/accounts/" + account.id())).body(account);
    }

    @GetMapping("/{id}")
    public Account get(@PathVariable UUID id) {
        return service.get(id);
    }

    @GetMapping("/{id}/entries")
    public List<LedgerEntry> entries(@PathVariable UUID id,
                                     @RequestParam(required = false) Long before,
                                     @RequestParam(defaultValue = "50") @Min(1) @Max(500) int limit) {
        return service.statement(id, before, limit);
    }
}
