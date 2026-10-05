package com.example.Nagomi.controller;


import com.example.Nagomi.dto.response.LoginResponse;
import com.example.Nagomi.model.User;
import com.example.Nagomi.repository.UserRepository;
import com.example.Nagomi.util.JwtUtils;
import org.mindrot.jbcrypt.BCrypt;
import org.springframework.beans.factory.annotation.Autowired;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;


import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@RestController
@RequestMapping("/api/auth")
@CrossOrigin // Cho phép React Native gọi API
public class AuthController {

    @Autowired
    private UserRepository userRepository;

    // 1. Đăng ký
//    @PostMapping("/register")
//    public String register(@RequestBody User user) {
//        if (userRepository.findByUsername(user.getUsername()).isPresent()) {
//            return "Username đã tồn tại!";
//        }
//        // Mã hóa password trước khi lưu
//        String hashed = BCrypt.hashpw(user.getPassword(), BCrypt.gensalt());
//        user.setPassword(hashed);
//        user.setStatus("OFFLINE");
//        userRepository.save(user);
//        return "Đăng ký thành công!";
//    }
    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody User user) {
        // 1. Kiểm tra username tồn tại
        if (userRepository.findByUsername(user.getUsername()).isPresent()) {
            // Trả về lỗi 400 kèm thông báo
            return ResponseEntity.badRequest().body("Username đã tồn tại!");
        }

        try {
            // 2. Đảm bảo tạo mới hoàn toàn (Tránh việc truyền ID từ Client gây ghi đè)
            User newUser = new User();
            newUser.setUsername(user.getUsername());
            newUser.setEmail(user.getEmail());

            // Mã hóa password
            String hashed = BCrypt.hashpw(user.getPassword(), BCrypt.gensalt());
            newUser.setPassword(hashed);
            newUser.setStatus("OFFLINE");

            userRepository.save(newUser);
            return ResponseEntity.ok("Đăng ký thành công!");
        } catch (Exception e) {
            return ResponseEntity.status(500).body("Lỗi hệ thống: " + e.getMessage());
        }
    }
    // 2. Đăng nhập
    @PostMapping("/login")
    public Object login(@RequestBody Map<String, String> loginData) {
        String username = loginData.get("username");
        String password = loginData.get("password");

        Optional<User> userOpt = userRepository.findByUsername(username);

        if (userOpt.isPresent() && BCrypt.checkpw(password, userOpt.get().getPassword())) {
            User user = userOpt.get();

            // 1. Cập nhật Status
            user.setStatus("ONLINE");
            userRepository.save(user);

            // 2. TẠO JWT TOKEN
            String jwtToken = JwtUtils.generateJwtToken(user.getId(), user.getUsername());

            // 3. TRẢ VỀ RESPONSE DTO
            return new LoginResponse(
                    user.getId(),           // Long userId
                    user.getUsername(),     // String username
                    user.getEmail(),        // String email <--- ĐÃ THÊM
                    user.getAvatarUrl(),    // String avatarUrl
                    jwtToken                // String token
            ); // <-- Trả về DTO chứa ID, Username, và TOKEN!
        }

        // Trả về một đối tượng Response Entity hoặc HttpStatus.UNAUTHORIZED để chuyên nghiệp hơn
        return "Sai tài khoản hoặc mật khẩu";
    }


}
