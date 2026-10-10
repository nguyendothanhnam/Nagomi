package com.example.Nagomi.model;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class ServerMember {
    private Long id;

    private Server server;

    private User user;

    private String role; // "OWNER", "MEMBER"

    private LocalDateTime joinedAt = LocalDateTime.now();
}
