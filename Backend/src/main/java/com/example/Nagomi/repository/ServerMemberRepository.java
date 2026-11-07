package com.example.Nagomi.repository;

import com.example.Nagomi.model.ServerMember;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.cloud.firestore.Firestore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ServerMemberRepository extends FirestoreRepository<ServerMember> {
    public ServerMemberRepository(Firestore firestore, ObjectMapper mapper) {
        super(firestore, mapper, "server_members", ServerMember.class, ServerMember::getId, ServerMember::setId);
    }

    public boolean existsByServerIdAndUserId(Long serverId, Long userId) {
        return !findByServerId(serverId).stream().filter(m -> m.getUser() != null)
                .filter(m -> userId.equals(m.getUser().getId())).toList().isEmpty();
    }

    public List<ServerMember> findByServerId(Long serverId) { return findWhere("server.id", serverId); }
}
