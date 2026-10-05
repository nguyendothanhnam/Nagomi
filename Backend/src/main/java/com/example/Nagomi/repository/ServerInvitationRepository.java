package com.example.Nagomi.repository;

import com.example.Nagomi.model.ServerInvitation;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ServerInvitationRepository extends JpaRepository<ServerInvitation, Long> {
    // Tìm các lời mời đang chờ của 1 người dùng
    List<ServerInvitation> findByReceiverIdAndStatus(Long receiverId, String status);

    // Kiểm tra xem lời mời tương tự đã tồn tại chưa
    boolean existsByServerIdAndReceiverIdAndStatus(Long serverId, Long receiverId, String status);
}
