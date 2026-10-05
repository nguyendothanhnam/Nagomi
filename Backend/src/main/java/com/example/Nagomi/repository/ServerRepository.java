package com.example.Nagomi.repository;

import com.example.Nagomi.model.Server;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface ServerRepository extends JpaRepository<Server, Long> {
    // Tìm tất cả server do người dùng này làm chủ
    @Query("SELECT s FROM Server s WHERE s.owner.id = :userId OR s.id IN (SELECT m.server.id FROM ServerMember m WHERE m.user.id = :userId)")
    List<Server> findAllByUserId(@Param("userId") Long userId);

    Optional<Server> findByInviteCode(String inviteCode);
}