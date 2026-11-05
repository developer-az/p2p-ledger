package io.github.developeraz.ledger.chain;

import java.util.UUID;
import io.github.developeraz.ledger.common.NotFoundException;
import org.springframework.web.bind.annotation.*;

@RestController
public class ChainReceiptController {
    private final ChainReceiptRepository receipts;
    public ChainReceiptController(ChainReceiptRepository receipts) { this.receipts = receipts; }

    /** Internal API: the BFF must authorize a transfer participant before forwarding this proof. */
    @GetMapping("/v1/transfers/{id}/receipt")
    public ChainReceipt get(@PathVariable UUID id) {
        return receipts.find(id).orElseThrow(() -> new NotFoundException("No chain receipt queued for this transfer"));
    }
}
