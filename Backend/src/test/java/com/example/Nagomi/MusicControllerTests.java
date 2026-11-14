package com.example.Nagomi;

import com.example.Nagomi.controller.MusicController;
import com.example.Nagomi.dto.request.MusicControlRequest;
import com.example.Nagomi.dto.request.MusicSyncMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class MusicControllerTests {
    private MusicController controller;
    private SimpMessagingTemplate messaging;

    @BeforeEach
    void setUp() {
        controller = new MusicController();
        messaging = mock(SimpMessagingTemplate.class);
        ReflectionTestUtils.setField(controller, "messagingTemplate", messaging);
        ((Map<?, ?>) ReflectionTestUtils.getField(MusicController.class, "roomMusicStatus")).clear();
        ((Map<?, ?>) ReflectionTestUtils.getField(MusicController.class, "roomMusicUpdatedAt")).clear();
    }

    private void command(String action, Long position, Boolean loop) {
        MusicControlRequest request = new MusicControlRequest();
        request.setAction(action);
        request.setUrl("/uploads/song.mp3");
        request.setTitle("Bài thử");
        request.setPosition(position);
        request.setLoop(loop);
        controller.handleMusicControl(101L, request);
    }

    private MusicSyncMessage lastStatus() {
        ArgumentCaptor<MusicSyncMessage> status = ArgumentCaptor.forClass(MusicSyncMessage.class);
        verify(messaging, atLeastOnce()).convertAndSend(eq("/topic/music.sync.101"), status.capture());
        return status.getValue();
    }

    @Test
    void seekKeepsPausedStateAndLoop() {
        command("PLAY", 0L, true);
        command("PAUSE", 12000L, null);
        command("SEEK", 30000L, null);
        MusicSyncMessage status = lastStatus();
        assertFalse(status.isPlaying());
        assertTrue(status.isLoop());
        assertEquals(30000L, status.getPosition());
        assertEquals("/uploads/song.mp3", status.getUrl());
    }

    @Test
    @SuppressWarnings("unchecked")
    void lateJoinSyncIncludesElapsedPlaybackTime() {
        command("PLAY", 10000L, false);
        Map<Long, Long> times = (Map<Long, Long>) ReflectionTestUtils.getField(MusicController.class, "roomMusicUpdatedAt");
        times.put(101L, System.currentTimeMillis() - 5000);
        command("REQUEST_SYNC", null, null);
        MusicSyncMessage status = lastStatus();
        assertTrue(status.isPlaying());
        assertTrue(status.getPosition() >= 15000L && status.getPosition() < 17000L);
    }

    @Test
    @SuppressWarnings("unchecked")
    void pausedSyncDoesNotAdvanceAndNegativeSeekClampsToZero() {
        command("PLAY", 0L, false);
        command("PAUSE", 9000L, null);
        Map<Long, Long> times = (Map<Long, Long>) ReflectionTestUtils.getField(MusicController.class, "roomMusicUpdatedAt");
        times.put(101L, System.currentTimeMillis() - 5000);
        command("REQUEST_SYNC", null, null);
        assertEquals(9000L, lastStatus().getPosition());
        command("SEEK", -1000L, null);
        assertEquals(0L, lastStatus().getPosition());
    }

    @Test
    void loopTogglePreservesPlaybackAndSource() {
        command("PLAY", 15000L, false);
        command("LOOP", 0L, true);
        MusicSyncMessage status = lastStatus();
        assertTrue(status.isLoop());
        assertTrue(status.isPlaying());
        assertTrue(status.getPosition() >= 15000L);
        assertEquals("/uploads/song.mp3", status.getUrl());
    }
}
