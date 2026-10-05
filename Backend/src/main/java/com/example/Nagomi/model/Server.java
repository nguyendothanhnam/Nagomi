package com.example.Nagomi.model;

import jakarta.persistence.*;
import lombok.Data;
import java.util.HashSet; // 👈 Import Set
import java.util.Set;     // 👈 Import Set

@Entity
@Table(name = "servers")
@Data
public class Server {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    // Server thuộc về một người tạo (Owner)
    @ManyToOne
    @JoinColumn(name = "owner_id")
    private User owner;

    @Column(name = "icon_url")
    private String iconUrl;

    @Column(name = "invite_code", unique = true)
    private String inviteCode;

    // 👇 THÊM ĐOẠN NÀY ĐỂ SỬA LỖI getMembers()
    @ManyToMany
    @JoinTable(
            name = "server_members", // Tên bảng phụ trong MySQL
            joinColumns = @JoinColumn(name = "server_id"),
            inverseJoinColumns = @JoinColumn(name = "user_id")
    )
    private Set<User> members = new HashSet<>();
}