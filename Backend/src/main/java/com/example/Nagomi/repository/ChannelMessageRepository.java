package com.example.Nagomi.repository;

import com.example.Nagomi.model.ChannelMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface ChannelMessageRepository extends JpaRepository<ChannelMessage, Long> {
    // Tìm tin nhắn theo channelId, sắp xếp cũ -> mới
    List<ChannelMessage> findByChannelIdOrderByIdAsc(Long channelId);
}