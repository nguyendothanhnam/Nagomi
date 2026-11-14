package com.example.Nagomi;

import com.example.Nagomi.controller.MusicController;
import com.example.Nagomi.model.User;
import com.example.Nagomi.service.VoiceService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.support.GenericMessage;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class ScreenShareTests {
    private MusicController controller;
    private SimpMessagingTemplate messages;
    private VoiceService voice;

    @BeforeEach
    void setUp() {
        controller = new MusicController();
        messages = mock(SimpMessagingTemplate.class);
        voice = new VoiceService();
        ReflectionTestUtils.setField(controller, "messagingTemplate", messages);
        ReflectionTestUtils.setField(controller, "voiceService", voice);
        for (long id : List.of(1L, 2L)) join(id, "voice" + id);
        clearInvocations(messages);
    }

    private void join(long id, String session) {
        User user = new User(); user.setId(id); user.setUsername("User " + id);
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create();
        headers.setSessionId(session);
        controller.handleJoinVoice(101L, user, headers);
    }

    private void signal(String type, String from, String session) {
        controller.relayVoiceSignal(101L, Map.of("type", type, "from", from, "sessionId", session, "to", "all", "streamId", "display"));
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private List<Map> signals() {
        ArgumentCaptor<Map> result = ArgumentCaptor.forClass(Map.class);
        verify(messages, atLeastOnce()).convertAndSend(eq("/topic/voice.signal.101"), (Object) result.capture());
        return result.getAllValues();
    }

    @Test
    void concurrentClaimsGrantExactlyOneOwner() throws Exception {
        try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
            CountDownLatch start = new CountDownLatch(1);
            Future<?> first = executor.submit(() -> { try { start.await(); signal("screen-share-claim", "1", "one"); } catch (InterruptedException e) { throw new RuntimeException(e); } });
            Future<?> second = executor.submit(() -> { try { start.await(); signal("screen-share-claim", "2", "two"); } catch (InterruptedException e) { throw new RuntimeException(e); } });
            start.countDown(); first.get(5, TimeUnit.SECONDS); second.get(5, TimeUnit.SECONDS);
        }
        assertEquals(1, signals().stream().filter(item -> "screen-share-granted".equals(item.get("type"))).count());
        assertEquals(1, signals().stream().filter(item -> "screen-share-denied".equals(item.get("type"))).count());
    }

    @Test
    void lateViewerGetsActiveOwnerAndStream() {
        signal("screen-share-claim", "1", "one");
        signal("screen-share-start", "1", "one");
        signal("screen-share-query", "2", "unused");
        Map<?, ?> state = signals().getLast();
        assertEquals("2", state.get("to"));
        Map<?, ?> owner = (Map<?, ?>) state.get("owner");
        assertEquals("1", owner.get("id"));
        assertEquals("display", owner.get("streamId"));
        assertEquals(false, owner.get("pending"));
    }

    @Test
    void onlyMatchingOwnerSessionCanReleaseLock() {
        signal("screen-share-claim", "1", "one");
        signal("screen-share-stop", "2", "one");
        signal("screen-share-stop", "1", "old");
        signal("screen-share-claim", "2", "two");
        assertEquals("screen-share-denied", signals().getLast().get("type"));
        signal("screen-share-stop", "1", "one");
        signal("screen-share-claim", "2", "two");
        assertEquals("screen-share-granted", signals().getLast().get("type"));
    }

    @Test
    void disconnectClearsShareAndVoiceMembership() {
        signal("screen-share-claim", "1", "one");
        controller.handleVoiceDisconnect(new SessionDisconnectEvent(this, new GenericMessage<>(new byte[0]), "voice1", CloseStatus.NORMAL));
        assertTrue(voice.getMembers(101L).stream().noneMatch(user -> user.getId().equals(1L)));
        assertTrue(signals().stream().anyMatch(item -> "screen-share-stop".equals(item.get("type"))));
        signal("screen-share-claim", "2", "two");
        assertEquals("screen-share-granted", signals().getLast().get("type"));
    }

    @Test
    void oldSocketDisconnectDoesNotRemoveReconnectedMember() {
        signal("screen-share-claim", "1", "one");
        join(1L, "voice1-new");
        controller.handleVoiceDisconnect(new SessionDisconnectEvent(this, new GenericMessage<>(new byte[0]), "voice1", CloseStatus.NORMAL));
        assertTrue(voice.getMembers(101L).stream().anyMatch(user -> user.getId().equals(1L)));
        signal("screen-share-claim", "2", "two");
        assertEquals("screen-share-denied", signals().getLast().get("type"));
    }
}
