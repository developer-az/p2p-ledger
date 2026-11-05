package io.github.developeraz.ledger.api;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import io.github.developeraz.ledger.chain.ChainProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** The Java API is internal; the BFF authenticates users and authorizes the actor before forwarding. */
@Component
@Order(1)
public class ServiceAuthenticationFilter extends OncePerRequestFilter {
    private final String key;
    public ServiceAuthenticationFilter(@Value("${ledger.api-key:}") String key, ChainProperties chain) {
        this.key = key;
        if ((!key.isEmpty() && key.length() < 32) || (chain.enabled() && key.length() < 32))
            throw new IllegalArgumentException("LEDGER_API_KEY must contain at least 32 characters");
    }
    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain next)
            throws ServletException, IOException {
        String path = req.getRequestURI();
        // Match Spring's matrix-parameter normalization; encoded alternate paths are not part of this API.
        if (path.contains("%")) { reject(res, 400, "Use canonical API paths"); return; }
        path = path.replaceAll(";[^/]*", "");
        boolean sensitive = path.startsWith("/v1/requests") || path.matches("/v1/transfers/[^/]+/receipt")
                || path.matches("/v1/accounts/[^/]+/spends(?:/.*)?");
        if (!path.equals("/actuator/health") && (!key.isEmpty() || sensitive)) {
            if (key.isEmpty()) { reject(res, 503, "Configure LEDGER_API_KEY to use this integration"); return; }
            String supplied = req.getHeader("X-Ledger-Key");
            if (supplied == null || !MessageDigest.isEqual(key.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8))) {
                reject(res, 401, "Invalid service credentials"); return;
            }
        }
        next.doFilter(req, res);
    }
    private static void reject(HttpServletResponse res, int status, String detail) throws IOException {
        res.setStatus(status); res.setContentType("application/problem+json");
        res.getWriter().write("{\"status\":" + status + ",\"detail\":\"" + detail + "\"}");
    }
}
