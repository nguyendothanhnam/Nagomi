package com.example.Nagomi.model;

import lombok.Data;

@Data
public class ServerInvitation {
    private Long id;

    private Server server;

    private User inviter; // Người gửi lời mời

    private User receiver; // Người được mời

    private String status = "PENDING"; // PENDING, ACCEPTED, REJECTED
}
