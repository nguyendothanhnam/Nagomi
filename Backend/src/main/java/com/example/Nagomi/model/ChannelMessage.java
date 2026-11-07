package com.example.Nagomi.model;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class ChannelMessage {
    private Long id;

    private String content;

    // Nếu bảng messages chưa có cột 'type', bạn cần chạy SQL thêm vào
    // ALTER TABLE messages ADD COLUMN type VARCHAR(20) DEFAULT 'TEXT';
    private String type;

    private User sender;

    private Channel channel;

    // Bảng messages dùng cột 'created_at' hay 'timestamp'?
    // Kiểm tra ảnh bạn gửi: Cột tên là 'created_at'
    private LocalDateTime timestamp = LocalDateTime.now();

    private Integer duration;

    private boolean edited = false;

    private boolean pinned = false;

    private Long replyToId;

    private String reactions = "{}";
}
