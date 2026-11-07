package com.example.Nagomi.repository;

import com.example.Nagomi.model.Channel;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.cloud.firestore.Firestore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ChannelRepository extends FirestoreRepository<Channel> {
    public ChannelRepository(Firestore firestore, ObjectMapper mapper) {
        super(firestore, mapper, "channels", Channel.class, Channel::getId, Channel::setId);
    }

    public List<Channel> findByServerId(Long serverId) { return findWhere("server.id", serverId); }
}
