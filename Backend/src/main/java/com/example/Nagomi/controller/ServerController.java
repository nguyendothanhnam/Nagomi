package com.example.Nagomi.controller;

import com.example.Nagomi.dto.request.UpdateServerRequest;
import com.example.Nagomi.model.*;
import com.example.Nagomi.repository.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

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
            @RequestBody UpdateServerRequest request)
    {
        Optional<Server> serverOpt = serverRepo.findById(serverId);
        if (serverOpt.isEmpty()) {
            return ResponseEntity.status(404).build();
        }
        Server server = serverOpt.get();

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
    public Server createServer(
            @RequestParam Long ownerId,
            @RequestParam String name,
            @RequestParam(required = false) String iconUrl // Tham số mới
    ) {
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

            return savedServer;
        }
        return null;
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
            @PathVariable Long memberId)
    {
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

        // 3. Kiểm tra User đó có phải Owner không (Không cho xóa Owner)
        if (server.getOwner().getId().equals(memberId)) {
            return ResponseEntity.status(400).body("Không thể xóa chủ nhóm.");
        }

        // 4. Xóa khỏi danh sách Members và lưu lại
        if (server.getMembers().remove(memberToRemove)) {
            serverRepo.save(server);
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
    public String addMember(@PathVariable Long serverId, @RequestParam Long userId) {
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
        List<Long> userIds = new ArrayList<>();
        for (ServerMember m : members) {
            userIds.add(m.getUser().getId());
        }
        return userIds;
    }
    // --- API 1: LẤY LINK MỜI (Cập nhật logic lưu vào DB) ---
    @GetMapping("/{serverId}/invite-link")
    public ResponseEntity<String> getInviteLink(@PathVariable Long serverId) {
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
    public ResponseEntity<String> joinServerByInviteCode(@RequestParam Long userId, @RequestParam String inviteCode) {
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

        // 3. KIỂM TRA CHÍNH XÁC HƠN: So sánh theo ID
        // Đôi khi .contains(user) có thể không chính xác nếu Equals/HashCode chưa được định nghĩa
        boolean isAlreadyMember = server.getMembers().stream()
                .anyMatch(member -> member.getId().equals(userId));

        if (isAlreadyMember) {
            // Trả về mã lỗi 400 kèm thông báo rõ ràng
            return ResponseEntity.badRequest().body("ALREADY_JOINED");
        }

        // 4. Thêm User vào Server
        server.getMembers().add(user);
        serverRepo.save(server);

        return ResponseEntity.ok("SUCCESS:" + server.getName());
    }

    @PostMapping("/{serverId}/leave")
    public ResponseEntity<String> leaveServer(@PathVariable Long serverId, @RequestParam Long userId) {
        Server server = serverRepo.findById(serverId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy nhóm."));

        // 1. Kiểm tra nếu là chủ nhóm thì không cho rời (phải chuyển quyền hoặc xóa nhóm sau)
        if (server.getOwner().getId().equals(userId)) {
            return ResponseEntity.badRequest().body("OWNER_CANNOT_LEAVE");
        }

        // 2. Tìm và xóa user khỏi danh sách members
        boolean removed = server.getMembers().removeIf(user -> user.getId().equals(userId));

        if (removed) {
            serverRepo.save(server);
            return ResponseEntity.ok("Rời nhóm thành công.");
        } else {
            return ResponseEntity.badRequest().body("Bạn không phải là thành viên của nhóm này.");
        }
    }

    @DeleteMapping("/{serverId}")
    public ResponseEntity<String> deleteServer(@PathVariable Long serverId, @RequestParam Long userId) {
        try {
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
    public ResponseEntity<?> sendInvite(@RequestParam Long serverId, @RequestParam Long inviterId, @RequestParam Long friendId) {
        // 1. Kiểm tra quyền của người mời
        if (!memberRepo.existsByServerIdAndUserId(serverId, inviterId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body("Bạn không có quyền mời người khác.");
        }
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
}