package com.example.Nagomi.repository;

import com.example.Nagomi.model.PrivateMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface PrivateMessageRepository extends JpaRepository<PrivateMessage, Long> {
    // Tìm tin nhắn giữa 2 người (A gửi B hoặc B gửi A)
    // Tìm tin nhắn 2 chiều (A gửi B HOẶC B gửi A), sắp xếp theo thời gian
    @Query("SELECT m FROM PrivateMessage m WHERE (m.senderId = :u1 AND m.receiverId = :u2) OR (m.senderId = :u2 AND m.receiverId = :u1) ORDER BY m.id ASC")
    List<PrivateMessage> findChatHistory(@Param("u1") Long u1, @Param("u2") Long u2);
}
