package com.example.Nagomi.dto.request;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class MusicSyncMessage {
    private String url;
    private String title;
    private long position;  // Quan trọng: Để người mới nhảy đúng giây
    private boolean isPlaying;
}