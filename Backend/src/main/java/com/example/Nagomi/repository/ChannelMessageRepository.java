package com.example.Nagomi.repository;

import com.example.Nagomi.model.ChannelMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.cloud.firestore.Firestore;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.List;

@Repository
public class ChannelMessageRepository extends FirestoreRepository<ChannelMessage> {
    public ChannelMessageRepository(Firestore firestore, ObjectMapper mapper) {
        super(firestore, mapper, "channel_messages", ChannelMessage.class, ChannelMessage::getId, ChannelMessage::setId);
    }

    public List<ChannelMessage> findByChannelIdOrderByIdAsc(Long channelId) {
        return findWhere("channel.id", channelId).stream().sorted(Comparator.comparing(ChannelMessage::getId)).toList();
    }
}
