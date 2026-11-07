package com.example.Nagomi.repository;

import com.example.Nagomi.model.Server;
import com.example.Nagomi.model.ServerMember;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.cloud.firestore.Firestore;
import org.springframework.stereotype.Repository;

import java.util.*;

@Repository
public class ServerRepository extends FirestoreRepository<Server> {
    public ServerRepository(Firestore firestore, ObjectMapper mapper) {
        super(firestore, mapper, "servers", Server.class, Server::getId, Server::setId);
    }

    @Override
    public Optional<Server> findById(Long id) {
        Optional<Server> found = super.findById(id);
        found.ifPresent(server -> server.setMembers(new LinkedHashSet<>(
                new ServerMemberRepository(firestore, mapper).findByServerId(id).stream()
                        .map(ServerMember::getUser).filter(Objects::nonNull).toList())));
        return found;
    }

    public List<Server> findAllByUserId(Long userId) {
        Map<Long, Server> results = new LinkedHashMap<>();
        findWhere("owner.id", userId).forEach(server -> results.put(server.getId(), server));
        for (var snapshot : await(firestore.collection("server_members").whereEqualTo("user.id", userId).get()).getDocuments()) {
            Long serverId = snapshot.getLong("server.id");
            if (serverId != null) findById(serverId).ifPresent(server -> results.put(serverId, server));
        }
        return new ArrayList<>(results.values());
    }

    public Optional<Server> findByInviteCode(String inviteCode) {
        return findWhere("inviteCode", inviteCode).stream().findFirst();
    }
}
