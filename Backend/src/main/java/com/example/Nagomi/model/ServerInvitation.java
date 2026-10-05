package com.example.Nagomi.model;

import jakarta.persistence.*;
import lombok.Data;

@Entity
@Data
public class ServerInvitation {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    private Server server;

    @ManyToOne
    private User inviter; // Người gửi lời mời

    @ManyToOne
    private User receiver; // Người được mời

    private String status = "PENDING"; // PENDING, ACCEPTED, REJECTED
}
