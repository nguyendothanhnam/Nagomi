package com.example.Nagomi.repository;

import com.example.Nagomi.model.ChannelMusic;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.cloud.firestore.Firestore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ChannelMusicRepository extends FirestoreRepository<ChannelMusic> {
    public ChannelMusicRepository(Firestore firestore, ObjectMapper mapper) {
        super(firestore, mapper, "channel_music", ChannelMusic.class, ChannelMusic::getId, ChannelMusic::setId);
    }

    public List<ChannelMusic> findByChannelId(Long channelId) { return findWhere("channelId", channelId); }
}
