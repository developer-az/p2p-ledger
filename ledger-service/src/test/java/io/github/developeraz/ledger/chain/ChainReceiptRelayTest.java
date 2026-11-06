package io.github.developeraz.ledger.chain;

import static org.mockito.Mockito.*;
import static org.assertj.core.api.Assertions.*;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

class ChainReceiptRelayTest {
    private final Instant now=Instant.parse("2026-11-05T12:00:00Z");
    private final ChainReceiptRepository receipts=mock(ChainReceiptRepository.class);
    private final EthereumRpc rpc=mock(EthereumRpc.class);
    private final String zero="0x"+"0".repeat(64), hash="0x"+"a".repeat(64), value="0x"+"b".repeat(64);
    private final ChainProperties config=new ChainProperties(true,31337,"test","http://localhost:8545","http://localhost:8545",
            "0x"+"1".repeat(40),"0x"+"2".repeat(64),"0x"+"3".repeat(40),"finalized",50000000000L,150000,3);
    private ChainReceiptRelay relay;
    @BeforeEach void setup() {
        relay=new ChainReceiptRelay(receipts,config,rpc,mock(TransactionTemplate.class),Clock.fixed(now,ZoneOffset.UTC),new SimpleMeterRegistry());
    }
    private ChainReceipt job(String status,String transaction,int attempts,Instant submitted) {
        return new ChainReceipt(UUID.randomUUID(),"0x"+"c".repeat(64),value,"private-preimage",31337,config.contractAddress(),status,
                transaction,null,attempts,null,submitted,now.minusSeconds(7200),now.minusSeconds(5),now);
    }
    @Test void submitsOnlyWhenTheCanonicalReceiptIsAbsent() {
        var job=job("PENDING",null,0,null);
        when(rpc.receipt(job.transferKey(),"latest")).thenReturn(new EthereumRpc.OnChain(zero,0));
        when(rpc.submit(job)).thenReturn(hash);
        relay.process(job);
        verify(receipts).update(job.transferId(),"SUBMITTED",hash,null,0,null,now.plusSeconds(10));
    }
    @Test void aCanonicalReceiptRecoversAnAmbiguousSendWithoutResubmitting() {
        var job=job("PENDING",null,1,null);
        when(rpc.receipt(job.transferKey(),"latest")).thenReturn(new EthereumRpc.OnChain(value,42));
        when(rpc.receipt(job.transferKey(),"finalized")).thenReturn(new EthereumRpc.OnChain(value,42));
        when(rpc.call(eq("eth_getLogs"),any())).thenReturn(new JsonMapper().readTree("[{\"transactionHash\":\""+hash+"\",\"removed\":false}]"));
        relay.process(job);
        verify(rpc,never()).submit(any());
        verify(receipts).update(job.transferId(),"FINALIZED",hash,42L,1,null,now);
    }
    @Test void inclusionIsNotFinality() {
        var job=job("SUBMITTED",hash,0,now.minusSeconds(30));
        when(rpc.receipt(job.transferKey(),"latest")).thenReturn(new EthereumRpc.OnChain(value,42));
        when(rpc.receipt(job.transferKey(),"finalized")).thenReturn(new EthereumRpc.OnChain(zero,0));
        relay.process(job);
        verify(receipts).update(job.transferId(),"SUBMITTED",hash,42L,0,null,now.plusSeconds(15));
        verify(rpc,never()).submit(any());
    }
    @Test void aPendingTransactionIsNeverBlindlyReplaced() {
        var job=job("SUBMITTED",hash,0,now.minusSeconds(30));
        when(rpc.receipt(job.transferKey(),"latest")).thenReturn(new EthereumRpc.OnChain(zero,0));
        when(rpc.call("eth_getTransactionReceipt",hash)).thenReturn(new JsonMapper().nullNode());
        relay.process(job);
        verify(rpc,never()).submit(any());
        verify(receipts).update(job.transferId(),"SUBMITTED",hash,null,0,"Awaiting inclusion",now.plusSeconds(15));
    }
    @Test void conflictsExhaustTheBoundedRetryPolicyWithoutOverwritingTheChain() {
        var job=job("PENDING",null,2,null);
        when(rpc.receipt(job.transferKey(),"latest")).thenReturn(new EthereumRpc.OnChain(hash,42));
        relay.process(job);
        verify(rpc,never()).submit(any());
        verify(receipts).update(job.transferId(),"FAILED",null,null,3,"Conflicting on-chain commitment",now.plusSeconds(40));
    }
    @Test void wrongRuntimeNeverReachesTheSigningGateway() {
        var job=job("PENDING",null,0,null);
        doThrow(new IllegalStateException("Contract runtime fingerprint mismatch")).when(rpc).verifyTarget();
        relay.process(job);
        verify(rpc,never()).submit(any());
        verify(receipts).update(job.transferId(),"PENDING",null,null,1,"Contract runtime fingerprint mismatch",now.plusSeconds(10));
    }
    @Test void aStalledTransactionStopsRetryingAndKeepsItsHashForOperatorInspection() {
        var job=job("SUBMITTED",hash,2,now.minusSeconds(3600));
        when(rpc.receipt(job.transferKey(),"latest")).thenReturn(new EthereumRpc.OnChain(zero,0));
        when(rpc.call("eth_getTransactionReceipt",hash)).thenReturn(new JsonMapper().nullNode());
        relay.process(job);
        verify(receipts).update(job.transferId(),"FAILED",hash,null,3,"Transaction stalled; inspect signer before redrive",now.plusSeconds(40));
        verify(rpc,never()).submit(any());
    }
    @Test void publicNetworksCannotDisableFinalityOrFingerprintChecks() {
        assertThatThrownBy(() -> new ChainProperties(true,1,"prod",config.rpcUrl(),config.signerRpcUrl(),config.contractAddress(),
                config.runtimeSha256(),config.relayerAddress(),"latest",config.maxGasPriceWei(),config.maxGas(),3).validate())
                .isInstanceOf(IllegalArgumentException.class);
    }
}
