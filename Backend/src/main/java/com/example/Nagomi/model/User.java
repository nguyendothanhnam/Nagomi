package com.example.Nagomi.model;

import lombok.Data;

@Data
public class User {
    private Long id;
    private String username;
    private String password;
    private String email;
    private String status;
    private String avatarUrl;
}
