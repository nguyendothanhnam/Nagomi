package com.example.Nagomi.controller;

import com.example.Nagomi.dto.request.MusicControlRequest;
import com.example.Nagomi.dto.request.MusicSyncMessage;
import com.example.Nagomi.model.User;
import com.example.Nagomi.service.VoiceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Controller
public class MusicController {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @Autowired
    private VoiceService voiceService;

    // Bộ nhớ tạm để lưu trạng thái nhạc của từng phòng (Key là channelId)
    // Giúp người mới vào lấy được thông tin ngay mà không cần chờ người cũ phản hồi
    private static final Map<Long, MusicSyncMessage> roomMusicStatus = new ConcurrentHashMap<>();

    private final Map<Long, Map<String, Object>> roomScreenShares = new HashMap<>();
    private final Map<Long, Long> screenRevisions = new HashMap<>();
    private final Map<String, Long[]> voiceSessions = new HashMap<>();

    private void sendScreenState(Long channelId, Object to) {
        Map<String, Object> state = new HashMap<>();
        state.put("from", "server");
        state.put("to", to);
        state.put("type", "screen-share-state");
        state.put("owner", roomScreenShares.get(channelId));
        state.put("revision", screenRevisions.getOrDefault(channelId, 0L));
        messagingTemplate.convertAndSend("/topic/voice.signal." + channelId, (Object) state);
    }

    private void releaseScreenShare(Long channelId, Long userId) {
        Map<String, Object> owner = roomScreenShares.get(channelId);
        if (owner == null || !String.valueOf(userId).equals(owner.get("id"))) return;
        roomScreenShares.remove(channelId);
        screenRevisions.merge(channelId, 1L, Long::sum);
        Map<String, Object> stop = new HashMap<>();
        stop.put("from", String.valueOf(userId));
        stop.put("to", "all");
        stop.put("type", "screen-share-stop");
        stop.put("sessionId", owner.get("sessionId"));
        stop.put("revision", screenRevisions.get(channelId));
        messagingTemplate.convertAndSend("/topic/voice.signal." + channelId, (Object) stop);
    }

    @EventListener
    public synchronized void handleVoiceDisconnect(SessionDisconnectEvent event) {
        Long[] session = voiceSessions.remove(event.getSessionId());
        if (session == null) return;
        boolean stillConnected = voiceSessions.values().stream()
                .anyMatch(value -> value[0].equals(session[0]) && value[1].equals(session[1]));
        if (stillConnected) return;
        releaseScreenShare(session[0], session[1]);
        voiceService.leaveChannel(session[0], session[1]);
        List<User> members = voiceService.getMembers(session[0]);
        messagingTemplate.convertAndSend("/topic/voice.members." + session[0], members);
        sendVoiceStatusUpdate(session[0], members);
    }

    private static final Map<Long, Long> roomMusicUpdatedAt = new ConcurrentHashMap<>();

    private MusicSyncMessage currentMusicStatus(Long channelId) {
        MusicSyncMessage stored = roomMusicStatus.get(channelId);
        if (stored == null) return null;
        MusicSyncMessage snapshot = new MusicSyncMessage();
        snapshot.setUrl(stored.getUrl());
        snapshot.setTitle(stored.getTitle());
        snapshot.setPlaying(stored.isPlaying());
        snapshot.setLoop(stored.isLoop());
        long elapsed = stored.isPlaying()
                ? Math.max(0, System.currentTimeMillis() - roomMusicUpdatedAt.getOrDefault(channelId, System.currentTimeMillis())) : 0;
        snapshot.setPosition(stored.getPosition() + elapsed);
        return snapshot;
    }

    // --- LOGIC QUẢN LÝ NGƯỜI THAM GIA ---
    @MessageMapping("/voice.join/{channelId}")
    public synchronized void handleJoinVoice(@DestinationVariable Long channelId, @Payload User user, SimpMessageHeaderAccessor headers) {
        boolean canJoin = voiceService.joinChannel(channelId, user);
        if (canJoin) {
            if (headers.getSessionId() != null) voiceSessions.put(headers.getSessionId(), new Long[]{channelId, user.getId()});
            sendScreenState(channelId, user.getId());
            List<User> currentMembers = voiceService.getMembers(channelId);
            messagingTemplate.convertAndSend("/topic/voice.members." + channelId, currentMembers);
            sendVoiceStatusUpdate(channelId, currentMembers);

            // TỰ ĐỘNG GỬI THÔNG TIN NHẠC CHO NGƯỜI MỚI VÀO
            if (roomMusicStatus.containsKey(channelId)) {
                messagingTemplate.convertAndSend("/topic/music.sync." + channelId, currentMusicStatus(channelId));
            }
        } else {
            messagingTemplate.convertAndSendToUser(user.getId().toString(), "/queue/errors", "Kênh đầy");
        }
    }

    @MessageMapping("/voice.leave/{channelId}/{userId}")
    public synchronized void handleLeaveVoice(@DestinationVariable Long channelId, @DestinationVariable Long userId) {
        releaseScreenShare(channelId, userId);
        voiceSessions.entrySet().removeIf(entry -> entry.getValue()[0].equals(channelId) && entry.getValue()[1].equals(userId));
        voiceService.leaveChannel(channelId, userId);
        List<User> currentMembers = voiceService.getMembers(channelId);
        messagingTemplate.convertAndSend("/topic/voice.members." + channelId, currentMembers);
        sendVoiceStatusUpdate(channelId, currentMembers);
    }

