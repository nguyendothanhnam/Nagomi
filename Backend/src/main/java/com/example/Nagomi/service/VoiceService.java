package com.example.Nagomi.service;

import com.example.Nagomi.model.User;
import org.springframework.stereotype.Service;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class VoiceService {
    // Lưu trữ: Map<ChannelId, List<User>> để quản lý ai đang ở kênh nào
    // Sử dụng ConcurrentHashMap để đảm bảo an toàn khi nhiều luồng truy cập cùng lúc
    private Map<Long, List<User>> voiceChannels = new ConcurrentHashMap<>();

    // 1. Kiểm tra và thêm người dùng vào kênh (Giới hạn tối đa 5 người)
    public synchronized boolean joinChannel(Long channelId, User user) {
        voiceChannels.putIfAbsent(channelId, new ArrayList<>());
        List<User> members = voiceChannels.get(channelId);

        // Kiểm tra giới hạn 5 người
        if (members.size() >= 5) {
            return false;
        }

        // Nếu user chưa có trong danh sách thì mới thêm vào để tránh trùng lặp
        boolean exists = members.stream().anyMatch(u -> u.getId().equals(user.getId()));
        if (!exists) {
            members.add(user);
        }
        return true;
    }

    // 2. Xóa người dùng khỏi kênh khi họ thoát hoặc ngắt kết nối
    public synchronized void leaveChannel(Long channelId, Long userId) {
        if (voiceChannels.containsKey(channelId)) {
            voiceChannels.get(channelId).removeIf(u -> u.getId().equals(userId));
        }
    }

    // 3. Lấy danh sách thành viên hiện tại trong một kênh
    public List<User> getMembers(Long channelId) {
        return voiceChannels.getOrDefault(channelId, new ArrayList<>());
    }

    public Map<Long, List<User>> getAllActiveStatus() {
        return voiceChannels;
    }
}