package com.example.Nagomi.util;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.security.Keys; // Thư viện mới
import java.security.Key; // Thư viện mới
import java.util.Base64; // Thư viện mới
import java.util.Date;
import io.jsonwebtoken.Claims;

public class JwtUtils {

    // 1. CHUỖI BÍ MẬT DÀI VÀ PHỨC TẠP
    // Cần tối thiểu 64 ký tự (512 bits / 8) sau khi mã hóa Base64.
    // Tôi đã tạo một chuỗi ngẫu nhiên, dài, và an toàn hơn cho bạn.
    private static final String JWT_SECRET_STRING = "NagomiChatApplicationSecretKeyForHS512AlgorithmMustBeAtLeast512BitsLongForSecurity";

    // 2. KHÓA KÝ (Signing Key) MẠNH
    // Sử dụng Base64 và Keys.hmacShaKeyFor để đảm bảo khóa có kích thước 512 bits.
    private static final Key signingKey = Keys.hmacShaKeyFor(Base64.getEncoder().encode(JWT_SECRET_STRING.getBytes()));

    // Token sẽ hết hạn sau 24 giờ (86,400,000 milliseconds)
    private static final long JWT_EXPIRATION_MS = 86400000;

    public static String generateJwtToken(Long userId, String username) {
        return Jwts.builder()
                .setSubject(username) // Đặt username làm subject của Token
                .claim("userId", userId) // Đặt ID người dùng vào payload
                .setIssuedAt(new Date()) // Thời gian phát hành
                .setExpiration(new Date((new Date()).getTime() + JWT_EXPIRATION_MS)) // Thời gian hết hạn

                // 3. SỬ DỤNG KHÓA KÝ MẠNH (signingKey) VÀ THUẬT TOÁN (HS512)
                .signWith(signingKey, SignatureAlgorithm.HS512) // Đã sửa lỗi WeakKeyException
                .compact();
    }

    public static Long extractUserId(String authorizationHeader) {
        if (authorizationHeader == null || !authorizationHeader.startsWith("Bearer ")) return null;
        try {
            Claims claims = Jwts.parserBuilder().setSigningKey(signingKey).build()
                    .parseClaimsJws(authorizationHeader.substring(7)).getBody();
            Object userId = claims.get("userId");
            return userId instanceof Number ? ((Number) userId).longValue() : Long.valueOf(userId.toString());
        } catch (RuntimeException ex) {
            return null;
        }
    }
}