    private void sendVoiceStatusUpdate(Long channelId, List<User> members) {
        Map<String, Object> update = new HashMap<>();
        update.put("channelId", channelId);
        update.put("members", members);
        messagingTemplate.convertAndSend("/topic/server.voice.status", (Object) update);
    }

    @MessageMapping("/voice.signal/{channelId}")
    public synchronized void relayVoiceSignal(@DestinationVariable Long channelId, @Payload Map<String, Object> signal) {
        String type = String.valueOf(signal.get("type"));
        String from = String.valueOf(signal.get("from"));
        if ("server".equals(from)) return;
        if ("screen-share-query".equals(type)) { sendScreenState(channelId, from); return; }
        if ("screen-share-claim".equals(type)) {
            User member = voiceService.getMembers(channelId).stream()
                    .filter(user -> String.valueOf(user.getId()).equals(from)).findFirst().orElse(null);
            if (member == null || !(signal.get("sessionId") instanceof String sessionId) || sessionId.isBlank()) return;
            Map<String, Object> owner = roomScreenShares.get(channelId);
            boolean accepted = owner == null || (from.equals(owner.get("id")) && sessionId.equals(owner.get("sessionId")));
            if (accepted && owner == null) {
                owner = new HashMap<>();
                owner.put("id", from);
                owner.put("username", member.getUsername());
                owner.put("sessionId", sessionId);
                owner.put("pending", true);
                roomScreenShares.put(channelId, owner);
                screenRevisions.merge(channelId, 1L, Long::sum);
                sendScreenState(channelId, "all");
            }
            Map<String, Object> reply = new HashMap<>();
            reply.put("from", "server");
            reply.put("to", from);
            reply.put("type", accepted ? "screen-share-granted" : "screen-share-denied");
            reply.put("sessionId", sessionId);
            reply.put("owner", owner);
            reply.put("revision", screenRevisions.getOrDefault(channelId, 0L));
            messagingTemplate.convertAndSend("/topic/voice.signal." + channelId, (Object) reply);
            return;
        }
        if ("screen-share-start".equals(type) || "screen-share-stop".equals(type)) {
            Map<String, Object> owner = roomScreenShares.get(channelId);
            if (owner == null || !from.equals(owner.get("id")) || !owner.get("sessionId").equals(signal.get("sessionId"))) return;
            if ("screen-share-stop".equals(type)) releaseScreenShare(channelId, Long.valueOf(from));
            else {
                if (Boolean.TRUE.equals(owner.get("pending")) || !java.util.Objects.equals(owner.get("streamId"), signal.get("streamId"))) screenRevisions.merge(channelId, 1L, Long::sum);
                owner.put("streamId", signal.get("streamId"));
                owner.put("pending", false);
                sendScreenState(channelId, signal.getOrDefault("to", "all"));
            }
            return;
        }
        // SDP và ICE vẫn được chuyển tiếp nguyên vẹn.
        if (type.startsWith("screen-share-")) return;
        messagingTemplate.convertAndSend("/topic/voice.signal." + channelId, (Object) signal);
    }

    // Backend giữ trạng thái và cộng thời gian đã phát cho người vào muộn.
    @MessageMapping("/music.control/{channelId}")
    public synchronized void handleMusicControl(@DestinationVariable Long channelId, @Payload MusicControlRequest request) {
        String action = request.getAction();
        MusicSyncMessage status = currentMusicStatus(channelId);
        if ("REQUEST_SYNC".equals(action)) {
            if (status != null) messagingTemplate.convertAndSend("/topic/music.sync." + channelId, status);
            return;
        }
        if ("REFRESH_LIST".equals(action)) {
            messagingTemplate.convertAndSend("/topic/music." + channelId, request);
            return;
        }
        if (!List.of("PLAY", "PAUSE", "SEEK", "LOOP").contains(action == null ? "" : action)) return;
        if (status == null) status = new MusicSyncMessage();
        if ("PLAY".equals(action)) {
            if (request.getUrl() == null || request.getUrl().isBlank()) return;
            status.setUrl(request.getUrl());
            status.setTitle(request.getTitle());
            status.setPlaying(true);
        } else if ("PAUSE".equals(action)) {
            status.setPlaying(false);
        }
        if (status.getUrl() == null) return;
        if (!"LOOP".equals(action) && request.getPosition() != null)
            status.setPosition(Math.max(0, request.getPosition()));
        if (request.getLoop() != null) status.setLoop(request.getLoop());
        roomMusicStatus.put(channelId, status);
        roomMusicUpdatedAt.put(channelId, System.currentTimeMillis());
        messagingTemplate.convertAndSend("/topic/music.sync." + channelId, status);
    }

    @MessageMapping("/music.sync/{channelId}")
    public synchronized void handleSyncMusic(@DestinationVariable Long channelId, @Payload MusicSyncMessage message) {
        // Nguồn trạng thái là backend; client chỉ yêu cầu lấy lại bản hiện tại.
        MusicSyncMessage status = currentMusicStatus(channelId);
        if (status != null) messagingTemplate.convertAndSend("/topic/music.sync." + channelId, status);
    }
}
