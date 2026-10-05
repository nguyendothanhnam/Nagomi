package com.example.Nagomi.model;

public enum RequestStatus {
    PENDING,   // Đang chờ (Mặc định khi mới gửi)
    ACCEPTED,  // Đã đồng ý
    REJECTED,  // Đã từ chối
    CANCELLED  // Đã hủy (Người gửi tự thu hồi)
}
