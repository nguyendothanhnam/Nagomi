package com.example.Nagomi.dto.request;

import lombok.Data;

@Data
public class UpdateServerRequest {
    private String iconUrl;
    private String name; // Thêm trường name để dễ dàng mở rộng chức năng sửa tên
}