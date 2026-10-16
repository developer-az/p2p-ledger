package io.github.developeraz.ledger.audit;

import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuditController {

    private final AuditService service;

    public AuditController(AuditService service) {
        this.service = service;
    }

    /** The transfer, its ledger legs, and the events relayed for it. */
    @GetMapping("/v1/transfers/{id}/trail")
    public AuditView.Trail trail(@PathVariable UUID id) {
        return service.trail(id);
    }

    /** Reconciliation: recomputes balances and totals from the raw entries. */
    @GetMapping("/v1/ledger/integrity")
    public AuditView.Integrity integrity() {
        return service.integrity();
    }

    /** Attempts forbidden writes in rolled-back transactions and reports what Postgres said. */
    @PostMapping("/v1/ledger/tamper-checks")
    public AuditView.TamperReport tamper(@RequestParam(required = false) UUID transferId) {
        return service.tamper(transferId);
    }
}
