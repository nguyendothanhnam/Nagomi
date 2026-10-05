package com.example.Nagomi.dto.request;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class MusicControlRequest {
    private String action;   // "PLAY", "PAUSE", "SEEK"
    private String url;      // Link mp3
    private String title;    // Tên bài hát
    private Long position;   // Vị trí (ms)
    private String sender;   // Người gửi lệnh
}