package com.example.Nagomi.controller;

import com.example.Nagomi.model.ChannelMusic;
import com.example.Nagomi.repository.ChannelMusicRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/channels") // Đường dẫn gốc gọn gàng
@CrossOrigin
public class ChannelMusicController {

    @Autowired
    private ChannelMusicRepository channelMusicRepository;


    @GetMapping("/{channelId}/music")
    public List<ChannelMusic> getChannelPlaylist(@PathVariable Long channelId) {
        return channelMusicRepository.findByChannelId(channelId);
    }

    @PostMapping("/{channelId}/music")
    public ChannelMusic addMusicToChannel(@PathVariable Long channelId, @RequestBody ChannelMusic music) {
        music.setChannelId(channelId);
        return channelMusicRepository.save(music);
    }

    @DeleteMapping("/{channelId}/music/{musicId}")
    public ResponseEntity<?> deleteMusic(@PathVariable Long channelId, @PathVariable Long musicId) {
        // Kiểm tra xem bài nhạc có tồn tại không trước khi xóa
        if (channelMusicRepository.existsById(musicId)) {
            channelMusicRepository.deleteById(musicId);
            return ResponseEntity.ok(true); // Trả về true nếu xóa thành công
        } else {
            return ResponseEntity.status(404).body("Không tìm thấy bài nhạc để xóa");
        }
    }
}