package com.example.Nagomi.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.UUID;

@RestController
@RequestMapping("/api/files")
@CrossOrigin
public class FileUploadController {

    // Đường dẫn lưu file: Thư mục "uploads" nằm ngay trong folder dự án của bạn
    // System.getProperty("user.dir") lấy đường dẫn gốc của dự án
    private static final String UPLOAD_DIR = System.getProperty("user.dir") + "/uploads/";

    @PostMapping("/upload")
    public ResponseEntity<String> uploadFile(@RequestParam("file") MultipartFile file) {
        try {
            // 1. Tạo thư mục uploads nếu chưa có
            File directory = new File(UPLOAD_DIR);
            if (!directory.exists()) {
                directory.mkdirs();
            }

            // 2. Tạo tên file ngẫu nhiên (tránh trùng tên)
            String fileName = UUID.randomUUID().toString() + "_" + file.getOriginalFilename();
            Path filePath = Paths.get(UPLOAD_DIR + fileName);

            // 3. Lưu file vào ổ cứng
            Files.write(filePath, file.getBytes());

            // 4. Trả về đường dẫn web (URL) để Frontend truy cập
            // Kết quả sẽ là: /uploads/ten-file-ngau-nhien.jpg
            String fileUrl = "/uploads/" + fileName;
            return ResponseEntity.ok(fileUrl);

        } catch (IOException e) {
            e.printStackTrace();
            return ResponseEntity.internalServerError().body("Lỗi upload: " + e.getMessage());
        }
    }
}