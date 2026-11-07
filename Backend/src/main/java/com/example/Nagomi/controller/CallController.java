package com.example.Nagomi.controller;

import com.example.Nagomi.dto.request.CallSignalMessage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

@Controller
public class CallController {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @MessageMapping("/call.signal")
    public void relayCallSignal(@Payload CallSignalMessage message) {
        if (message == null || message.getToUserId() == null) {
            return;
        }

        messagingTemplate.convertAndSend(
                "/topic/call." + message.getToUserId(),
                message
        );
    }
}
