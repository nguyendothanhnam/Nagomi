package com.example.Nagomi.controller;

import com.example.Nagomi.model.Channel;
import com.example.Nagomi.model.Server;
import com.example.Nagomi.model.User;
import com.example.Nagomi.repository.ChannelRepository;
import com.example.Nagomi.repository.ServerRepository;
import com.example.Nagomi.service.VoiceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/channels")
@CrossOrigin
public class ChannelController {

    @Autowired private ChannelRepository channelRepo;
    @Autowired private ServerRepository serverRepo;
    @Autowired private VoiceService voiceService;
    // 1. Lấy danh sách kênh của 1 Server
    @GetMapping("/server/{serverId}")
    public List<Channel> getChannelsByServer(@PathVariable Long serverId) {
        return channelRepo.findByServerId(serverId);
    }

    // 2. Tạo kênh mới
    @PostMapping("/create")
    public Channel createChannel(@RequestParam String name, @RequestParam String type, @RequestParam Long serverId) {
        Server server = serverRepo.findById(serverId).orElse(null);
        if (server == null) return null;

        Channel channel = new Channel();
        channel.setName(name);
        channel.setType(type); // "TEXT" hoặc "VOICE"
        channel.setServer(server);

        return channelRepo.save(channel);
    }
    @GetMapping("/voice/status")
    public Map<Long, List<User>> getAllVoiceStatus() {
        return voiceService.getAllActiveStatus();
    }

}