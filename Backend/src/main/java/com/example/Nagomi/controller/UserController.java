package com.example.Nagomi.controller;

import com.example.Nagomi.dto.request.UserUpdateRequest;
import com.example.Nagomi.model.ChannelMusic;
import com.example.Nagomi.model.FriendRequest;
import com.example.Nagomi.model.User;
import com.example.Nagomi.repository.ChannelMusicRepository;
import com.example.Nagomi.repository.FriendRequestRepository;
import com.example.Nagomi.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import com.example.Nagomi.util.JwtUtils;

import java.util.*;
import java.util.stream.Collectors;

import com.example.Nagomi.dto.request.ChangePasswordRequest;

import org.mindrot.jbcrypt.BCrypt;

@RestController
@RequestMapping("/api/users") // <-- Khớp với đường dẫn Frontend gọi
@CrossOrigin
public class UserController {

    @Autowired
    private FriendRequestRepository friendRequestRepository;
    @Autowired
    private UserRepository userRepo;
    @Autowired
    private SimpMessagingTemplate messagingTemplate;
    // API lấy danh sách bạn bè
    // URL: /api/users/friends/{userId}
    @GetMapping("/friends/{userId}")
    public List<User> getFriendsList(@PathVariable Long userId) {

        // 1. Lấy tất cả các mối quan hệ đã ACCEPTED
        List<FriendRequest> friendships = friendRequestRepository.findAllAcceptedFriendships(userId);

        List<User> friends = new ArrayList<>();

        // 2. Lọc ra người kia là ai
        for (FriendRequest req : friendships) {
            if (req.getSender().getId().equals(userId)) {
                // Nếu mình là người gửi -> Bạn là người nhận
                friends.add(req.getReceiver());
            } else {
                // Nếu mình là người nhận -> Bạn là người gửi
                friends.add(req.getSender());
            }
        }

        return friends; // Trả về danh sách User (bạn bè)
    }
    @PutMapping("/{userId}/avatar")
    public ResponseEntity<?> updateUserAvatar(@PathVariable Long userId, @RequestParam String avatarUrl) {
        return userRepo.findById(userId).map(user -> {
            user.setAvatarUrl(avatarUrl); // Cập nhật cột avatar_url
            userRepo.save(user);          // Lưu lại
            return ResponseEntity.ok(user);
        }).orElse(ResponseEntity.notFound().build());
    }
    @PutMapping("/{userId}/status")
    public ResponseEntity<?> updateUserStatus(@PathVariable Long userId, @RequestParam String status,
                                               @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long authenticatedUserId = JwtUtils.extractUserId(authorization);
        if (authenticatedUserId == null || !authenticatedUserId.equals(userId))
            return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        if (!"ONLINE".equals(status) && !"OFFLINE".equals(status))
            return ResponseEntity.badRequest().body("Trạng thái không hợp lệ.");
        return userRepo.findById(userId).map(user -> {
            user.setStatus(status); // Cập nhật vào DB
            userRepo.save(user);
            // Gửi cả ID và Status mới ra kênh công khai "/topic/status"
            Map<String, Object> presence = new HashMap<>();
            presence.put("id", user.getId());
            presence.put("username", user.getUsername());
            presence.put("avatarUrl", user.getAvatarUrl());
            presence.put("status", user.getStatus());
            messagingTemplate.convertAndSend("/topic/status", presence);

            return ResponseEntity.ok("Đã cập nhật trạng thái: " + status);
        }).orElse(ResponseEntity.notFound().build());
    }
    @PutMapping("/{userId}")
    public ResponseEntity<String> updateUserInfo(@PathVariable Long userId, @RequestBody UserUpdateRequest request) {
        // 1. Tìm User
        User user = userRepo.findById(userId).orElse(null);

        if (user == null) {
            return ResponseEntity.badRequest().body("Lỗi: Không tìm thấy người dùng.");
        }

        // 2. Cập nhật thông tin
        // Có thể thêm logic kiểm tra trùng username/email ở đây nếu cần
        user.setUsername(request.getUsername());
        user.setEmail(request.getEmail());

        // 3. Lưu vào Database
        userRepo.save(user);

        return ResponseEntity.ok("Thông tin hồ sơ đã được cập nhật thành công.");
    }

    @PostMapping("/{userId}/change-password")
    public ResponseEntity<String> changePassword(@PathVariable Long userId, @RequestBody ChangePasswordRequest request) {

        // 1. Tìm User
        User user = userRepo.findById(userId).orElse(null);

        if (user == null) {
            return ResponseEntity.badRequest().body("Lỗi: Không tìm thấy người dùng.");
        }

        // 2. Xác thực mật khẩu cũ
        if (!BCrypt.checkpw(request.getOldPassword(), user.getPassword())) {
            // Trả về lỗi nếu mật khẩu cũ không khớp
            return ResponseEntity.badRequest().body("Mật khẩu cũ không đúng.");
        }

        // 3. Mã hóa và cập nhật mật khẩu mới
        String newHashedPassword = BCrypt.hashpw(request.getNewPassword(), BCrypt.gensalt());
        user.setPassword(newHashedPassword);

        // 4. Lưu vào Database
        userRepo.save(user);

        return ResponseEntity.ok("Mật khẩu đã được thay đổi thành công.");
    }
    @GetMapping("/search")
    public ResponseEntity<?> searchUsers(
            @RequestParam("myId") Long myId,
            @RequestParam("keyword") String keyword
    ) {
        try {
            List<Object[]> results = userRepo.searchUsersWithMutualCount(myId, keyword);

            List<Map<String, Object>> response = results.stream().map(row -> {
                Map<String, Object> map = new HashMap<>();
                map.put("id", row[0]);
                map.put("username", row[1]);
                map.put("avatarUrl", row[2]);
                map.put("mutualFriends", row[3]);
                return map;
            }).collect(Collectors.toList());

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(500).body("Lỗi Server: " + e.getMessage());
        }
    }
}
