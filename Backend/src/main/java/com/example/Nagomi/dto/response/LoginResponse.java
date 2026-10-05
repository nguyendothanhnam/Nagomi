package com.example.Nagomi.dto.response;

import com.example.Nagomi.model.User;
import lombok.Data;

@Data
public class LoginResponse {
    private Long id;
    private String username;
    private String token; // <== TRƯỜNG CẦN THIẾT
    private String email;
    private String avatarUrl;
    public LoginResponse(Long userId, String username, String email, String avatarUrl, String token) {
        this.id = userId;
        this.username = username;
        this.email = email;
        this.avatarUrl = avatarUrl;
        this.token = token;
    }

}
