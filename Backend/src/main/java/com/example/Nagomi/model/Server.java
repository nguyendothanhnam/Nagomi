package com.example.Nagomi.model;

import lombok.Data;
import java.util.HashSet; // 👈 Import Set
import java.util.Set;     // 👈 Import Set

@Data
public class Server {
    private Long id;

    private String name;

    // Server thuộc về một người tạo (Owner)
    private User owner;

    private String iconUrl;

    private String inviteCode;

    private Set<User> members = new HashSet<>();
}
