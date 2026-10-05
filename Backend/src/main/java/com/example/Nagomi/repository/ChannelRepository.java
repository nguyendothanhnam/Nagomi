package com.example.Nagomi.repository;

import com.example.Nagomi.model.Channel;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface ChannelRepository extends JpaRepository<Channel, Long> {
    // Tìm tất cả kênh thuộc về một server cụ thể
    List<Channel> findByServerId(Long serverId);
}