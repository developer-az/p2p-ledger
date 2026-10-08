package io.github.developeraz.ledger.outbox;

import java.sql.Timestamp;
import java.time.Clock;
import java.util.List;
import java.util.UUID;

import io.github.developeraz.ledger.common.UuidV7;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;

@Repository
public class OutboxRepository {

    private final JdbcClient jdbc;
    private final JsonMapper json;
    private final Clock clock;

    public OutboxRepository(JdbcClient jdbc, JsonMapper json, Clock clock) {
        this.jdbc = jdbc;
        this.json = json;
        this.clock = clock;
    }

    /** Must be called inside the transaction that made the change the event describes. */
    public void append(String eventType, UUID aggregateId, Object payload) {
        jdbc.sql("""
                insert into outbox_events (event_id, aggregate_id, event_type, payload, created_at)
                values (:eventId, :aggregateId, :type, cast(:payload as jsonb), :createdAt)
                """)
                .param("eventId", UuidV7.generate(clock))
                .param("aggregateId", aggregateId)
                .param("type", eventType)
                .param("payload", json.writeValueAsString(payload))
                .param("createdAt", Timestamp.from(clock.instant()))
                .update();
    }

    /** SKIP LOCKED lets several relay instances drain the outbox without double-claiming rows. */
    public List<OutboxEvent> claimBatch(int limit) {
        return jdbc.sql("""
                select id, event_id, aggregate_id, event_type, payload::text as payload
                from outbox_events
                where published_at is null
                order by id
                limit :limit
                for update skip locked
                """)
                .param("limit", limit)
                .query((rs, n) -> new OutboxEvent(
                        rs.getLong("id"),
                        rs.getObject("event_id", UUID.class),
                        rs.getObject("aggregate_id", UUID.class),
                        rs.getString("event_type"),
                        rs.getString("payload")))
                .list();
    }

    public void markPublished(List<Long> ids) {
        jdbc.sql("update outbox_events set published_at = :now where id in (:ids)")
                .param("now", Timestamp.from(clock.instant()))
                .param("ids", ids)
                .update();
    }

    public int countUnpublished() {
        return jdbc.sql("select count(*) from outbox_events where published_at is null")
                .query(Integer.class)
                .single();
    }
}
