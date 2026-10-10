package com.example.Nagomi.repository;

import com.example.Nagomi.model.ServerInvitation;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.cloud.firestore.Firestore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ServerInvitationRepository extends FirestoreRepository<ServerInvitation> {
    public ServerInvitationRepository(Firestore firestore, ObjectMapper mapper) {
        super(firestore, mapper, "server_invitations", ServerInvitation.class, ServerInvitation::getId, ServerInvitation::setId);
    }

    public List<ServerInvitation> findByReceiverIdAndStatus(Long receiverId, String status) {
        return findWhere("receiver.id", receiverId).stream().filter(i -> status.equals(i.getStatus())).toList();
    }

    public boolean existsByServerIdAndReceiverIdAndStatus(Long serverId, Long receiverId, String status) {
        return findWhere("server.id", serverId).stream().anyMatch(i -> i.getServer() != null && i.getReceiver() != null
                && serverId.equals(i.getServer().getId()) && receiverId.equals(i.getReceiver().getId())
                && status.equals(i.getStatus()));
    }
}
