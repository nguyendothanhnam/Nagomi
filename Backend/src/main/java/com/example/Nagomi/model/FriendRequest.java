package com.example.Nagomi.model;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class FriendRequest {
    private Long id;

    private User sender; // Người gửi lời mời

    private User receiver; // Người nhận lời mời
    private RequestStatus status = RequestStatus.PENDING;


    private LocalDateTime createdAt = LocalDateTime.now();
}
