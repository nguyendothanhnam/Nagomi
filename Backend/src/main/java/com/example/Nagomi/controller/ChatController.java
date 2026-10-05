package com.example.Nagomi.controller;

import com.example.Nagomi.model.ChannelMessage;
import com.example.Nagomi.model.PrivateMessage;
import com.example.Nagomi.repository.ChannelMessageRepository;
import com.example.Nagomi.repository.PrivateMessageRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.stereotype.Repository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.ResponseBody;

import java.util.List;

@Controller
public class ChatController {

    @Autowired
    private PrivateMessageRepository msgRepo;
    @Autowired private SimpMessagingTemplate messagingTemplate;
    @Autowired private ChannelMessageRepository channelMsgRepo;// Công cụ gửi tin

    // Client gửi tới: /app/private-message
    @MessageMapping("/private-message")
    public void sendPrivateMessage(@Payload PrivateMessage message) {
        // 1. Lưu và lấy message đã có ID
        PrivateMessage savedMsg = msgRepo.save(message);

        // 2. Gửi cho Người Nhận (Receiver)
        messagingTemplate.convertAndSend(
                "/topic/private/" + savedMsg.getReceiverId(),
                savedMsg
        );
        // 👇 3. THÊM DÒNG NÀY: Gửi ngược lại cho Người Gửi (Sender) - Để họ có ID thật
        messagingTemplate.convertAndSend(
                "/topic/private/" + savedMsg.getSenderId(),
                savedMsg
        );
    }
    @GetMapping("/api/messages/{senderId}/{receiverId}")
    @ResponseBody
    public List<PrivateMessage> getChatHistory(@PathVariable Long senderId, @PathVariable Long receiverId){
        return msgRepo.findChatHistory(senderId, receiverId);
    }

    // 👇 1. API Lấy lịch sử chat Kênh
    @GetMapping("/api/channels/{channelId}/messages")
    @ResponseBody
    public List<ChannelMessage> getChannelHistory(@PathVariable Long channelId) {
        return channelMsgRepo.findByChannelIdOrderByIdAsc(channelId);
    }
    // 👇 2. WebSocket: Gửi tin nhắn vào Kênh
    @MessageMapping("/channel-message")
    public void sendChannelMessage(@Payload ChannelMessage message) {
        // Lưu vào bảng 'messages'
        ChannelMessage savedMsg = channelMsgRepo.save(message);

        // Gửi ra topic chung của kênh đó
        messagingTemplate.convertAndSend(
                "/topic/channel/" + savedMsg.getChannel().getId(),
                savedMsg
        );
    }

}
