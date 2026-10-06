package com.example.Nagomi.controller;

import com.example.Nagomi.model.ChannelMessage;
import com.example.Nagomi.model.PrivateMessage;
import com.example.Nagomi.repository.ChannelMessageRepository;
import com.example.Nagomi.repository.PrivateMessageRepository;
import com.example.Nagomi.util.JwtUtils;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.stereotype.Repository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.Map;

@Controller
public class ChatController {

    @Autowired
    private PrivateMessageRepository msgRepo;
    @Autowired private SimpMessagingTemplate messagingTemplate;
    @Autowired private ChannelMessageRepository channelMsgRepo;// Công cụ gửi tin
    @Autowired private ObjectMapper objectMapper;

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

    @PutMapping("/api/messages/private/{messageId}")
    @ResponseBody
    public ResponseEntity<?> editPrivateMessage(@PathVariable Long messageId, @RequestParam String content,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long userId = JwtUtils.extractUserId(authorization);
        PrivateMessage message = msgRepo.findById(messageId).orElse(null);
        if (userId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        if (message == null) return ResponseEntity.notFound().build();
        if (!message.getSenderId().equals(userId)) return ResponseEntity.status(403).body("Bạn chỉ có thể sửa tin nhắn của mình.");
        if (!"TEXT".equals(message.getType())) return ResponseEntity.badRequest().body("Chỉ hỗ trợ sửa tin nhắn văn bản.");
        message.setContent(content);
        message.setEdited(true);
        return publishPrivateUpdate(msgRepo.save(message), "UPDATE");
    }

    @DeleteMapping("/api/messages/private/{messageId}")
    @ResponseBody
    public ResponseEntity<?> deletePrivateMessage(@PathVariable Long messageId,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long userId = JwtUtils.extractUserId(authorization);
        PrivateMessage message = msgRepo.findById(messageId).orElse(null);
        if (userId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        if (message == null) return ResponseEntity.notFound().build();
        if (!message.getSenderId().equals(userId)) return ResponseEntity.status(403).body("Bạn chỉ có thể xóa tin nhắn của mình.");
        Map<String, Object> deleted = Map.of("action", "DELETE", "id", messageId);
        messagingTemplate.convertAndSend("/topic/private/" + message.getSenderId(), deleted);
        messagingTemplate.convertAndSend("/topic/private/" + message.getReceiverId(), deleted);
        msgRepo.delete(message);
        return ResponseEntity.ok().build();
    }

    @PutMapping("/api/messages/private/{messageId}/pin")
    @ResponseBody
    public ResponseEntity<?> togglePrivatePin(@PathVariable Long messageId,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long userId = JwtUtils.extractUserId(authorization);
        PrivateMessage message = msgRepo.findById(messageId).orElse(null);
        if (userId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        if (message == null) return ResponseEntity.notFound().build();
        if (!message.getSenderId().equals(userId)) return ResponseEntity.status(403).body("Bạn chỉ có thể ghim tin nhắn của mình.");
        message.setPinned(!message.isPinned());
        return publishPrivateUpdate(msgRepo.save(message), "UPDATE");
    }

    @PutMapping("/api/messages/private/{messageId}/reaction")
    @ResponseBody
    public ResponseEntity<?> togglePrivateReaction(@PathVariable Long messageId, @RequestParam String emoji,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long userId = JwtUtils.extractUserId(authorization);
        PrivateMessage message = msgRepo.findById(messageId).orElse(null);
        if (userId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        if (message == null) return ResponseEntity.notFound().build();
        if (!userId.equals(message.getSenderId()) && !userId.equals(message.getReceiverId())) return ResponseEntity.status(403).body("Bạn không thuộc cuộc trò chuyện này.");
        if (emoji == null || emoji.length() > 16) return ResponseEntity.badRequest().body("Emoji không hợp lệ.");
        try {
            Map<String, List<Long>> reactions = objectMapper.readValue(message.getReactions() == null ? "{}" : message.getReactions(), new TypeReference<>() {});
            List<Long> users = reactions.computeIfAbsent(emoji, key -> new java.util.ArrayList<>());
            if (!users.remove(userId)) users.add(userId);
            if (users.isEmpty()) reactions.remove(emoji);
            message.setReactions(objectMapper.writeValueAsString(reactions));
            return publishPrivateUpdate(msgRepo.save(message), "UPDATE");
        } catch (Exception error) {
            return ResponseEntity.internalServerError().body("Không thể cập nhật cảm xúc.");
        }
    }

    private ResponseEntity<?> publishPrivateUpdate(PrivateMessage message, String action) {
        Map<String, Object> event = Map.of("action", action, "message", message);
        messagingTemplate.convertAndSend("/topic/private/" + message.getSenderId(), event);
        messagingTemplate.convertAndSend("/topic/private/" + message.getReceiverId(), event);
        return ResponseEntity.ok(message);
    }

    @PutMapping("/api/channels/messages/{messageId}")
    @ResponseBody
    public ResponseEntity<?> editChannelMessage(@PathVariable Long messageId, @RequestParam String content,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long userId = JwtUtils.extractUserId(authorization);
        ChannelMessage message = channelMsgRepo.findById(messageId).orElse(null);
        if (userId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        if (message == null) return ResponseEntity.notFound().build();
        if (!message.getSender().getId().equals(userId)) return ResponseEntity.status(403).body("Bạn chỉ có thể sửa tin nhắn của mình.");
        if (!"TEXT".equals(message.getType())) return ResponseEntity.badRequest().body("Chỉ hỗ trợ sửa tin nhắn văn bản.");
        message.setContent(content);
        message.setEdited(true);
        return publishMessageUpdate(channelMsgRepo.save(message), "UPDATE");
    }

    @DeleteMapping("/api/channels/messages/{messageId}")
    @ResponseBody
    public ResponseEntity<?> deleteChannelMessage(@PathVariable Long messageId,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long userId = JwtUtils.extractUserId(authorization);
        ChannelMessage message = channelMsgRepo.findById(messageId).orElse(null);
        if (userId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        if (message == null) return ResponseEntity.notFound().build();
        if (!message.getSender().getId().equals(userId)) return ResponseEntity.status(403).body("Bạn chỉ có thể xóa tin nhắn của mình.");
        Long channelId = message.getChannel().getId();
        channelMsgRepo.delete(message);
        messagingTemplate.convertAndSend("/topic/channel/" + channelId, Map.of("action", "DELETE", "id", messageId));
        return ResponseEntity.ok().build();
    }

    @PutMapping("/api/channels/messages/{messageId}/pin")
    @ResponseBody
    public ResponseEntity<?> togglePin(@PathVariable Long messageId,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long userId = JwtUtils.extractUserId(authorization);
        ChannelMessage message = channelMsgRepo.findById(messageId).orElse(null);
        if (userId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        if (message == null) return ResponseEntity.notFound().build();
        if (!message.getSender().getId().equals(userId)) return ResponseEntity.status(403).body("Bạn chỉ có thể ghim tin nhắn của mình.");
        message.setPinned(!message.isPinned());
        return publishMessageUpdate(channelMsgRepo.save(message), "UPDATE");
    }

    @PutMapping("/api/channels/messages/{messageId}/reaction")
    @ResponseBody
    public ResponseEntity<?> toggleReaction(@PathVariable Long messageId, @RequestParam String emoji,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long userId = JwtUtils.extractUserId(authorization);
        ChannelMessage message = channelMsgRepo.findById(messageId).orElse(null);
        if (userId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        if (message == null) return ResponseEntity.notFound().build();
        if (emoji == null || emoji.length() > 16) return ResponseEntity.badRequest().body("Emoji không hợp lệ.");
        try {
            Map<String, List<Long>> reactions = objectMapper.readValue(message.getReactions() == null ? "{}" : message.getReactions(), new TypeReference<>() {});
            List<Long> users = reactions.computeIfAbsent(emoji, key -> new java.util.ArrayList<>());
            if (!users.remove(userId)) users.add(userId);
            if (users.isEmpty()) reactions.remove(emoji);
            message.setReactions(objectMapper.writeValueAsString(reactions));
            return publishMessageUpdate(channelMsgRepo.save(message), "UPDATE");
        } catch (Exception error) {
            return ResponseEntity.internalServerError().body("Không thể cập nhật cảm xúc.");
        }
    }

    private ResponseEntity<?> publishMessageUpdate(ChannelMessage message, String action) {
        messagingTemplate.convertAndSend("/topic/channel/" + message.getChannel().getId(), Map.of("action", action, "message", message));
        return ResponseEntity.ok(message);
    }

}
