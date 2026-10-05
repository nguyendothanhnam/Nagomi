package com.example.Nagomi.controller;

import com.example.Nagomi.model.FriendRequest;
import com.example.Nagomi.model.RequestStatus;
import com.example.Nagomi.model.User;
import com.example.Nagomi.repository.FriendRequestRepository;
import com.example.Nagomi.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.*;


@RestController
@RequestMapping("/api/friends")
@CrossOrigin
public class FriendController {
    @Autowired private FriendRequestRepository friendRepo;
    @Autowired private UserRepository userRepo;

    // 1. GỬI LỜI MỜI (Đã thêm logic chặn gửi 2 lần)
    @PostMapping("/add")
    public String sendRequest(@RequestParam Long senderId, @RequestParam String friendUsername) {
        Optional<User> senderOpt = userRepo.findById(senderId);
        Optional<User> receiverOpt = userRepo.findByUsername(friendUsername);

        if (receiverOpt.isEmpty()) return "Không tìm thấy người dùng này.";

        User sender = senderOpt.get();
        User receiver = receiverOpt.get();

        if (sender.getId().equals(receiver.getId())) return "Không thể kết bạn với chính mình.";

        // 🔥 CHẶN KẾT BẠN 2 LẦN: Kiểm tra xem đã có lời mời PENDING nào chưa
        boolean alreadyExists = friendRepo.existsBySenderAndReceiverAndStatus(sender, receiver, RequestStatus.PENDING);
        if (alreadyExists) {
            return "Bạn đã gửi lời mời cho người này rồi, vui lòng đợi phản hồi.";
        }

        // Kiểm tra xem hai người đã là bạn bè chưa (Trạng thái ACCEPTED)
        boolean isAlreadyFriend = friendRepo.existsBySenderAndReceiverAndStatus(sender, receiver, RequestStatus.ACCEPTED) ||
                friendRepo.existsBySenderAndReceiverAndStatus(receiver, sender, RequestStatus.ACCEPTED);
        if (isAlreadyFriend) {
            return "Hai người đã là bạn bè rồi.";
        }

        FriendRequest req = new FriendRequest();
        req.setSender(sender);
        req.setReceiver(receiver);
        req.setStatus(RequestStatus.PENDING); // 👈 Dùng Enum thay vì String
        friendRepo.save(req);

        return "Đã gửi lời mời!";
    }

    // 2. Chấp nhận kết bạn
    @PostMapping("/accept/{requestId}")
    public String acceptRequest(@PathVariable Long requestId) {
        FriendRequest req = friendRepo.findById(requestId).orElse(null);
        if (req != null) {
            req.setStatus(RequestStatus.ACCEPTED); // 👈 Dùng Enum
            friendRepo.save(req);
            return "Đã chấp nhận kết bạn!";
        }
        return "Lỗi: Không tìm thấy lời mời.";
    }

    // 3. Lấy lời mời ĐÃ GỬI
    @GetMapping("/sent/{userId}")
    public List<FriendRequest> getSentRequests(@PathVariable Long userId) {
        User sender = userRepo.findById(userId).orElse(null);
        return friendRepo.findBySenderAndStatus(sender, RequestStatus.PENDING);
    }
    // 4. Lấy lời mời ĐÃ NHẬN
    @GetMapping("/requests/{userId}")
    public List<FriendRequest> getRequests(@PathVariable Long userId) {
        User receiver = userRepo.findById(userId).orElse(null);
        return friendRepo.findByReceiverAndStatus(receiver, RequestStatus.PENDING);
    }

    @DeleteMapping("/cancel/{requestId}")
    public String cancelRequest(@PathVariable Long requestId) {
        try {
            friendRepo.deleteById(requestId);
            return "Đã hủy/từ chối lời mời.";
        } catch (Exception e) {
            return "Lỗi: Không tìm thấy lời mời để hủy.";
        }
    }

    @PostMapping("/unfriend")
    public String unfriend(@RequestParam Long userId, @RequestParam Long friendId) {
        // Tìm mối quan hệ giữa 2 người
        FriendRequest relation = friendRepo.findFriendship(userId, friendId);

        if (relation != null) {
            friendRepo.delete(relation); // Xóa khỏi Database
            return "Đã hủy kết bạn.";
        }
        return "Lỗi: Không tìm thấy mối quan hệ bạn bè.";
    }

    @GetMapping("/mutual-count")
    public int getMutualFriendsCount(@RequestParam Long user1Id, @RequestParam Long user2Id) {
        // 1. Lấy danh sách bạn bè (những mối quan hệ đã ACCEPTED) của người thứ nhất
        List<FriendRequest> list1 = friendRepo.findAllAcceptedFriendships(user1Id); //

        // 2. Lấy danh sách bạn bè của người thứ hai
        List<FriendRequest> list2 = friendRepo.findAllAcceptedFriendships(user2Id); //

        // 3. Chuyển đổi danh sách FriendRequest thành bộ danh sách ID người dùng (User IDs)
        Set<Long> friendsOfUser1 = getFriendIds(user1Id, list1);
        Set<Long> friendsOfUser2 = getFriendIds(user2Id, list2);

        // 4. Tìm phần giao (bạn chung) giữa hai tập hợp
        friendsOfUser1.retainAll(friendsOfUser2);

        return friendsOfUser1.size();
    }
    private Set<Long> getFriendIds(Long myId, List<FriendRequest> friendships) {
        Set<Long> ids = new HashSet<>();
        for (FriendRequest req : friendships) {
            if (req.getSender().getId().equals(myId)) {
                ids.add(req.getReceiver().getId());
            } else {
                ids.add(req.getSender().getId());
            }
        }
        return ids;
    }


    @GetMapping("/profile-detail")
    public Map<String, Object> getProfileDetail(@RequestParam Long myId, @RequestParam Long targetId) {
        User targetUser = userRepo.findById(targetId).orElseThrow();

        // 1. Tính số bạn chung (Mutual Friends)
        List<FriendRequest> list1 = friendRepo.findAllAcceptedFriendships(myId);
        List<FriendRequest> list2 = friendRepo.findAllAcceptedFriendships(targetId);
        Set<Long> myFriendIds = getFriendIds(myId, list1);
        Set<Long> targetFriendIds = getFriendIds(targetId, list2);
        myFriendIds.retainAll(targetFriendIds);
        int mutualFriends = myFriendIds.size();

        // 2. Tính số server chung (Mutual Servers)
        // Giả định bạn có serverRepository và bảng trung gian server_members
        // long mutualServers = serverRepo.countMutualServers(myId, targetId);
        int mutualServers = 0; // Tạm thời để 0 nếu bạn chưa làm bảng server_members

        Map<String, Object> response = new HashMap<>();
        response.put("id", targetUser.getId());
        response.put("username", targetUser.getUsername());
        response.put("avatarUrl", targetUser.getAvatarUrl());
        response.put("mutualFriends", mutualFriends);
        response.put("mutualServers", mutualServers);

        return response;
    }
}

