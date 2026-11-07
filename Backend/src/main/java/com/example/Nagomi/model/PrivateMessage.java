package com.example.Nagomi.model;


import lombok.Data;
import java.time.LocalDateTime;

@Data
public class PrivateMessage {
    private Long id;
    private String content;
    private Long senderId;   // ID người gửi
    private Long receiverId; // ID người nhận
    private LocalDateTime timestamp = LocalDateTime.now();

    private String type;
    private Integer duration;

    private boolean edited = false;
    private boolean pinned = false;
    private Long replyToId;
    private String reactions = "{}";
}
