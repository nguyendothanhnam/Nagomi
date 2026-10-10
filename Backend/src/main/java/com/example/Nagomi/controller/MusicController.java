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

    // --- LOGIC QUẢN LÝ NGƯỜI THAM GIA ---
    @MessageMapping("/voice.join/{channelId}")
    public void handleJoinVoice(@DestinationVariable Long channelId, @Payload User user) {
        boolean canJoin = voiceService.joinChannel(channelId, user);
        if (canJoin) {
            List<User> currentMembers = voiceService.getMembers(channelId);
            messagingTemplate.convertAndSend("/topic/voice.members." + channelId, currentMembers);
            sendVoiceStatusUpdate(channelId, currentMembers);

            // TỰ ĐỘNG GỬI THÔNG TIN NHẠC CHO NGƯỜI MỚI VÀO
            if (roomMusicStatus.containsKey(channelId)) {
                messagingTemplate.convertAndSend("/topic/music.sync." + channelId, roomMusicStatus.get(channelId));
            }
        } else {
            messagingTemplate.convertAndSendToUser(user.getId().toString(), "/queue/errors", "Kênh đầy");
        }
    }

    @MessageMapping("/voice.leave/{channelId}/{userId}")
    public void handleLeaveVoice(@DestinationVariable Long channelId, @DestinationVariable Long userId) {
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
    public void relayVoiceSignal(@DestinationVariable Long channelId, @Payload Map<String, Object> signal) {
        messagingTemplate.convertAndSend("/topic/voice.signal." + channelId, (Object) signal);
    }

    // --- LOGIC ĐIỀU KHIỂN NHẠC (ĐÃ GỘP VÀ SỬA LỖI) ---
    @MessageMapping("/music.control/{channelId}")
    public void handleMusicControl(@DestinationVariable Long channelId, @Payload MusicControlRequest request) {
        // Nếu là lệnh PLAY hoặc PAUSE, chúng ta cập nhật trạng thái vào bộ nhớ tạm
        if ("PLAY".equals(request.getAction()) || "PAUSE".equals(request.getAction())) {
            MusicSyncMessage status = new MusicSyncMessage();
            status.setUrl(request.getUrl());
            status.setTitle(request.getTitle());
            status.setPosition(request.getPosition());
            status.setPlaying("PLAY".equals(request.getAction()));

            roomMusicStatus.put(channelId, status);
        }

        // Broadcast lệnh cho tất cả mọi người trong kênh
        messagingTemplate.convertAndSend("/topic/music." + channelId, request);
    }

    @MessageMapping("/music.sync/{channelId}")
    public void handleSyncMusic(@DestinationVariable Long channelId, @Payload MusicSyncMessage message) {
        // Cập nhật trạng thái phòng khi nhận được dữ liệu đồng bộ chính xác từ máy người dùng
        roomMusicStatus.put(channelId, message);
        // Gửi thông tin đồng bộ (vị trí bài hát) cho tất cả mọi người (đặc biệt là người mới)
        messagingTemplate.convertAndSend("/topic/music.sync." + channelId, message);
    }
}
