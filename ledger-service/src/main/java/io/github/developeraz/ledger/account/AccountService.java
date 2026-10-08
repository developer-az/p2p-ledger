package io.github.developeraz.ledger.account;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

import io.github.developeraz.ledger.common.BadRequestException;
import io.github.developeraz.ledger.common.NotFoundException;
import io.github.developeraz.ledger.common.UuidV7;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService {

    private final AccountRepository accounts;
    private final Clock clock;

    public AccountService(AccountRepository accounts, Clock clock) {
        this.accounts = accounts;
        this.clock = clock;
    }

    @Transactional
    public Account open(String ownerId, String currency) {
        if (accounts.findFundingAccount(currency).isEmpty()) {
            throw new BadRequestException("Unsupported currency: " + currency);
        }
        Account account = new Account(UuidV7.generate(clock), ownerId, currency, Account.AccountType.USER, 0,
                clock.instant());
        accounts.insert(account);
        return account;
    }

    @Transactional(readOnly = true)
    public Account get(UUID id) {
        return accounts.findById(id).orElseThrow(() -> new NotFoundException("Account not found: " + id));
    }

    @Transactional(readOnly = true)
    public List<Account> byOwner(String ownerId) {
        return accounts.findByOwner(ownerId);
    }

    @Transactional(readOnly = true)
    public List<LedgerEntry> statement(UUID id, Long beforeId, int limit) {
        get(id);
        return accounts.findEntries(id, beforeId, limit);
    }
}
