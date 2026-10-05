package com.example.Nagomi.model;


import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Entity
@Table(name = "private_messages")
@Data
public class PrivateMessage {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String content;
    private Long senderId;   // ID người gửi
    private Long receiverId; // ID người nhận
    private LocalDateTime timestamp = LocalDateTime.now();

    private String type;
    private Integer duration;
}
