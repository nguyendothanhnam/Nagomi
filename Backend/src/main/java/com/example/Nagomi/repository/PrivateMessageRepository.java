package com.example.Nagomi.repository;

import com.example.Nagomi.model.PrivateMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.cloud.firestore.Firestore;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;

@Repository
public class PrivateMessageRepository extends FirestoreRepository<PrivateMessage> {
    public PrivateMessageRepository(Firestore firestore, ObjectMapper mapper) {
        super(firestore, mapper, "private_messages", PrivateMessage.class, PrivateMessage::getId, PrivateMessage::setId);
    }

    public List<PrivateMessage> findChatHistory(Long user1, Long user2) {
        var messages = new LinkedHashMap<Long, PrivateMessage>();
        findWhere("senderId", user1).stream().filter(m -> user2.equals(m.getReceiverId())).forEach(m -> messages.put(m.getId(), m));
        findWhere("senderId", user2).stream().filter(m -> user1.equals(m.getReceiverId())).forEach(m -> messages.put(m.getId(), m));
        return messages.values().stream().sorted(Comparator.comparing(PrivateMessage::getId)).toList();
    }
}
