package com.example.Nagomi.model;

import lombok.Data;

@Data
public class Channel {
    private Long id;

    private String name;

    // 👇 THÊM DÒNG NÀY
    private String type; // "TEXT" hoặc "VOICE"

    private Server server;
}
