package io.github.developeraz.ledger;

import static org.assertj.core.api.Assertions.*;
import io.github.developeraz.ledger.api.ServiceAuthenticationFilter;
import io.github.developeraz.ledger.chain.ChainProperties;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class ServiceAuthenticationTest {
    private final ChainProperties disabled=new ChainProperties(false,0,null,null,null,null,null,null,null,0,0,0);
    @Test void newWorkflowsFailClosedWithoutServiceCredentials() throws Exception {
        for(String path:new String[]{"/v1/capabilities","/v1/accounts/123/provision","/v1/requests","/v1/requests;ignored","/v1/accounts/123/spends/import","/v1/transfers/123/receipt"}) {
            var response=new MockHttpServletResponse();
            new ServiceAuthenticationFilter("",disabled).doFilter(new MockHttpServletRequest("POST",path),response,
                    (req,res) -> { throw new AssertionError("Unauthenticated request reached a workflow"); });
            assertThat(response.getStatus()).isEqualTo(503);
        }
    }
    @Test void configuredKeyProtectsAllRoutesExceptHealth() throws Exception {
        String key="test-"+"x".repeat(32);
        var filter=new ServiceAuthenticationFilter(key,disabled);
        var denied=new MockHttpServletResponse();
        filter.doFilter(new MockHttpServletRequest("GET","/v1/accounts"),denied,(req,res)->fail("Should reject"));
        assertThat(denied.getStatus()).isEqualTo(401);
        var authorized=new MockHttpServletRequest("GET","/v1/accounts"); authorized.addHeader("X-Ledger-Key",key);
        filter.doFilter(authorized,new MockHttpServletResponse(),(req,res)->res.getWriter().write("accepted"));
        var health=new MockHttpServletResponse();
        filter.doFilter(new MockHttpServletRequest("GET","/actuator/health"),health,(req,res)->res.getWriter().write("healthy"));
        assertThat(health.getContentAsString()).isEqualTo("healthy");
    }
}
