package com.example.Nagomi.repository;

import com.example.Nagomi.model.ServerMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ServerMemberRepository extends JpaRepository<ServerMember, Long> {
    // Kiểm tra xem user đã ở trong server chưa
    boolean existsByServerIdAndUserId(Long serverId, Long userId);
    List<ServerMember> findByServerId(Long serverId);
}