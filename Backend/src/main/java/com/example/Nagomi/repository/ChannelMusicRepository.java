package com.example.Nagomi.repository;

import com.example.Nagomi.model.ChannelMusic;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ChannelMusicRepository extends JpaRepository<ChannelMusic, Long> {
    // Tìm tất cả bài hát thuộc về một kênh cụ thể
    List<ChannelMusic> findByChannelId(Long channelId);
}