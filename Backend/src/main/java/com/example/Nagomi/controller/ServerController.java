package com.example.Nagomi.controller;

import com.example.Nagomi.dto.request.UpdateServerRequest;
import com.example.Nagomi.model.*;
import com.example.Nagomi.repository.*;
import com.example.Nagomi.util.JwtUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.Map;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Set;

@RestController
@RequestMapping("/api/servers")
@CrossOrigin
public class ServerController {

    @Autowired private ServerRepository serverRepo;
    @Autowired private UserRepository userRepo;
    @Autowired private ChannelRepository channelRepo;
    @Autowired private ServerMemberRepository memberRepo;
    @Autowired private ServerInvitationRepository invitationRepo;


    @PutMapping("/{serverId}")
    public ResponseEntity<Server> updateServerInfo(
            @PathVariable Long serverId,
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody UpdateServerRequest request)
    {
        Long actorId = JwtUtils.extractUserId(authorization);
        if (actorId == null) return ResponseEntity.status(401).build();
        Optional<Server> serverOpt = serverRepo.findById(serverId);
        if (serverOpt.isEmpty()) {
            return ResponseEntity.status(404).build();
        }
        Server server = serverOpt.get();
        if (!server.getOwner().getId().equals(actorId)) return ResponseEntity.status(403).build();

        // 1. Kiểm tra và cập nhật Icon
        if (request.getIconUrl() != null && !request.getIconUrl().isEmpty()) {
            server.setIconUrl(request.getIconUrl());
        }

        // 2. Kiểm tra và cập nhật Tên
        if (request.getName() != null && !request.getName().isEmpty()) {
            server.setName(request.getName());
        }

        Server updatedServer = serverRepo.save(server);
        return ResponseEntity.ok(updatedServer);
    }
    // 1. Tạo Server mới (Đã cập nhật có iconUrl)
    // CHỈ GIỮ LẠI MỘT HÀM NÀY THÔI
    @PostMapping("/create")
    public ResponseEntity<?> createServer(
            @RequestParam String name,
            @RequestParam(required = false) String iconUrl,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        Long ownerId = JwtUtils.extractUserId(authorization);
        if (ownerId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        User owner = userRepo.findById(ownerId).orElse(null);
        if (owner != null) {
            // A. Tạo Server
            Server server = new Server();
            server.setName(name);
            server.setOwner(owner);
            server.setIconUrl(iconUrl); // Lưu icon
            Server savedServer = serverRepo.save(server);

            // B. Tự động thêm Owner làm thành viên đầu tiên
            ServerMember member = new ServerMember();
            member.setServer(savedServer);
            member.setUser(owner);
            member.setRole("OWNER");
            memberRepo.save(member);

            // C. Tạo kênh mặc định
            createDefaultChannel(savedServer, "chung", "TEXT");
            createDefaultChannel(savedServer, "General", "VOICE");

            return ResponseEntity.ok(savedServer);
        }
        return ResponseEntity.notFound().build();
    }

    private void createDefaultChannel(Server server, String name, String type) {
        Channel channel = new Channel();
        channel.setName(name);
        channel.setType(type);
        channel.setServer(server);
        channelRepo.save(channel);
    }
    @DeleteMapping("/{serverId}/members/{memberId}")
    public ResponseEntity<String> deleteMember(
            @PathVariable Long serverId,
            @PathVariable Long memberId,
            @RequestHeader(value = "Authorization", required = false) String authorization)
    {
        Long actorId = JwtUtils.extractUserId(authorization);
        if (actorId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        // 1. Tìm Server
        Optional<Server> serverOpt = serverRepo.findById(serverId);
        if (serverOpt.isEmpty()) {
            return ResponseEntity.status(404).body("Server không tồn tại.");
        }
        Server server = serverOpt.get();

        // 2. Tìm User
        Optional<User> userOpt = userRepo.findById(memberId);
        if (userOpt.isEmpty()) {
            return ResponseEntity.status(404).body("Thành viên không tồn tại.");
        }
        User memberToRemove = userOpt.get();

        if (!canModerate(serverId, actorId)) return ResponseEntity.status(403).body("Bạn không có quyền quản lý thành viên.");
        // Không thể xóa chủ máy chủ; quản trị viên không thể xóa quản trị viên khác.
        if (server.getOwner().getId().equals(memberId)) {
            return ResponseEntity.status(400).body("Không thể xóa chủ nhóm.");
        }

        ServerMember membership = memberRepo.findByServerId(serverId).stream()
                .filter(m -> m.getUser().getId().equals(memberId)).findFirst().orElse(null);
        if (membership != null) {
            ServerMember actor = memberRepo.findByServerId(serverId).stream()
                    .filter(m -> m.getUser().getId().equals(actorId)).findFirst().orElse(null);
            if (actor != null && "ADMIN".equals(actor.getRole()) && "ADMIN".equals(membership.getRole()))
                return ResponseEntity.status(403).body("Quản trị viên không thể xóa quản trị viên khác.");
            memberRepo.delete(membership);
            return ResponseEntity.ok("Đã xóa thành viên thành công.");
        } else {
            return ResponseEntity.status(404).body("Thành viên không thuộc nhóm này.");
        }
    }
    // 2. Lấy danh sách Server của tôi (Bao gồm cả server mình tạo và được mời)
    @GetMapping("/my/{userId}")
    public List<Server> getMyServers(@PathVariable Long userId) {
        return serverRepo.findAllByUserId(userId);
    }

    // 3. Lấy thông tin chi tiết 1 Server
    @GetMapping("/{serverId}")
    public Server getServerDetail(@PathVariable Long serverId) {
        return serverRepo.findById(serverId).orElse(null);
    }

    // 4. Mời thành viên vào Server
    @PostMapping("/{serverId}/invite")
    public String addMember(@PathVariable Long serverId, @RequestParam Long userId,
                            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long actorId = JwtUtils.extractUserId(authorization);
        if (actorId == null || !canInvite(serverId, actorId)) return "Bạn không có quyền mời thành viên.";
        if (memberRepo.existsByServerIdAndUserId(serverId, userId)) {
            return "Người này đã ở trong nhóm rồi!";
        }

        Server server = serverRepo.findById(serverId).orElse(null);
        User user = userRepo.findById(userId).orElse(null);

        if (server != null && user != null) {
            ServerMember member = new ServerMember();
            member.setServer(server);
            member.setUser(user);
            member.setRole("MEMBER");
            memberRepo.save(member);
            return "Đã thêm thành viên thành công!";
        }
        return "Lỗi: Không tìm thấy Server hoặc User";
    }

    // 5. Lấy danh sách thành viên trong Server (Dùng để lọc khi mời bạn)
    @GetMapping("/{serverId}/members")
    public List<Long> getServerMemberIds(@PathVariable Long serverId) {
        List<ServerMember> members = memberRepo.findByServerId(serverId);
        Set<Long> userIds = new LinkedHashSet<>();
        for (ServerMember m : members) {
            if (m.getUser() != null && m.getUser().getId() != null) userIds.add(m.getUser().getId());
        }
        return new ArrayList<>(userIds);
    }

    @GetMapping("/{serverId}/members/details")
    public ResponseEntity<?> getServerMembers(@PathVariable Long serverId) {
        if (!serverRepo.existsById(serverId)) return ResponseEntity.notFound().build();
        Map<Long, Map<String, Object>> uniqueMembers = new LinkedHashMap<>();
        for (ServerMember membership : memberRepo.findByServerId(serverId)) {
            User user = membership.getUser();
            if (user == null || user.getId() == null || uniqueMembers.containsKey(user.getId())) continue;
            Map<String, Object> member = new HashMap<>();
            member.put("id", user.getId());
            member.put("username", user.getUsername());
            member.put("avatarUrl", user.getAvatarUrl());
            member.put("status", user.getStatus() == null ? "OFFLINE" : user.getStatus());
            member.put("role", membership.getRole() == null ? "MEMBER" : membership.getRole());
            member.put("joinedAt", membership.getJoinedAt());
            uniqueMembers.put(user.getId(), member);
        }
        return ResponseEntity.ok(new ArrayList<>(uniqueMembers.values()));
    }

    @PutMapping("/{serverId}/members/{memberId}/role")
    public ResponseEntity<?> updateMemberRole(@PathVariable Long serverId, @PathVariable Long memberId,
                                               @RequestHeader(value = "Authorization", required = false) String authorization,
                                               @RequestParam String role) {
        Long actorId = JwtUtils.extractUserId(authorization);
        if (actorId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        String requestedRole = role == null ? "" : role.toUpperCase();
        if (!requestedRole.equals("ADMIN") && !requestedRole.equals("MEMBER"))
            return ResponseEntity.badRequest().body("Vai trò chỉ có thể là ADMIN hoặc MEMBER.");
        Server server = serverRepo.findById(serverId).orElse(null);
        if (server == null) return ResponseEntity.notFound().build();
        if (!server.getOwner().getId().equals(actorId)) return ResponseEntity.status(403).body("Chỉ chủ máy chủ được quản lý vai trò.");
        ServerMember target = memberRepo.findByServerId(serverId).stream()
                .filter(m -> m.getUser().getId().equals(memberId)).findFirst().orElse(null);
        if (target == null) return ResponseEntity.status(404).body("Không tìm thấy thành viên.");
        if ("OWNER".equals(target.getRole())) return ResponseEntity.badRequest().body("Không thể đổi vai trò chủ máy chủ.");
        target.setRole(requestedRole);
        memberRepo.save(target);
        return ResponseEntity.ok(Map.of("userId", memberId, "role", requestedRole));
    }
    // --- API 1: LẤY LINK MỜI (Cập nhật logic lưu vào DB) ---
    @GetMapping("/{serverId}/invite-link")
    public ResponseEntity<String> getInviteLink(@PathVariable Long serverId,
                                                 @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long actorId = JwtUtils.extractUserId(authorization);
        if (actorId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        if (!canInvite(serverId, actorId)) return ResponseEntity.status(403).body("Bạn không có quyền tạo mã mời.");
        Optional<Server> serverOpt = serverRepo.findById(serverId);
        if (serverOpt.isEmpty()) return ResponseEntity.badRequest().body("Server không tồn tại");

        Server server = serverOpt.get();

        // Nếu Server chưa có mã mời, tạo mới và lưu lại
        if (server.getInviteCode() == null || server.getInviteCode().isEmpty()) {
            String newCode = "Nagomi-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
            server.setInviteCode(newCode);
            serverRepo.save(server);
        }

        return ResponseEntity.ok(server.getInviteCode());
    }

    // --- API 2: THAM GIA SERVER (Logic thật) ---
    @PostMapping("/join")
    public ResponseEntity<String> joinServerByInviteCode(@RequestParam String inviteCode,
                                                          @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long userId = JwtUtils.extractUserId(authorization);
        if (userId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        // 1. Tìm Server bằng mã mời
        Optional<Server> serverOpt = serverRepo.findByInviteCode(inviteCode);
        if (serverOpt.isEmpty()) {
            return ResponseEntity.badRequest().body("Mã mời không hợp lệ hoặc không tồn tại.");
        }

        Server server = serverOpt.get();

        // 2. Tìm User
        Optional<User> userOpt = userRepo.findById(userId);
        if (userOpt.isEmpty()) {
            return ResponseEntity.badRequest().body("Người dùng không tồn tại.");
        }
        User user = userOpt.get();

        // Check the membership collection, which is the source used by the member list API.
        if (memberRepo.existsByServerIdAndUserId(server.getId(), userId)) {
            // Trả về mã lỗi 400 kèm thông báo rõ ràng
            return ResponseEntity.badRequest().body("ALREADY_JOINED");
        }

        // 4. Thêm User vào Server
        ServerMember membership = new ServerMember();
        membership.setServer(server);
        membership.setUser(user);
        membership.setRole("MEMBER");
        memberRepo.save(membership);

        return ResponseEntity.ok("SUCCESS:" + server.getName());
    }

    @PostMapping("/{serverId}/leave")
    public ResponseEntity<String> leaveServer(@PathVariable Long serverId,
                                               @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long userId = JwtUtils.extractUserId(authorization);
        if (userId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        Server server = serverRepo.findById(serverId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy nhóm."));

        // 1. Kiểm tra nếu là chủ nhóm thì không cho rời (phải chuyển quyền hoặc xóa nhóm sau)
        if (server.getOwner().getId().equals(userId)) {
            return ResponseEntity.badRequest().body("OWNER_CANNOT_LEAVE");
        }

        // 2. Tìm và xóa user khỏi danh sách members
        ServerMember membership = memberRepo.findByServerId(serverId).stream()
                .filter(m -> m.getUser().getId().equals(userId)).findFirst().orElse(null);
        if (membership != null) {
            memberRepo.delete(membership);
            return ResponseEntity.ok("Rời nhóm thành công.");
        } else {
            return ResponseEntity.badRequest().body("Bạn không phải là thành viên của nhóm này.");
        }
    }

    @DeleteMapping("/{serverId}")
    public ResponseEntity<String> deleteServer(@PathVariable Long serverId,
                                                @RequestHeader(value = "Authorization", required = false) String authorization) {
        try {
            Long userId = JwtUtils.extractUserId(authorization);
            if (userId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
            System.out.println("LOG: Đang yêu cầu xóa Server ID: " + serverId + " bởi User ID: " + userId);

            Server server = serverRepo.findById(serverId)
                    .orElseThrow(() -> new RuntimeException("Không tìm thấy nhóm ID: " + serverId));

            // 🛡️ 1. Kiểm tra quyền chủ sở hữu
            if (!server.getOwner().getId().equals(userId)) {
                return ResponseEntity.status(403).body("Bạn không phải chủ nhóm!");
            }

            // 🛠️ 2. QUAN TRỌNG: Xóa tất cả thành viên trong bảng trung gian trước
            // Điều này gỡ bỏ ràng buộc khóa ngoại (Foreign Key)
            List<ServerMember> memberships = memberRepo.findByServerId(serverId);
            memberRepo.deleteAll(memberships);

            // 🛠️ 3. Xóa các kênh (Channels) thuộc về Server này
            // (Nếu bạn chưa cấu hình Cascade trong Model Channel)
            List<Channel> channels = channelRepo.findByServerId(serverId);
            channelRepo.deleteAll(channels);

            // 🚀 4. Bây giờ mới xóa Server
            serverRepo.delete(server);

            return ResponseEntity.ok("Xóa thành công");
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(500).body("Lỗi hệ thống: " + e.getMessage());
        }
    }

    @PostMapping("/invite/send")
    public ResponseEntity<?> sendInvite(@RequestParam Long serverId, @RequestParam Long friendId,
                                        @RequestHeader(value = "Authorization", required = false) String authorization) {
        Long inviterId = JwtUtils.extractUserId(authorization);
        if (inviterId == null) return ResponseEntity.status(401).body("Phiên đăng nhập không hợp lệ.");
        // 1. Kiểm tra quyền của người mời
        if (!canInvite(serverId, inviterId)) return ResponseEntity.status(HttpStatus.FORBIDDEN).body("Bạn không có quyền mời người khác.");
        // 2. Kiểm tra người nhận đã ở trong nhóm chưa
        if (memberRepo.existsByServerIdAndUserId(serverId, friendId)) {
            return ResponseEntity.badRequest().body("Người này đã ở trong nhóm rồi!");
        }
        // 3. Kiểm tra lời mời đã tồn tại chưa
        if (invitationRepo.existsByServerIdAndReceiverIdAndStatus(serverId, friendId, "PENDING")) {
            return ResponseEntity.badRequest().body("Đã gửi lời mời rồi.");
        }

        Server server = serverRepo.findById(serverId).orElse(null);
        User inviter = userRepo.findById(inviterId).orElse(null);
        User receiver = userRepo.findById(friendId).orElse(null);

        if (server != null && inviter != null && receiver != null) {
            ServerInvitation invitation = new ServerInvitation();
            invitation.setServer(server);
            invitation.setInviter(inviter);
            invitation.setReceiver(receiver);
            invitation.setStatus("PENDING");
            invitationRepo.save(invitation);
            return ResponseEntity.ok("SUCCESS:Đã gửi lời mời thành công!");
        }
        return ResponseEntity.status(404).body("Lỗi dữ liệu.");
    }

    @GetMapping("/invites/{userId}")
    public List<ServerInvitation> getMyInvites(@PathVariable Long userId) {
        return invitationRepo.findByReceiverIdAndStatus(userId, "PENDING");
    }

    @PostMapping("/invite/respond")
    public ResponseEntity<?> respondInvite(@RequestParam Long inviteId, @RequestParam boolean accept) {
        ServerInvitation invite = invitationRepo.findById(inviteId).orElse(null);
        if (invite == null) return ResponseEntity.notFound().build();

        if (accept) {
            if (!memberRepo.existsByServerIdAndUserId(invite.getServer().getId(), invite.getReceiver().getId())) {
                ServerMember member = new ServerMember();
                member.setServer(invite.getServer());
                member.setUser(invite.getReceiver());
                member.setRole("MEMBER");
                memberRepo.save(member);
            }
            invite.setStatus("ACCEPTED");
        } else {
            invite.setStatus("REJECTED");
        }

        invitationRepo.save(invite);
        return ResponseEntity.ok(accept ? "SUCCESS:Đã tham gia" : "SUCCESS:Đã từ chối");
    }

    private boolean canModerate(Long serverId, Long actorId) {
        Server server = serverRepo.findById(serverId).orElse(null);
        if (server != null && server.getOwner().getId().equals(actorId)) return true;
        return memberRepo.findByServerId(serverId).stream().anyMatch(m -> m.getUser().getId().equals(actorId)
                && ("OWNER".equals(m.getRole()) || "ADMIN".equals(m.getRole())));
    }

    private boolean canInvite(Long serverId, Long actorId) {
        return canModerate(serverId, actorId);
    }
}
