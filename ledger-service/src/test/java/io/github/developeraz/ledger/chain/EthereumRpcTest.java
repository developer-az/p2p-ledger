package io.github.developeraz.ledger.chain;

import static org.assertj.core.api.Assertions.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class EthereumRpcTest {
    private HttpServer server;
    private final JsonMapper json=new JsonMapper();
    @AfterEach void close() { if(server!=null) server.stop(0); }
    private EthereumRpc rpc(com.sun.net.httpserver.HttpHandler handler) throws Exception {
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/",handler); server.start();
        String url="http://127.0.0.1:"+server.getAddress().getPort();
        return new EthereumRpc(json,new ChainProperties(false,31337,"test",url,url,null,null,null,null,0,0,0));
    }
    @Test void usesPlainHttp11ForJsonRpcServersThatRejectH2cUpgrades() throws Exception {
        var upgrade=new AtomicReference<String>();
        var rpc=rpc(exchange->{
            upgrade.set(exchange.getRequestHeaders().getFirst("Upgrade"));
            var request=json.readTree(exchange.getRequestBody().readAllBytes());
            byte[] body=("{\"jsonrpc\":\"2.0\",\"id\":"+request.get("id").asLong()+",\"result\":\"0x7a69\"}").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,body.length); exchange.getResponseBody().write(body); exchange.close();
        });
        assertThat(rpc.call("eth_chainId").asText()).isEqualTo("0x7a69");
        assertThat(upgrade.get()).isNull();
    }
    @Test void rejectsAnOversizedResponseBeforeParsingIt() throws Exception {
        var rpc=rpc(exchange->{
            exchange.getRequestBody().readAllBytes(); byte[] body=new byte[300000];
            exchange.sendResponseHeaders(200,body.length);
            try { exchange.getResponseBody().write(body); } catch(java.io.IOException ignored) { }
            finally { exchange.close(); }
        });
        assertThatThrownBy(()->rpc.call("eth_chainId")).isInstanceOf(IllegalStateException.class);
    }
    @Test void refusesRpcResponsesWithADifferentRequestId() throws Exception {
        var rpc=rpc(exchange->{
            exchange.getRequestBody().readAllBytes();
            byte[] body="{\"jsonrpc\":\"2.0\",\"id\":999,\"result\":\"0x7a69\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,body.length); exchange.getResponseBody().write(body); exchange.close();
        });
        assertThatThrownBy(()->rpc.call("eth_chainId")).hasMessage("RPC eth_chainId rejected");
    }
}
