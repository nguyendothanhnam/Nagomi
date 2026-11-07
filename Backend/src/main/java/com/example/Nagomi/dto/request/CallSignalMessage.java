package com.example.Nagomi.dto.request;

import lombok.Data;

@Data
public class CallSignalMessage {
    private String type;
    private Long fromUserId;
    private Long toUserId;
    private String fromUsername;
    private String fromAvatarUrl;
    private Object sdp;
    private Object candidate;
    private String reason;
}
