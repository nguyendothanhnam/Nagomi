package com.example.Nagomi.model;

import lombok.Data;

@Data
public class ChannelMusic {
    private Long id;
    private Long channelId;
    private String title;
    private String url;
    private String uploadedBy; // Username người gửi
}
