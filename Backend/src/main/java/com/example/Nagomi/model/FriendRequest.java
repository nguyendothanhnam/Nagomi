package com.example.Nagomi.model;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Entity
@Table(name = "friend_requests")
@Data
public class FriendRequest {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    private User sender; // Người gửi lời mời

    @ManyToOne
    private User receiver; // Người nhận lời mời
    @Enumerated(EnumType.STRING) // Lưu dưới dạng chuỗi "PENDING", "ACCEPTED"... vào DB
    private RequestStatus status = RequestStatus.PENDING;


    private LocalDateTime createdAt = LocalDateTime.now();
}